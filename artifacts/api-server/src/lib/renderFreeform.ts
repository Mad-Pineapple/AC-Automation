/**
 * Server-side rendering of freeform templates to static images and
 * print-ready PDFs.
 *
 * Mirrors the browser semantics of FreeformCanvas / freeform*Style in
 * artifacts/brand-studio/src/components/TemplateRenderer.tsx:
 *  - white page background, elements in array order (z-order), clipped to
 *    the page (overflow hidden);
 *  - rects: fill / radius / inset border (border-box) / CSS linear-gradient;
 *  - images: object-fit cover|contain with object-position from focusX/Y
 *    (default centre), radius, opacity; logos default to contain;
 *  - text: pre-wrap (explicit \n breaks + greedy word wrap at the box width,
 *    long words overflow rather than break), overflow visible, line-height
 *    as a unitless multiplier of font-size (default 1.2), alignment, opacity,
 *    letter-spacing, National 2 regular/bold (synthetic oblique for italic).
 *
 * Raster output uses @napi-rs/canvas. The PDF output keeps text and solid
 * rects as vectors (pdf-lib + the embedded National 2 via fontkit), embeds
 * photos at their native resolution, and rasterises only gradients.
 */
import { createCanvas, loadImage as canvasLoadImage, type SKRSContext2D, type Image } from "@napi-rs/canvas";
import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  cmyk,
  rgb,
  degrees,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  appendBezierCurve,
  closePath,
  clip,
  endPath,
  type Color,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import type { FreeformConfig, FreeformElement, FreeformImage, FreeformRect, FreeformText } from "./freeform";
import { rgbToCmyk } from "./colorAdapter";
import { loadNational2, hasFontFamily, NATIONAL2_FAMILY, type LoadedFont } from "./freeformFonts";
import { ensureBrandFontsRegistered } from "./brandFonts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ImageLoader = (src: string) => Promise<Buffer | null>;

export interface RasterOptions {
  /** Output pixel multiplier (1 = template px, 2 = retina). */
  scale?: number;
  /** Brand font family (first choice of the CSS font stack). Only used when
   * that family is registered with the canvas; otherwise National 2. */
  brandFontFamily?: string;
  loadImage: ImageLoader;
}

export interface JpegOptions extends RasterOptions {
  /** 1..100, default 90. */
  quality?: number;
}

export interface PdfOptions {
  /** Bleed added on every side, in millimetres (default 0). */
  bleedMm?: number;
  /** Draw crop (trim) marks outside the trim box (default false). */
  cropMarks?: boolean;
  /** Pixel density used to convert template px to points. When omitted,
   * 1 px = 1 pt (template px are treated as points, which is what print
   * templates >= 2000 px declare). */
  dpi?: number;
  /** Emit DeviceCMYK colours for vector fills and text (naive RGB->CMYK). */
  cmyk?: boolean;
  /** Effective-resolution threshold for image warnings (default 250). */
  minImageDpi?: number;
  brandFontFamily?: string;
  loadImage: ImageLoader;
  /** PDF metadata. */
  title?: string;
}

export interface PdfResult {
  pdf: Buffer;
  /** Non-fatal issues: low-resolution images, missing images, fonts
   * substituted for the PDF. */
  warnings: string[];
  /** Final page size in points (trim + bleed + mark margin). */
  pageWidthPt: number;
  pageHeightPt: number;
}

/** Templates at or above this size on either edge declare print dimensions. */
export const PRINT_PX_THRESHOLD = 2000;

