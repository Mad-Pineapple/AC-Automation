/**
 * High-resolution PDF page rendering for the Key Visual import mode.
 *
 * Dissection (pdfDissect) recovers editable text/images/rects but cannot
 * reproduce complex vector artwork — exactly what a print key visual is
 * made of. This renders the whole page to a PNG via pdfjs + @napi-rs/canvas
 * so the master template is pixel-faithful, and size adaptations crop/scale
 * the artwork like a photo instead of rebuilding it.
 */
import { createCanvas, type Canvas } from "@napi-rs/canvas";

/** Long-edge target for the render. 2400px covers every digital output size
 * (largest is story 1080x1920) with headroom, while keeping PNGs a few MB. */
const TARGET_LONG_EDGE_PX = 2400;
const MAX_PIXELS = 24_000_000; // safety valve for very long/wide pages

interface RenderResult {
  png: Buffer;
  width: number;
  height: number;
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

export async function renderPdfPageToPng(data: Uint8Array, pageNumber: number): Promise<RenderResult> {
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
    }).promise;

    return { png: canvas.toBuffer("image/png"), width, height };
  } finally {
    await loadingTask.destroy();
  }
}
