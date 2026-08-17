/**
 * PDF dissection: turn the first page of an uploaded PDF into an editable
 * freeform template (positioned text / image / rect elements).
 *
 * Strategy (v1, best-effort — the review UI lets the user fix anything):
 *  - dimensions: page viewport at scale 1 (1pt == 1px), top-left origin.
 *  - text: getTextContent() items clustered into lines/paragraphs; role inferred
 *    from relative font-size rank, with a CTA heuristic (short text over a rect).
 *  - rects: walk getOperatorList(), tracking the CTM (save/restore/transform)
 *    and current fill color, emitting a rect for each filled `re` rectangle.
 *  - images: paintImageXObject placements resolved via page.objs and encoded to
 *    PNG with pngjs (pure JS), then persisted to object storage.
 *
 * Deferred on purpose: vector paths beyond axis-aligned rects, gradients,
 * rotated/skewed text, font matching, and pages beyond the first.
 */
import { PNG } from "pngjs";
import { ObjectStorageService } from "./objectStorage";
import { normalizeFreeformConfig, type FreeformConfig } from "./freeform";
import { cmykToHex, createPaletteSnapper } from "./colorAdapter";

const objectStorageService = new ObjectStorageService();

const MAX_TEXT_BLOCKS = 80;
const MAX_RECTS = 40;
const MAX_IMAGES = 10;
const MIN_RECT_SIDE = 3;
const MIN_FONT_SIZE = 4;
const SAFE_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export interface DissectResult {
  name: string;
  width: number;
  height: number;
  config: FreeformConfig;
  warnings: string[];
}

type Matrix = number[]; // [a, b, c, d, e, f]

function applyMatrix(m: Matrix, px: number, py: number): [number, number] {
  return [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]];
}