export function isPrintTemplate(width: number, height: number): boolean {
  return width >= PRINT_PX_THRESHOLD || height >= PRINT_PX_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Colour parsing
// ---------------------------------------------------------------------------

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parse the colour forms normalizeFreeformConfig admits: #rgb, #rgba,
 * #rrggbb, #rrggbbaa, rgb(), rgba(). */
export function parseColor(input: string | undefined | null, fallback: Rgba = { r: 0, g: 0, b: 0, a: 1 }): Rgba {
  if (!input) return fallback;
  const s = input.trim();
  if (s.startsWith("#")) {
    const h = s.slice(1);
    if (h.length === 3 || h.length === 4) {
      const v = h.split("").map((c) => parseInt(c + c, 16));
      return { r: v[0], g: v[1], b: v[2], a: h.length === 4 ? v[3] / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    return fallback;
  }
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([0-9.]+)\s*)?\)$/i.exec(s);
  if (m) {
    return {
      r: Math.min(255, Number(m[1])),
      g: Math.min(255, Number(m[2])),
      b: Math.min(255, Number(m[3])),
      a: m[4] !== undefined ? Math.max(0, Math.min(1, Number(m[4]))) : 1,
    };
  }
  return fallback;
}

function cssRgba(c: Rgba, alphaMul = 1): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.max(0, Math.min(1, c.a * alphaMul))})`;
}

// ---------------------------------------------------------------------------
// Text layout (shared by raster + PDF so both wrap identically)
// ---------------------------------------------------------------------------

interface LaidOutLine {
  text: string;
  /** Advance width in px (letter-spacing included). */
  width: number;
  /** x offset from the element's left edge (after alignment). */
  dx: number;
  /** baseline y offset from the element's top edge. */
  baseline: number;
}

interface TextLayout {
  lines: LaidOutLine[];
  family: string;
  weight: 400 | 700;
  italic: boolean;
  fontSize: number;
  letterSpacing: number;
  lineHeightPx: number;
}

const measureCanvas = createCanvas(8, 8);
const measureCtx = measureCanvas.getContext("2d");

function canvasFontString(family: string, weight: number, italic: boolean, sizePx: number): string {
  return `${italic ? "italic" : "normal"} ${weight} ${sizePx}px "${family}"`;
}

/** Resolve the font family the browser would have used: the element's own
 * family when it's available, else the brand family when available, else
 * National 2 (which the brand stack always falls back to). */
function resolveFamily(el: FreeformText, brandFontFamily?: string): string {
  if (el.fontFamily && hasFontFamily(el.fontFamily)) return el.fontFamily;
  const brand = (brandFontFamily ?? "").trim();
  if (brand && hasFontFamily(brand)) return brand;
  return NATIONAL2_FAMILY;
}

function measureWidth(text: string, letterSpacing: number): number {
  if (text.length === 0) return 0;
  const w = measureCtx.measureText(text).width;
  // CSS letter-spacing adds after every character (including the last).
  return w + letterSpacing * Array.from(text).length;
}

/** Greedy word wrap matching CSS `white-space: pre-wrap; overflow-wrap:
 * normal`: explicit newlines always break, runs of spaces are preserved,
 * words wider than the box overflow on their own line, and trailing spaces
 * at a soft wrap hang (they don't count toward the width). */
function wrapParagraph(paragraph: string, maxWidth: number, letterSpacing: number): string[] {
  if (paragraph.length === 0) return [""];
  // Tokenise into words and whitespace runs so spaces survive intact.
  const tokens = paragraph.match(/\S+|\s+/g) ?? [];
  const lines: string[] = [];
  let current = "";
  for (const tok of tokens) {
    const isSpace = /^\s+$/.test(tok);
    if (isSpace) {
      current += tok; // hangs if it ends up trailing
      continue;
    }
    const candidate = current + tok;
    if (current.trimEnd().length === 0 || measureWidth(candidate, letterSpacing) <= maxWidth + 0.01) {
      current = candidate;
    } else {
      lines.push(current.trimEnd());
      current = tok;
    }
  }
  lines.push(current.trimEnd());
  return lines;
}

function layoutText(el: FreeformText, fonts: Record<400 | 700, LoadedFont>, brandFontFamily?: string): TextLayout {
  const family = resolveFamily(el, brandFontFamily);
  const weight: 400 | 700 = el.fontWeight === 700 ? 700 : 400;
  const italic = el.fontStyle === "italic";
  const fontSize = el.fontSize ?? 16;
  const letterSpacing = el.letterSpacing ?? 0;
  const lineHeightPx = (el.lineHeight ?? 1.2) * fontSize;

  measureCtx.font = canvasFontString(family, weight, italic, fontSize);

  // CSS centres the glyph content area (ascent + descent) inside the line box
  // and puts the baseline at the top of the descent: half-leading model.
  const m = fonts[weight].metrics;
  const ascentPx = (m.ascent / m.unitsPerEm) * fontSize;
  const descentPx = (m.descent / m.unitsPerEm) * fontSize;
  const halfLeading = (lineHeightPx - (ascentPx + descentPx)) / 2;

  const maxWidth = Math.max(0, el.w ?? 0);
  const lines: LaidOutLine[] = [];
  const paragraphs = (el.text ?? "").replace(/\r\n?/g, "\n").split("\n");
  for (const p of paragraphs) {
    for (const line of wrapParagraph(p, maxWidth, letterSpacing)) {
      const width = measureWidth(line, letterSpacing);
      const dx = el.align === "center" ? (maxWidth - width) / 2 : el.align === "right" ? maxWidth - width : 0;
      lines.push({ text: line, width, dx, baseline: lines.length * lineHeightPx + halfLeading + ascentPx });
    }
  }
  // InDesign auto-sized frames hug the cap height: the frame bottom IS the
  // first baseline. Shift the whole block so imported text sits exactly
  // where the designer put it, whatever the substituted metrics say.
  // (Only while it still fits one line — once adaptation re-wraps the copy,
  // the frame no longer hugs a single cap row and CSS layout is safer.)
  if (el.baselineFit === "cap" && lines.length === 1 && (el.h ?? 0) > 0) {
    lines[0].baseline = el.h as number;
  }
  return { lines, family, weight, italic, fontSize, letterSpacing, lineHeightPx };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ImagePlacement {
  /** Drawn image rect (may extend outside the box; the box clips it). */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

function imageFit(el: FreeformImage): "cover" | "contain" {
  if (el.fit === "cover" || el.fit === "contain") return el.fit;
  return el.role === "logo" ? "contain" : "cover";
}

/** object-fit + object-position: scale uniformly, then distribute the slack
 * by the focal percentage (CSS `object-position: X% Y%` semantics). */
function placeImage(box: Box, iw: number, ih: number, el: FreeformImage): ImagePlacement {
  const fit = imageFit(el);
  const s = fit === "cover" ? Math.max(box.w / iw, box.h / ih) : Math.min(box.w / iw, box.h / ih);
  const dw = iw * s;
  const dh = ih * s;
  const hasFocus = typeof el.focusX === "number" || typeof el.focusY === "number";
  const fx = hasFocus ? Math.round((el.focusX ?? 0.5) * 100) / 100 : 0.5;
  const fy = hasFocus ? Math.round((el.focusY ?? 0.5) * 100) / 100 : 0.5;
  return { dx: box.x + (box.w - dw) * fx, dy: box.y + (box.h - dh) * fy, dw, dh };
}

/** CSS linear-gradient geometry: 0deg points up, 90deg right; the gradient
 * line runs through the box centre with the length that makes the 0%/100%
 * stops touch the corners. */
function gradientLine(box: Box, angleDeg: number): { x0: number; y0: number; x1: number; y1: number } {
  const a = (((angleDeg % 360) + 360) % 360) * (Math.PI / 180);
  const dirX = Math.sin(a);
  const dirY = -Math.cos(a);
  const len = Math.abs(box.w * Math.sin(a)) + Math.abs(box.h * Math.cos(a));
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return {
    x0: cx - (dirX * len) / 2,
    y0: cy - (dirY * len) / 2,
    x1: cx + (dirX * len) / 2,
    y1: cy + (dirY * len) / 2,
  };
}

function clampRadius(box: Box, r: number | undefined): number {
  return Math.max(0, Math.min(r ?? 0, box.w / 2, box.h / 2));
}

// ---------------------------------------------------------------------------
// Image decoding (shared)
// ---------------------------------------------------------------------------

interface DecodedImage {
  bytes: Buffer;
  width: number;
  height: number;
  format: string;
}

function decodeDataUrl(src: string): Buffer | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(src);
  if (!m) return null;
  return m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
}

async function fetchImageBytes(src: string, loader: ImageLoader, cache: Map<string, Promise<DecodedImage | null>>): Promise<DecodedImage | null> {
  let p = cache.get(src);
  if (!p) {
    p = (async () => {
      const bytes = src.startsWith("data:") ? decodeDataUrl(src) : await loader(src);
      if (!bytes || bytes.length === 0) return null;
      try {
        const meta = await sharp(bytes).metadata();
        if (!meta.width || !meta.height) return null;
        return { bytes, width: meta.width, height: meta.height, format: meta.format ?? "unknown" };
      } catch {
        return null;
      }
    })();
    cache.set(src, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Canvas rendering
// ---------------------------------------------------------------------------

function roundRectPath(ctx: SKRSContext2D, box: Box, r: number) {
  ctx.beginPath();
  if (r > 0) ctx.roundRect(box.x, box.y, box.w, box.h, r);
  else ctx.rect(box.x, box.y, box.w, box.h);
}

function drawRectCanvas(ctx: SKRSContext2D, el: FreeformRect) {
  const box: Box = { x: el.x, y: el.y, w: el.w, h: el.h };
  if (box.w <= 0 || box.h <= 0) return;
  const r = clampRadius(box, el.radius);
  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  roundRectPath(ctx, box, r);
  const grad = el.gradient;
  if (grad && grad.stops.length >= 2) {
    const line = gradientLine(box, grad.angle);
    const g = ctx.createLinearGradient(line.x0, line.y0, line.x1, line.y1);
    for (const s of grad.stops) {
      const c = parseColor(s.color);
      g.addColorStop(Math.max(0, Math.min(1, s.at)), cssRgba({ ...c, a: 1 }, s.alpha));
    }
    ctx.fillStyle = g;
    ctx.fill();
  } else {
    ctx.fillStyle = cssRgba(parseColor(el.fill, { r: 255, g: 255, b: 255, a: 1 }));
    ctx.fill();
    if (el.borderWidth && el.borderWidth > 0) {
      // CSS border-box: the stroke sits entirely inside the box.
      const bw = Math.min(el.borderWidth, box.w / 2, box.h / 2);
      ctx.save();
      ctx.clip();
      ctx.lineWidth = bw * 2;
      ctx.strokeStyle = cssRgba(parseColor(el.borderColor ?? "#000000"));
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

async function drawImageCanvas(ctx: SKRSContext2D, el: FreeformImage, img: DecodedImage) {
  const box: Box = { x: el.x, y: el.y, w: el.w, h: el.h };
  if (box.w <= 0 || box.h <= 0) return;
  let bitmap: Image;
  try {
    bitmap = await canvasLoadImage(img.bytes);
  } catch {
    // Formats skia can't decode directly (e.g. some webp/avif): go via sharp.
    bitmap = await canvasLoadImage(await sharp(img.bytes).png().toBuffer());
  }
  const { dx, dy, dw, dh } = placeImage(box, img.width, img.height, el);
  // A large reduction (a 1350px anther drawn 150px wide) is resampled
  // properly first: the canvas's own scaling skips pixels at that ratio and
  // left shaped pictures with a ragged rim and broken keylines.
  if (dw > 0 && dh > 0 && dw / Math.max(1, img.width) < 0.6) {
    try { bitmap = await canvasLoadImage(await sharp(img.bytes).resize(Math.max(1, Math.round(dw)), Math.max(1, Math.round(dh)), { fit: "fill", kernel: "lanczos3" }).png().toBuffer()); } catch { /* keep the original bitmap */ }
  }
  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  roundRectPath(ctx, box, clampRadius(box, el.radius));
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, dx, dy, dw, dh);
  ctx.restore();
}

function drawTextCanvas(ctx: SKRSContext2D, el: FreeformText, layout: TextLayout) {
  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  ctx.fillStyle = cssRgba(parseColor(el.color, { r: 0x11, g: 0x18, b: 0x27, a: 1 }));
  ctx.font = canvasFontString(layout.family, layout.weight, layout.italic, layout.fontSize);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (const line of layout.lines) {
    if (!line.text) continue;
    const x = el.x + line.dx;
    const y = el.y + line.baseline;
    if (layout.letterSpacing) {
      let cx = x;
      for (const ch of Array.from(line.text)) {
        ctx.fillText(ch, cx, y);
        cx += ctx.measureText(ch).width + layout.letterSpacing;
      }
    } else {
      ctx.fillText(line.text, x, y);
    }
  }
  ctx.restore();
}

async function renderToCanvas(config: FreeformConfig, width: number, height: number, opts: RasterOptions) {
  const fonts = await loadNational2();
  await ensureBrandFontsRegistered();
  const scale = Math.max(0.05, Math.min(8, opts.scale ?? 1));
  const canvas = createCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  const cache = new Map<string, Promise<DecodedImage | null>>();
  for (const el of config.elements) {
    if (el.type === "rect") {
      drawRectCanvas(ctx, el);
    } else if (el.type === "image") {
      if (!el.src) continue;
      const img = await fetchImageBytes(el.src, opts.loadImage, cache);
      if (img) await drawImageCanvas(ctx, el, img);
    } else if (el.type === "text") {
      if (!el.text || !el.text.trim()) continue;
      drawTextCanvas(ctx, el, layoutText(el, fonts, opts.brandFontFamily));
    }
  }
  return canvas;
}

export async function renderFreeformToPng(config: FreeformConfig, width: number, height: number, opts: RasterOptions): Promise<Buffer> {
  const canvas = await renderToCanvas(config, width, height, opts);
  return canvas.encode("png");
}

export async function renderFreeformToJpeg(config: FreeformConfig, width: number, height: number, opts: JpegOptions): Promise<Buffer> {
  const canvas = await renderToCanvas(config, width, height, opts);
  const quality = Math.max(1, Math.min(100, Math.round(opts.quality ?? 90)));
  return canvas.encode("jpeg", quality);
}

// ---------------------------------------------------------------------------
// PDF rendering
// ---------------------------------------------------------------------------

const MM_TO_PT = 72 / 25.4;
const CROP_MARK_LEN_MM = 4;
const CROP_MARK_GAP_MM = 2;
const GRADIENT_RASTER_DPI = 300;

interface PdfCtx {
  doc: PDFDocument;
  page: PDFPage;
  /** Points per template px. */
  k: number;
  /** Offset of the trim box's top-left corner from the page's top-left, pt. */
  ox: number;
  oy: number;
  pageH: number;
  cmyk: boolean;
  fonts: Record<400 | 700, LoadedFont>;
  pdfFonts: Record<400 | 700, PDFFont>;
  warnings: string[];
  /** Trim size in template px. */
  width: number;
  height: number;
  /** Bleed in template px. */
  bleedPx: number;
  imageCache: Map<string, Promise<DecodedImage | null>>;
  embedCache: Map<string, Promise<PDFImage | null>>;
  loadImage: ImageLoader;
}

function pdfColor(c: Rgba, useCmyk: boolean): Color {
  if (useCmyk) {
    const v = rgbToCmyk({ r: c.r, g: c.g, b: c.b });
    return cmyk(v.c / 100, v.m / 100, v.y / 100, v.k / 100);
  }
  return rgb(c.r / 255, c.g / 255, c.b / 255);
}

/** Template px (top-left origin) -> page points (bottom-left origin). */
function toPage(ctx: PdfCtx, x: number, y: number): { x: number; y: number } {
  return { x: ctx.ox + x * ctx.k, y: ctx.pageH - (ctx.oy + y * ctx.k) };
}

/** Rounded-rect path operators in page space for a box given in template px
 * (the box's top-left corner is at template (x, y)). */
function roundedRectOps(ctx: PdfCtx, box: Box, rPx: number) {
  const tl = toPage(ctx, box.x, box.y);
  const w = box.w * ctx.k;
  const h = box.h * ctx.k;
  const r = rPx * ctx.k;
  const x0 = tl.x;
  const y1 = tl.y; // top
  const x1 = x0 + w;
  const y0 = y1 - h; // bottom
  if (r <= 0) {
    return [moveTo(x0, y0), lineTo(x1, y0), lineTo(x1, y1), lineTo(x0, y1), closePath()];
  }
  const c = r * 0.5523; // cubic approximation of a quarter circle
  return [
    moveTo(x0 + r, y0),
    lineTo(x1 - r, y0),
    appendBezierCurve(x1 - r + c, y0, x1, y0 + r - c, x1, y0 + r),
    lineTo(x1, y1 - r),
    appendBezierCurve(x1, y1 - r + c, x1 - r + c, y1, x1 - r, y1),
    lineTo(x0 + r, y1),
    appendBezierCurve(x0 + r - c, y1, x0, y1 - r + c, x0, y1 - r),
    lineTo(x0, y0 + r),
    appendBezierCurve(x0, y0 + r - c, x0 + r - c, y0, x0 + r, y0),
    closePath(),
  ];
}

/** Rounded-rect as an SVG path (top-down coords, relative to its own origin)
 * for pdf-lib's drawSvgPath. */
function roundedRectSvg(w: number, h: number, r: number): string {
  if (r <= 0) return `M0 0 H${w} V${h} H0 Z`;
  return `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w} ${r} V${h - r} A${r} ${r} 0 0 1 ${w - r} ${h} H${r} A${r} ${r} 0 0 1 0 ${h - r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`;
}

/** Elements that touch a trim edge are extended into the bleed so the page
 * has no white hairline after trimming. */
function bleedExtendedBox(ctx: PdfCtx, el: FreeformElement): Box {
  const box: Box = { x: el.x, y: el.y, w: el.w, h: el.h };
  const b = ctx.bleedPx;
  if (b <= 0 || el.type === "text") return box;
  const EDGE = 1.5;
  if (box.x <= EDGE) {
    box.w += box.x + b;
    box.x = -b;
  }
  if (box.y <= EDGE) {
    box.h += box.y + b;
    box.y = -b;
  }
  if (el.x + el.w >= ctx.width - EDGE) box.w = ctx.width + b - box.x;
  if (el.y + el.h >= ctx.height - EDGE) box.h = ctx.height + b - box.y;
  return box;
}

async function drawRectPdf(ctx: PdfCtx, el: FreeformRect): Promise<void> {
  const box = bleedExtendedBox(ctx, el);
  if (box.w <= 0 || box.h <= 0) return;
  const r = clampRadius(box, el.radius);
  const opacity = el.opacity ?? 1;
  const grad = el.gradient;
  if (grad && grad.stops.length >= 2) {
    await drawGradientPdf(ctx, el, box, r);
    return;
  }
  const fill = parseColor(el.fill, { r: 255, g: 255, b: 255, a: 1 });
  const tl = toPage(ctx, box.x, box.y);
  ctx.page.drawSvgPath(roundedRectSvg(box.w * ctx.k, box.h * ctx.k, r * ctx.k), {
    x: tl.x,
    y: tl.y,
    color: pdfColor(fill, ctx.cmyk),
    opacity: opacity * fill.a,
    borderWidth: 0,
  });
  if (el.borderWidth && el.borderWidth > 0) {
    const bw = Math.min(el.borderWidth, box.w / 2, box.h / 2);
    const bc = parseColor(el.borderColor ?? "#000000");
    // Inset stroke: clip to the box and stroke a 2*bw path along its edge.
    ctx.page.pushOperators(pushGraphicsState(), ...roundedRectOps(ctx, box, r), clip(), endPath());
    ctx.page.drawSvgPath(roundedRectSvg(box.w * ctx.k, box.h * ctx.k, r * ctx.k), {
      x: tl.x,
      y: tl.y,
      borderColor: pdfColor(bc, ctx.cmyk),
      borderWidth: bw * 2 * ctx.k,
      borderOpacity: opacity * bc.a,
    });
    ctx.page.pushOperators(popGraphicsState());
  }
}

/** Gradients have no clean vector equivalent across PDF viewers' CMYK
 * handling, so render the rect on a canvas at print resolution and embed
 * the result as a PNG with alpha. */
async function drawGradientPdf(ctx: PdfCtx, el: FreeformRect, box: Box, r: number): Promise<void> {
  const pxPerTemplatePx = Math.max(1, (GRADIENT_RASTER_DPI / 72) * ctx.k);
  const cw = Math.max(1, Math.min(8000, Math.round(box.w * pxPerTemplatePx)));
  const ch = Math.max(1, Math.min(8000, Math.round(box.h * pxPerTemplatePx)));
  const canvas = createCanvas(cw, ch);
  const c2d = canvas.getContext("2d");
  c2d.scale(cw / box.w, ch / box.h);
  drawRectCanvas(c2d, { ...el, x: 0, y: 0, w: box.w, h: box.h, opacity: 1 });
  // Corner radius is baked into the raster (drawRectCanvas clips to it).
  void r;
  const img = await ctx.doc.embedPng(await canvas.encode("png"));
  const bl = toPage(ctx, box.x, box.y + box.h);
  ctx.page.drawImage(img, { x: bl.x, y: bl.y, width: box.w * ctx.k, height: box.h * ctx.k, opacity: el.opacity ?? 1 });
}

async function embedImagePdf(ctx: PdfCtx, src: string, img: DecodedImage): Promise<PDFImage | null> {
  let p = ctx.embedCache.get(src);
  if (!p) {
    p = (async () => {
      try {
        if (img.format === "jpeg") return await ctx.doc.embedJpg(img.bytes);
        if (img.format === "png") return await ctx.doc.embedPng(img.bytes);
        // Anything else (webp, gif, tiff, svg, avif) -> lossless PNG.
        return await ctx.doc.embedPng(await sharp(img.bytes).png().toBuffer());
      } catch (err) {
        ctx.warnings.push(`Image ${src} could not be embedded: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    })();
    ctx.embedCache.set(src, p);
  }
  return p;
}

