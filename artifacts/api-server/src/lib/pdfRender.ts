/**
 * High-resolution PDF page rendering for the artwork-recreation import.
 *
 * Dissection (pdfDissect) recovers editable text/images/rects but cannot
 * reproduce complex vector artwork — exactly what a print key visual is
 * made of. This renders the page to a PNG via pdfjs + @napi-rs/canvas so
 * the artwork layer stays pixel-faithful, while the type is lifted off to
 * live elements (Storyteq-style recreation):
 *
 *  - Layered PDFs: optional-content groups whose names look like type
 *    layers ("Text", "Copy", "Type", "Headline"...) are hidden from the
 *    render, so the artwork comes out clean by construction.
 *  - Flat PDFs: the caller passes the text bounding boxes and each box is
 *    erased from the render by filling with the surrounding colour
 *    (sampled just outside the box). Works well on flat colour panels,
 *    which is where print copy usually sits.
 */
import { createCanvas, type Canvas } from "@napi-rs/canvas";

/** Long-edge target for the render. 2400px covers every digital output size
 * (largest is story 1080x1920) with headroom, while keeping PNGs a few MB. */
const TARGET_LONG_EDGE_PX = 2400;
const MAX_PIXELS = 24_000_000; // safety valve for very long/wide pages

const TEXT_LAYER_NAME = /text|copy|type|headline|txt|wording/i;

export interface EraseBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RenderOptions {
  /** Hide optional-content groups whose names look like type layers. */
  hideTextLayers?: boolean;
  /** Boxes (in scale-1 page coordinates, top-left origin) to erase by
   * filling with the surrounding colour. Applied after rendering. */
  eraseBoxes?: EraseBox[];
}

export interface RenderResult {
  png: Buffer;
  width: number;
  height: number;
  /** Render pixels per scale-1 page unit — multiply dissection coordinates
   * by this to place elements on the rendered artwork. */
  scale: number;
  /** Names of the layers hidden from the render (empty when the PDF has no
   * recognisable type layers). */
  hiddenLayers: string[];
}

/** pdfjs draws onto a canvas it obtains through a factory; hand it napi-rs
 * canvases, which implement the same 2D context API in native code. */
class NapiCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(target: { canvas: Canvas }, width: number, height: number) {
    target.canvas.width = Math.max(1, Math.ceil(width));
    target.canvas.height = Math.max(1, Math.ceil(height));
  }
  destroy(target: { canvas: Canvas | null }) {
    if (target.canvas) {
      target.canvas.width = 1;
      target.canvas.height = 1;
      target.canvas = null;
    }
  }
}

/**
 * Erase a box by stretching the pixels at its left and right edges across it
 * (per-row linear interpolation). Unlike a flat fill, this continues the
 * surrounding texture through the erased area — no visible patch box — and
 * adds nothing that wasn't sampled from the original artwork.
 */
function eraseBoxBlended(
  ctx: ReturnType<Canvas["getContext"]>,
  x: number,
  y: number,
  w: number,
  h: number,
  canvasW: number,
  canvasH: number,
): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(canvasW, Math.round(x + w));
  const y1 = Math.min(canvasH, Math.round(y + h));
  const wdt = x1 - x0;
  const hgt = y1 - y0;
  if (wdt <= 0 || hgt <= 0) return;

  const OFFSET = 3;
  const leftX = Math.max(0, x0 - OFFSET);
  const rightX = Math.min(canvasW - 1, x1 + OFFSET);
  const left = ctx.getImageData(leftX, y0, 1, hgt).data;
  const right = ctx.getImageData(rightX, y0, 1, hgt).data;

  const out = ctx.createImageData(wdt, hgt);
  for (let row = 0; row < hgt; row++) {
    const li = row * 4;
    for (let col = 0; col < wdt; col++) {
      const t = wdt === 1 ? 0.5 : col / (wdt - 1);
      const oi = (row * wdt + col) * 4;
      out.data[oi] = left[li] + (right[li] - left[li]) * t;
      out.data[oi + 1] = left[li + 1] + (right[li + 1] - left[li + 1]) * t;
      out.data[oi + 2] = left[li + 2] + (right[li + 2] - left[li + 2]) * t;
      out.data[oi + 3] = 255;
    }
  }
  ctx.putImageData(out, x0, y0);
}

export async function renderPdfPageToPng(
  data: Uint8Array,
  pageNumber: number,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    CanvasFactory: NapiCanvasFactory,
  });
  const doc = await loadingTask.promise;
  try {
    const page = await doc.getPage(Math.min(Math.max(1, pageNumber || 1), doc.numPages));
    const base = page.getViewport({ scale: 1 });
    let scale = TARGET_LONG_EDGE_PX / Math.max(base.width, base.height);
    if (base.width * scale * base.height * scale > MAX_PIXELS) {
      scale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
    }
    const viewport = page.getViewport({ scale });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);

    // Hide type layers when the PDF is layered and the caller asked for it.
    const hiddenLayers: string[] = [];
    let optionalContentConfigPromise: Promise<unknown> | undefined;
    if (options.hideTextLayers) {
      try {
        const config = await doc.getOptionalContentConfig();
        const order: unknown[] = config.getOrder?.() ?? [];
        const flatIds: string[] = [];
        const flatten = (items: unknown[]) => {
          for (const item of items) {
            if (typeof item === "string") flatIds.push(item);
            else if (item && typeof item === "object" && Array.isArray((item as any).order)) {
              flatten((item as any).order);
            }
          }
        };
        flatten(order);
        for (const id of flatIds) {
          const group = config.getGroup?.(id);
          const name: string = group?.name ?? "";
          if (TEXT_LAYER_NAME.test(name)) {
            config.setVisibility(id, false);
            hiddenLayers.push(name);
          }
        }
        if (hiddenLayers.length > 0) {
          optionalContentConfigPromise = Promise.resolve(config);
        }
      } catch {
        // No optional content, or an unreadable config: fall through to a
        // plain render — the caller erases text boxes instead.
      }
    }

    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    // Print PDFs assume a paper-white ground; without this, transparent
    // regions render black in the PNG.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    await page.render({
      // napi-rs's context implements the browser 2D API; pdfjs only needs that.
      canvasContext: context as unknown as never,
      viewport,
      canvasFactory: new NapiCanvasFactory(),
      ...(optionalContentConfigPromise ? { optionalContentConfigPromise } : {}),
    }).promise;

    // Flat-PDF path: erase the text from the artwork so live text elements
    // laid on top don't double up. Skipped when real layers were hidden.
    if (hiddenLayers.length === 0 && options.eraseBoxes?.length) {
      for (const box of options.eraseBoxes) {
        const pad = Math.max(2, box.h * 0.1) * scale;
        eraseBoxBlended(
          context,
          box.x * scale - pad,
          box.y * scale - pad,
          box.w * scale + pad * 2,
          box.h * scale + pad * 2,
          width,
          height,
        );
      }
    }

    return { png: canvas.toBuffer("image/png"), width, height, scale, hiddenLayers };
  } finally {
    await loadingTask.destroy();
  }
}