function bboxFromPoints(pts: [number, number][]) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    w: Math.round(Math.max(...xs) - minX),
    h: Math.round(Math.max(...ys) - minY),
  };
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => clamp255(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Normalize pdfjs color-op args (which may be 0-1 or 0-255) to a hex string. */
function colorFromArgs(op: string, args: unknown[]): string | null {
  const nums = (args as unknown[]).filter((v) => typeof v === "number") as number[];
  const scale = (v: number) => (v <= 1 ? v * 255 : v);
  if (op === "setFillRGBColor" && nums.length >= 3) {
    return rgbToHex(scale(nums[0]), scale(nums[1]), scale(nums[2]));
  }
  if (op === "setFillGray" && nums.length >= 1) {
    const g = scale(nums[0]);
    return rgbToHex(g, g, g);
  }
  if (op === "setFillCMYKColor" && nums.length >= 4) {
    const [c, m, y, k] = nums;
    return cmykToHex(c, m, y, k);
  }
  return null;
}

function hexLuminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Most frequent value in a list (first-seen wins ties), or undefined if empty. */
function majority(items: string[]): string | undefined {
  if (items.length === 0) return undefined;
  const counts = new Map<string, number>();
  let best: string | undefined;
  let bestN = 0;
  for (const it of items) {
    const n = (counts.get(it) ?? 0) + 1;
    counts.set(it, n);
    if (n > bestN) {
      bestN = n;
      best = it;
    }
  }
  return best;
}

/**
 * Turn a pdfjs fontFamily/fontName into a CSS-usable family: strip the PDF
 * subset prefix ("ABCDEF+Arial" -> "Arial"), drop quotes and pdfjs loader ids,
 * and keep only characters the server sanitizer will accept.
 */
export function cleanFontFamily(fam: string): string | undefined {
  if (!fam) return undefined;
  let s = fam.trim().replace(/^[A-Z]{6}\+/, "");
  s = s.replace(/^['"]+|['"]+$/g, "").trim();
  if (!s) return undefined;
  if (/^g_[a-z]?\d+_f\d+$/i.test(s)) return undefined; // pdfjs internal loader id
  if (!/^[\w\s,'-]{1,100}$/.test(s)) {
    s = s.replace(/[^\w\s,'-]/g, "").trim();
  }
  return s.length > 0 ? s.slice(0, 100) : undefined;
}

interface RawRect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

interface ImagePlacement {
  objId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Walk the operator list to collect filled rectangles and image placements.
 * Best-effort: any failure is captured as a warning and returns partial data.
 */
function walkOperators(
  pdfjs: any,
  opList: { fnArray: number[]; argsArray: unknown[][] },
  viewportTransform: Matrix,
  warnings: string[],
): { rects: RawRect[]; images: ImagePlacement[]; textFills: string[] } {
  const OPS = pdfjs.OPS;
  const Util = pdfjs.Util;
  const rects: RawRect[] = [];
  const images: ImagePlacement[] = [];
  const textFills: string[] = [];

  // pdfjs v6 embeds the paint intent in constructPath's first arg.
  const FILL_OPS = new Set<number>(
    [
      OPS.fill,
      OPS.eoFill,
      OPS.fillStroke,
      OPS.eoFillStroke,
      OPS.closeFillStroke,
      OPS.closeEOFillStroke,
    ].filter((v) => typeof v === "number"),
  );

  // Text-showing operators, captured in stream order so each shown run can be
  // tagged with the current nonstroking (fill) color.
  const SHOW_TEXT_OPS = new Set<number>(
    [
      OPS.showText,
      OPS.showSpacedText,
      OPS.nextLineShowText,
      OPS.nextLineSetSpacingShowText,
    ].filter((v) => typeof v === "number"),
  );

  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let fill = "#000000";
  const stack: { ctm: Matrix; fill: string }[] = [];

  const toDevice = (): Matrix => Util.transform(viewportTransform, ctm);

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[];

    if (fn === OPS.save) {
      stack.push({ ctm: ctm.slice(), fill });
    } else if (fn === OPS.restore) {
      const prev = stack.pop();
      if (prev) {
        ctm = prev.ctm;
        fill = prev.fill;
      }
    } else if (fn === OPS.transform) {
      ctm = Util.transform(ctm, args as Matrix);
    } else if (
      fn === OPS.setFillRGBColor ||
      fn === OPS.setFillColor ||
      fn === OPS.setFillColorN
    ) {
      // pdfjs v6 normalizes RGB-family fills to a CSS hex string.
      if (typeof args[0] === "string" && SAFE_HEX.test(args[0])) fill = args[0];
    } else if (fn === OPS.setFillGray || fn === OPS.setFillCMYKColor) {
      const opName = fn === OPS.setFillGray ? "setFillGray" : "setFillCMYKColor";
      const c = colorFromArgs(opName, args);
      if (c) fill = c;
    } else if (SHOW_TEXT_OPS.has(fn)) {
      // Text fills with the current nonstroking color; record it in stream order.
      textFills.push(fill);
    } else if (fn === OPS.constructPath) {
      // pdfjs v6: args = [paintOp, packedSegments, bbox] where
      // bbox = [minX, minY, maxX, maxY] in the current user space. bbox is a
      // typed array (Float32Array), so check length rather than Array.isArray.
      const paintOp = args[0] as number;
      const bbox = args[2] as ArrayLike<number> | undefined;
      const hasBbox = !!bbox && typeof bbox.length === "number" && bbox.length >= 4;
      if (FILL_OPS.has(paintOp) && hasBbox) {
        const b = bbox as ArrayLike<number>;
        const m = toDevice();
        const box = bboxOfRect(m, b[0], b[1], b[2] - b[0], b[3] - b[1]);
        if (box.w >= MIN_RECT_SIDE && box.h >= MIN_RECT_SIDE && rects.length < MAX_RECTS) {
          rects.push({ ...box, fill });
        }
      }
    } else if (fn === OPS.paintImageXObject) {
      const objId = String(args[0]);
      const m = toDevice();
      // Image space is the unit square [0,1]^2.
      const box = bboxOfRect(m, 0, 0, 1, 1);
      if (box.w >= MIN_RECT_SIDE && box.h >= MIN_RECT_SIDE && images.length < MAX_IMAGES) {
        images.push({ objId, ...box });
      }
    }
  }

  return { rects, images, textFills };

  function bboxOfRect(m: Matrix, x: number, y: number, w: number, h: number) {
    return bboxFromPoints([
      applyMatrix(m, x, y),
      applyMatrix(m, x + w, y),
      applyMatrix(m, x + w, y + h),
      applyMatrix(m, x, y + h),
    ]);
  }
}

/** Resolve a pdfjs image object (may be async) without throwing. */
export function getImageObject(page: any, objId: string): Promise<any> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    try {
      if (page.objs.has(objId)) {
        clearTimeout(timer);
        resolve(page.objs.get(objId));
        return;
      }
      page.objs.get(objId, (img: unknown) => {
        clearTimeout(timer);
        resolve(img);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Encode a pdfjs image object to PNG bytes, or null if unsupported. */
export function encodeImageToPng(pdfjs: any, img: any): Buffer | null {
  if (!img || !img.data || !img.width || !img.height) return null;
  const { width, height, data, kind } = img;
  const ImageKind = pdfjs.ImageKind;
  const png = new PNG({ width, height });
  const out = png.data;
  const pixels = width * height;

  if (kind === ImageKind.RGBA_32BPP) {
    if (data.length < pixels * 4) return null;
    for (let i = 0; i < pixels * 4; i++) out[i] = data[i];
  } else if (kind === ImageKind.RGB_24BPP) {
    if (data.length < pixels * 3) return null;
    for (let i = 0; i < pixels; i++) {
      out[i * 4] = data[i * 3];
      out[i * 4 + 1] = data[i * 3 + 1];
      out[i * 4 + 2] = data[i * 3 + 2];
      out[i * 4 + 3] = 255;
    }
  } else {
    // GRAYSCALE_1BPP and anything else: unsupported in v1.
    return null;
  }

  return PNG.sync.write(png);
}

interface TextBlock {
  x: number;
  top: number;
  right: number;
  bottom: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  fontFamily?: string;
  color?: string;
  text: string;
}

function extractTextBlocks(
  content: any,
  viewportTransform: Matrix,
  pdfjs: any,
  textFills: string[],
): TextBlock[] {
  const Util = pdfjs.Util;
  const styles = content.styles ?? {};
  type Raw = {
    x: number;
    baseline: number;
    top: number;
    right: number;
    fontSize: number;
    bold: boolean;
    italic: boolean;
    fontFamily?: string;
    color?: string;
    str: string;
  };
  const raws: Raw[] = [];

  for (const item of content.items) {
    if (!("str" in item) || !item.str || !item.str.trim()) continue;
    const t = item.transform as Matrix;
    const fontSize = Math.hypot(t[2], t[3]);
    if (fontSize < MIN_FONT_SIZE) continue;
    const m = Util.transform(viewportTransform, t);
    const x = m[4];
    const baseline = m[5];
    const width = item.width ?? fontSize * item.str.length * 0.5;
    const fam = styles[item.fontName]?.fontFamily ?? item.fontName ?? "";
    const bold = /bold|black|heavy|semibold/i.test(fam);
    const italic = /italic|oblique/i.test(fam);
    raws.push({
      x,
      baseline,
      top: baseline - fontSize,
      right: x + width,
      fontSize,
      bold,
      italic,
      fontFamily: cleanFontFamily(fam),
      str: item.str,
    });
  }

  // Color each kept run by mapping its stream position proportionally onto the
  // fills captured from the operator list (both are in content-stream order).
  if (textFills.length > 0 && raws.length > 0) {
    for (let i = 0; i < raws.length; i++) {
      const idx = Math.min(textFills.length - 1, Math.round((i * textFills.length) / raws.length));
      raws[i].color = textFills[idx];
    }
  }

  raws.sort((a, b) => a.baseline - b.baseline || a.x - b.x);

  // Cluster into lines by baseline proximity.
  const lines: TextBlock[] = [];
  let cur: Raw[] = [];
  const flush = () => {
    if (!cur.length) return;
    cur.sort((a, b) => a.x - b.x);
    const fontSize = Math.max(...cur.map((r) => r.fontSize));
    let text = "";
    let prevRight = -Infinity;
    for (const r of cur) {
      if (text && r.x - prevRight > fontSize * 0.25 && !text.endsWith(" ")) text += " ";
      text += r.str;
      prevRight = r.right;
    }
    lines.push({
      x: Math.min(...cur.map((r) => r.x)),
      top: Math.min(...cur.map((r) => r.top)),
      right: Math.max(...cur.map((r) => r.right)),
      bottom: Math.max(...cur.map((r) => r.baseline)),
      fontSize,
      bold: cur.some((r) => r.bold),
      italic: cur.some((r) => r.italic),
      fontFamily: majority(cur.map((r) => r.fontFamily).filter(Boolean) as string[]),
      color: majority(cur.map((r) => r.color).filter(Boolean) as string[]),
      text: text.trim(),
    });
    cur = [];
  };
  for (const r of raws) {
    if (!cur.length) {
      cur.push(r);
      continue;
    }
    const ref = cur[cur.length - 1];
    if (Math.abs(r.baseline - ref.baseline) <= Math.max(ref.fontSize, r.fontSize) * 0.5) {
      cur.push(r);
    } else {
      flush();
      cur.push(r);
    }
  }
  flush();

  // Merge consecutive lines with similar font-size + small gap into paragraphs.
  const blocks: TextBlock[] = [];
  for (const line of lines) {
    const prev = blocks[blocks.length - 1];
    if (
      prev &&
      Math.abs(prev.fontSize - line.fontSize) <= prev.fontSize * 0.15 &&
      line.top - prev.bottom <= line.fontSize * 0.8 &&
      Math.abs(line.x - prev.x) <= line.fontSize * 1.5
    ) {
      prev.text += "\n" + line.text;
      prev.right = Math.max(prev.right, line.right);
      prev.bottom = line.bottom;
      prev.x = Math.min(prev.x, line.x);
      prev.bold = prev.bold || line.bold;
      prev.italic = prev.italic || line.italic;
      prev.fontFamily = prev.fontFamily ?? line.fontFamily;
      prev.color = prev.color ?? line.color;
    } else {
      blocks.push({ ...line });
    }
  }

  return blocks.slice(0, MAX_TEXT_BLOCKS);
}

/**
 * Snap element colours (text fill, rect fill/border) onto the exact brand
 * palette. Print PDFs carry CMYK builds whose naive RGB conversion lands
 * near — but not on — the official digital hexes; snapping closes that gap.
 * Returns how many colours were adjusted.
 */
function snapConfigToPalette(config: FreeformConfig, paletteHexes: string[]): number {
  if (paletteHexes.length === 0) return 0;
  const snapper = createPaletteSnapper(paletteHexes);
  let snapped = 0;
  for (const el of config.elements) {
    if (el.type === "text") {
      const r = snapper.snap(el.color);
      if (r.snapped) { el.color = r.hex; snapped++; }
    } else if (el.type === "rect") {
      const fill = snapper.snap(el.fill);
      if (fill.snapped) { el.fill = fill.hex; snapped++; }
      if (el.borderColor) {
        const border = snapper.snap(el.borderColor);
        if (border.snapped) { el.borderColor = border.hex; snapped++; }
      }
    }
  }
  return snapped;
}

export type DissectMode = "elements" | "keyVisual";

/**
 * Artwork recreation (Storyteq-style): the artwork becomes one pixel-faithful
 * rendered layer, while the type is lifted off as live text elements on top.
 * Size adaptation then re-composes each format — art crops/scales like a
 * photo behind, text re-anchors and rescales in front.
 *
 * Layered PDFs get true separation (type layers are hidden from the render);
 * flat PDFs get the text erased from the artwork by surrounding-colour fill.
 */
async function renderKeyVisualTemplate(
  data: Uint8Array,
  pageNum: number,
  paletteHexes: string[],
): Promise<DissectResult> {
  const { renderPdfPageToPng } = await import("./pdfRender");
  const warnings: string[] = [];

  // 1. Render the artwork. THE ARTWORK IS NEVER ALTERED: if the PDF has
  //    recognisable type layers they are hidden (the art layers render clean
  //    without them); a flat PDF renders exactly as designed, text included.
  //    pdfjs transfers (detaches) the buffer it is given and this function
  //    loads the document twice, so the render gets its own copy.
  const { png, width, height, scale, hiddenLayers } = await renderPdfPageToPng(data.slice(), pageNum, {
    hideTextLayers: true,
  });
  const storedPath = await objectStorageService.uploadBytes(png, "image/png");

  // 2. Always read the type: layered masters render it as live elements;
  //    flat masters carry it as kvText metadata so size adaptation can
  //    RE-SET the copy on each format's grid instead of cropping it.
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true });
  let blocks: TextBlock[] = [];
  try {
    const doc = await loadingTask.promise;
    const pdfPage = await doc.getPage(Math.min(Math.max(1, pageNum || 1), doc.numPages));
    const viewportTransform = pdfPage.getViewport({ scale: 1 }).transform as Matrix;
    let textFills: string[] = [];
    try {
      const opList = await pdfPage.getOperatorList();
      textFills = walkOperators(pdfjs, opList, viewportTransform, warnings).textFills;
    } catch {
      // colours become best-guess; not fatal
    }
    const content = await pdfPage.getTextContent();
    blocks = extractTextBlocks(content, viewportTransform, pdfjs, textFills);
  } catch {
    warnings.push("Text could not be read from this PDF; adaptations will crop the artwork as-is.");
  } finally {
    await loadingTask.destroy();
  }

  const distinctSizes = Array.from(new Set(blocks.map((b) => Math.round(b.fontSize)))).sort((a, b) => b - a);
  const rank = (size: number) => distinctSizes.indexOf(Math.round(size));
  const roleOf = (b: TextBlock) => {
    const r = rank(b.fontSize);
    return r === 0 ? "headline" : r === 1 ? "subhead" : "body";
  };

  // Focal point for cover crops: posters put copy in the lower band, so when
  // the headline sits in the lower half, the hero is the band above it.
  let focusY = 0.45;
  const headlineBlock = blocks.slice().sort((a, b) => b.fontSize - a.fontSize)[0];
  const pageH = height / scale;
  if (headlineBlock && headlineBlock.top > pageH * 0.45) {
    focusY = Math.max(0.2, headlineBlock.top / pageH / 2);
  }

  const kvText = blocks.map((b) => ({
    text: b.text,
    x: b.x * scale,
    y: b.top * scale,
    w: Math.max(1, (b.right - b.x) * scale),
    h: Math.max(b.fontSize, b.bottom - b.top) * scale,
    fontSize: Math.round(b.fontSize * scale),
    ...(b.color ? { color: b.color } : {}),
    role: roleOf(b),
  }));

  let textElements: Record<string, unknown>[] = [];
  if (hiddenLayers.length > 0) {
    textElements = blocks.map((b, i) => ({
      id: `txt_${i}`,
      type: "text",
      role: roleOf(b),
      text: b.text,
      x: b.x * scale,
      y: b.top * scale,
      w: Math.max(1, (b.right - b.x) * scale),
      h: Math.max(b.fontSize, b.bottom - b.top) * scale,
      fontSize: Math.round(b.fontSize * scale),
      fontWeight: b.bold || roleOf(b) === "headline" ? 700 : 400,
      color: b.color ?? "#111827",
      align: "left",
      lineHeight: 1.2,
      ...(b.fontFamily ? { fontFamily: b.fontFamily } : {}),
      ...(b.italic ? { fontStyle: "italic" } : {}),
    }));
    warnings.push(
      `Type layers (${hiddenLayers.join(", ")}) lifted off as live text — the artwork itself is untouched. Review fonts and colours before saving.`,
    );
  } else {
    warnings.push(
      "Imported as one faithful image — the artwork (text included) is never modified. Size adaptations re-set the copy, strapline and logo on each format's brand grid.",
    );
  }

  const config = normalizeFreeformConfig({
    kind: "freeform",
    elements: [
      {
        id: "kv_background",
        type: "image",
        role: "product",
        src: `/api/storage${storedPath}`,
        fit: "cover",
        x: 0,
        y: 0,
        w: width,
        h: height,
        locked: true,
        focusX: 0.5,
        focusY,
        ...(kvText.length > 0 ? { kvText } : {}),
      },
      ...textElements,
    ],
  });
  const snapped = snapConfigToPalette(config, paletteHexes);
  if (snapped > 0) {
    warnings.push(`${snapped} text colour(s) snapped to exact brand values.`);
  }

  return { name: "Recreated artwork", width, height, config, warnings };
}

export async function dissectPdfToTemplate(
  objectPath: string,
  page: number,
  paletteHexes: string[] = [],
  mode: DissectMode = "elements",
): Promise<DissectResult> {
  const file = await objectStorageService.getObjectEntityFile(objectPath);
  const response = await objectStorageService.downloadObject(file);
  const arrayBuffer = await response.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  if (mode === "keyVisual") {
    return renderKeyVisualTemplate(data, page, paletteHexes);
  }

  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true });
  const doc = await loadingTask.promise;
  const warnings: string[] = [];

  try {
    const pageNum = Math.min(Math.max(1, page || 1), doc.numPages);
    if (doc.numPages > 1) {
      warnings.push(`PDF has ${doc.numPages} pages; only page ${pageNum} was imported.`);
    }
    const pdfPage = await doc.getPage(pageNum);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const viewportTransform = viewport.transform as Matrix;
    const width = Math.round(viewport.width);
    const height = Math.round(viewport.height);

    // 1. Rects + image placements from the operator list.
    let rects: RawRect[] = [];
    let imagePlacements: ImagePlacement[] = [];
    let textFills: string[] = [];
    let opList: { fnArray: number[]; argsArray: unknown[][] } | null = null;
    try {
      opList = await pdfPage.getOperatorList();
      const walked = walkOperators(pdfjs, opList!, viewportTransform, warnings);
      rects = walked.rects;
      imagePlacements = walked.images;
      textFills = walked.textFills;
    } catch {
      warnings.push("Could not read vector graphics; rectangles and images may be missing.");
    }

    // 2. Resolve + encode images, upload to object storage.
    const imageElements: any[] = [];
    let imageFailures = 0;
    for (const placement of imagePlacements) {
      try {
        const img = await getImageObject(pdfPage, placement.objId);
        const pngBytes = encodeImageToPng(pdfjs, img);
        if (!pngBytes) {
          imageFailures++;
          continue;
        }
        const storedPath = await objectStorageService.uploadBytes(pngBytes, "image/png");
        imageElements.push({
          id: `img_${imageElements.length}`,
          type: "image",
          role: imageElements.length === 0 ? "product" : "decoration",
          src: `/api/storage${storedPath}`,
          x: placement.x,
          y: placement.y,
          w: placement.w,
          h: placement.h,
        });
      } catch {
        imageFailures++;
      }
    }
    if (imageFailures > 0) {
      warnings.push(`${imageFailures} image(s) could not be extracted and were skipped.`);
    }

    // 3. Text blocks + role inference.
    const content = await pdfPage.getTextContent();
    const blocks = extractTextBlocks(content, viewportTransform, pdfjs, textFills);

    const distinctSizes = Array.from(new Set(blocks.map((b) => Math.round(b.fontSize)))).sort((a, b) => b - a);
    const rank = (size: number) => distinctSizes.indexOf(Math.round(size));

    const isInsideRect = (b: TextBlock): RawRect | null => {
      const cx = (b.x + b.right) / 2;
      const cy = (b.top + b.bottom) / 2;
      for (const r of rects) {
        if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return r;
      }
      return null;
    };

    const textElements = blocks.map((b, i) => {
      const wordCount = b.text.split(/\s+/).filter(Boolean).length;
      const containing = isInsideRect(b);
      let role: string;
      let color: string;
      if (containing && wordCount <= 4) {
        role = "cta";
        color = b.color ?? (hexLuminance(containing.fill) < 140 ? "#ffffff" : "#111827");
      } else {
        const r = rank(b.fontSize);
        role = r === 0 ? "headline" : r === 1 ? "subhead" : "body";
        color = b.color ?? "#111827";
      }
      return {
        id: `txt_${i}`,
        type: "text",
        role,
        text: b.text,
        x: b.x,
        y: b.top,
        w: Math.max(1, b.right - b.x),
        h: Math.max(b.fontSize, b.bottom - b.top),
        fontSize: Math.round(b.fontSize),
        fontWeight: b.bold || role === "headline" || role === "cta" ? 700 : 400,
        color,
        align: "left",
        lineHeight: 1.2,
        ...(b.fontFamily ? { fontFamily: b.fontFamily } : {}),
        ...(b.italic ? { fontStyle: "italic" } : {}),
      };
    });

    if (textElements.length > 0) {
      warnings.push("Text colors and roles are best-guess — review and adjust before saving.");
    }
    if (textElements.length === 0 && imageElements.length === 0) {
      warnings.push("No editable text or images were found (the PDF may be a flat scanned image).");
    }

    // z-order: rects (back) -> images -> text (front).
    const rectElements = rects.map((r, i) => ({
      id: `rect_${i}`,
      type: "rect",
      fill: r.fill,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
    }));

    const config = normalizeFreeformConfig({
      kind: "freeform",
      elements: [...rectElements, ...imageElements, ...textElements],
    });

    const snappedCount = snapConfigToPalette(config, paletteHexes);
    if (snappedCount > 0) {
      warnings.push(
        `${snappedCount} colour(s) were close to the brand palette (print CMYK builds convert inexactly) and were snapped to the exact brand values.`,
      );
    }

    return { name: "Imported template", width, height, config, warnings };
  } finally {
    await loadingTask.destroy();
  }
}