async function drawImagePdf(ctx: PdfCtx, el: FreeformImage, minImageDpi: number) {
  if (!el.src) return;
  const box = bleedExtendedBox(ctx, el);
  if (box.w <= 0 || box.h <= 0) return;
  const decoded = await fetchImageBytes(el.src, ctx.loadImage, ctx.imageCache);
  if (!decoded) {
    ctx.warnings.push(`Image ${el.id} (${el.src.slice(0, 80)}) could not be loaded and was skipped`);
    return;
  }
  const embedded = await embedImagePdf(ctx, el.src, decoded);
  if (!embedded) return;
  const { dx, dy, dw, dh } = placeImage(box, decoded.width, decoded.height, el);

  // Effective resolution: source pixels per inch at the drawn size.
  const drawnWidthIn = (dw * ctx.k) / 72;
  const effDpi = drawnWidthIn > 0 ? decoded.width / drawnWidthIn : Infinity;
  if (effDpi < minImageDpi) {
    ctx.warnings.push(
      `Image ${el.id} (${decoded.width}×${decoded.height}px) renders at ~${Math.round(effDpi)} dpi at print size (below ${minImageDpi} dpi)`,
    );
  }

  ctx.page.pushOperators(pushGraphicsState(), ...roundedRectOps(ctx, box, clampRadius(box, el.radius)), clip(), endPath());
  const bl = toPage(ctx, dx, dy + dh);
  ctx.page.drawImage(embedded, { x: bl.x, y: bl.y, width: dw * ctx.k, height: dh * ctx.k, opacity: el.opacity ?? 1 });
  ctx.page.pushOperators(popGraphicsState());
}

function drawTextPdf(ctx: PdfCtx, el: FreeformText, layout: TextLayout) {
  const font = ctx.pdfFonts[layout.weight];
  const color = parseColor(el.color, { r: 0x11, g: 0x18, b: 0x27, a: 1 });
  const opacity = (el.opacity ?? 1) * color.a;
  const size = layout.fontSize * ctx.k;
  for (const line of layout.lines) {
    if (!line.text) continue;
    const p = toPage(ctx, el.x + line.dx, el.y + line.baseline);
    const common = {
      y: p.y,
      size,
      font,
      color: pdfColor(color, ctx.cmyk),
      opacity,
      ...(layout.italic ? { xSkew: degrees(12) } : {}),
    };
    if (layout.letterSpacing) {
      let cx = p.x;
      for (const ch of Array.from(line.text)) {
        ctx.page.drawText(ch, { ...common, x: cx });
        cx += font.widthOfTextAtSize(ch, size) + layout.letterSpacing * ctx.k;
      }
    } else {
      ctx.page.drawText(line.text, { ...common, x: p.x });
    }
  }
}

function drawCropMarks(ctx: PdfCtx, trim: { x: number; y: number; w: number; h: number }, bleedPt: number) {
  const len = CROP_MARK_LEN_MM * MM_TO_PT;
  const gap = Math.max(bleedPt, CROP_MARK_GAP_MM * MM_TO_PT);
  const color = ctx.cmyk ? cmyk(1, 1, 1, 1) : rgb(0, 0, 0); // registration black
  const thickness = 0.25;
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    ctx.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
  const xs = [trim.x, trim.x + trim.w];
  const ys = [trim.y, trim.y + trim.h];
  for (const x of xs) {
    // vertical marks above and below the trim box
    line(x, trim.y - gap, x, trim.y - gap - len);
    line(x, trim.y + trim.h + gap, x, trim.y + trim.h + gap + len);
  }
  for (const y of ys) {
    // horizontal marks left and right of the trim box
    line(trim.x - gap, y, trim.x - gap - len, y);
    line(trim.x + trim.w + gap, y, trim.x + trim.w + gap + len, y);
  }
}

export async function renderFreeformToPdf(config: FreeformConfig, width: number, height: number, opts: PdfOptions): Promise<PdfResult> {
  const fonts = await loadNational2();
  await ensureBrandFontsRegistered();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  if (opts.title) doc.setTitle(opts.title);
  doc.setProducer("Brand Creative Studio");
  doc.setCreator("Brand Creative Studio freeform renderer");

  const pdfFonts: Record<400 | 700, PDFFont> = {
    400: await doc.embedFont(fonts[400].sfnt, { subset: true }),
    700: await doc.embedFont(fonts[700].sfnt, { subset: true }),
  };

  // Points per template px: explicit dpi wins; otherwise px are points
  // (print templates >= 2000px declare their size in points, and digital
  // sizes map 1:1 at 72dpi).
  const k = opts.dpi && opts.dpi > 0 ? 72 / opts.dpi : 1;
  const bleedPt = Math.max(0, opts.bleedMm ?? 0) * MM_TO_PT;
  const markMarginPt = opts.cropMarks ? (CROP_MARK_LEN_MM + CROP_MARK_GAP_MM) * MM_TO_PT + Math.max(0, bleedPt - CROP_MARK_GAP_MM * MM_TO_PT) : 0;
  const marginPt = Math.max(bleedPt, markMarginPt);
  const trimW = width * k;
  const trimH = height * k;
  const pageW = trimW + 2 * marginPt;
  const pageH = trimH + 2 * marginPt;

  const page = doc.addPage([pageW, pageH]);
  // Trim/bleed boxes for prepress (bottom-left origin).
  page.setTrimBox(marginPt, marginPt, trimW, trimH);
  page.setBleedBox(marginPt - bleedPt, marginPt - bleedPt, trimW + 2 * bleedPt, trimH + 2 * bleedPt);
  page.setArtBox(marginPt, marginPt, trimW, trimH);
  page.setMediaBox(0, 0, pageW, pageH);

  const warnings: string[] = [];
  const ctx: PdfCtx = {
    doc,
    page,
    k,
    ox: marginPt,
    oy: marginPt,
    pageH,
    cmyk: !!opts.cmyk,
    fonts,
    pdfFonts,
    warnings,
    width,
    height,
    bleedPx: bleedPt / k,
    imageCache: new Map(),
    embedCache: new Map(),
    loadImage: opts.loadImage,
  };

  // Everything inside the bleed box is clipped there (the browser clips at
  // the trim; with bleed we let artwork run to the bleed edge and no further).
  const bleedBox: Box = { x: -ctx.bleedPx, y: -ctx.bleedPx, w: width + 2 * ctx.bleedPx, h: height + 2 * ctx.bleedPx };
  page.pushOperators(pushGraphicsState(), ...roundedRectOps(ctx, bleedBox, 0), clip(), endPath());

  // White page background (matches FreeformCanvas).
  {
    const tl = toPage(ctx, bleedBox.x, bleedBox.y);
    page.drawRectangle({
      x: tl.x,
      y: tl.y - bleedBox.h * k,
      width: bleedBox.w * k,
      height: bleedBox.h * k,
      color: ctx.cmyk ? cmyk(0, 0, 0, 0) : rgb(1, 1, 1),
    });
  }

  for (const el of config.elements) {
    if (el.type === "rect") {
      await drawRectPdf(ctx, el);
    } else if (el.type === "image") {
      await drawImagePdf(ctx, el, opts.minImageDpi ?? 250);
    } else if (el.type === "text") {
      if (!el.text || !el.text.trim()) continue;
      const layout = layoutText(el, fonts, opts.brandFontFamily);
      if (layout.family !== NATIONAL2_FAMILY) {
        warnings.push(`Text ${el.id} uses "${layout.family}" on screen; the PDF substitutes National 2 (only embedded font)`);
      }
      drawTextPdf(ctx, el, layout);
    }
  }
  page.pushOperators(popGraphicsState());

  if (opts.cropMarks) {
    drawCropMarks(ctx, { x: marginPt, y: marginPt, w: trimW, h: trimH }, bleedPt);
  }

  // Flag the output intent-ish detail in the metadata for operators.
  doc.setSubject(
    `${width}×${height}px · ${opts.cmyk ? "CMYK (naive RGB conversion)" : "RGB"} · bleed ${opts.bleedMm ?? 0}mm${opts.cropMarks ? " · crop marks" : ""}`,
  );
  const pdf = Buffer.from(await doc.save({ useObjectStreams: false }));
  return { pdf, warnings, pageWidthPt: pageW, pageHeightPt: pageH };
}
