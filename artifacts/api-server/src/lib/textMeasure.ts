/**
 * Real text measurement for layout decisions.
 *
 * The adapt engines used to estimate copy width with a fixed glyph advance
 * (0.52em here, 0.58em there) and shipped whatever the estimate produced.
 * The server renderer already has the real fonts registered with
 * @napi-rs/canvas; this module exposes that measurement to the layout
 * solver so a headline is sized to the pixels it will actually occupy, and
 * shrinks to fit instead of overflowing.
 *
 * Wrapping mirrors renderFreeform.ts / FreeformCanvas: greedy word wrap at
 * the box width, explicit newlines always break, long words overflow on
 * their own line.
 */
import { createCanvas } from "@napi-rs/canvas";
import { loadNational2, hasFontFamily, NATIONAL2_FAMILY } from "./freeformFonts";

const canvas = createCanvas(4, 4);
const ctx = canvas.getContext("2d");

let fontsReady = false;

/** Load the brand fonts once. Safe to call repeatedly; never throws (a
 * missing font file degrades to the estimate below). */
export async function prepareMeasurement(): Promise<void> {
  if (fontsReady) return;
  try {
    await loadNational2();
    fontsReady = true;
  } catch {
    fontsReady = false;
  }
}

export interface FontSpec {
  family?: string;
  weight?: 400 | 700;
  italic?: boolean;
  letterSpacing?: number;
}

export function resolveFamily(family?: string): string {
  if (family && hasFontFamily(family)) return family;
  return NATIONAL2_FAMILY;
}

export interface FontResolution {
  /** Family the layout asked for, when it named one. */
  requested?: string;
  /** Family the measurement actually used. */
  used: string;
  /** The requested family is not registered, so widths came from another face. */
  substituted: boolean;
  /** No font at all is registered: widths are a 0.55em estimate. */
  estimated: boolean;
}

/** What a measurement of `spec` would really be measured with. Engines read
 *  this to warn when a headline set in DS-Digital was measured in National 2
 *  (the export then draws the real face and the width differs). */
export function fontResolution(spec: FontSpec): FontResolution {
  const used = resolveFamily(spec.family);
  const substituted = !!spec.family && spec.family !== used;
  const estimated = !fontsReady && !hasFontFamily(used);
  return { requested: spec.family, used, substituted, estimated };
}

let warnedEstimate = false;

function setFont(spec: FontSpec, sizePx: number): void {
  const fam = resolveFamily(spec.family);
  ctx.font = `${spec.italic ? "italic" : "normal"} ${spec.weight ?? 400} ${sizePx}px "${fam}"`;
}

/** Advance width of a single line in px at `sizePx`. Falls back to a 0.55em
 * estimate when no font is registered (tests, hosts without fonts). */
export function measureLine(text: string, spec: FontSpec, sizePx: number): number {
  if (text.length === 0) return 0;
  const ls = (spec.letterSpacing ?? 0) * Array.from(text).length;
  if (!fontsReady && !hasFontFamily(resolveFamily(spec.family))) {
    if (!warnedEstimate) {
      warnedEstimate = true;
      console.warn("[textMeasure] no font registered: copy widths are a 0.55em estimate and layouts will not match the export. Set FREEFORM_FONT_DIR or ship the fonts with the server.");
    }
    return text.length * sizePx * 0.55 + ls;
  }
  setFont(spec, sizePx);
  return ctx.measureText(text).width + ls;
}

/** Greedy wrap of one paragraph (no explicit newlines) at `maxWidth`. */
function wrapParagraph(paragraph: string, maxWidth: number, spec: FontSpec, sizePx: number): string[] {
  const words = paragraph.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || measureLine(candidate, spec, sizePx) <= maxWidth + 0.01) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

/** Cap height in px for the resolved font (actual glyph bounds of "H"),
 *  falling back to 0.7em when the canvas cannot report bounds. */
export function capHeightPx(spec: FontSpec, sizePx: number): number {
  const fam = resolveFamily(spec.family);
  ctx.font = `${spec.italic ? "italic" : "normal"} ${spec.weight ?? 400} ${sizePx}px "${fam}"`;
  const m = ctx.measureText("H") as unknown as { actualBoundingBoxAscent?: number };
  const asc = m.actualBoundingBoxAscent;
  return Number.isFinite(asc) && (asc as number) > 0 ? (asc as number) : sizePx * 0.7;
}

export function wrapText(text: string, maxWidth: number, spec: FontSpec, sizePx: number): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((p) => wrapParagraph(p, maxWidth, spec, sizePx));
}

export interface FitOptions extends FontSpec {
  minSize: number;
  maxSize: number;
  lineHeight?: number;
  /** Hard cap on wrapped lines; the size shrinks until the copy fits. */
  maxLines?: number;
}

export interface FitResult {
  fontSize: number;
  lines: string[];
  /** Widest line in px. */
  width: number;
  /** Block height in px (lines × line height). */
  height: number;
  /** False when even `minSize` cannot satisfy the box — copy will overflow. */
  fits: boolean;
}

/** Largest font size in [minSize, maxSize] at which `text` wraps into the
 * box (w × h) within `maxLines`. Binary search on integer sizes. */
export function fitText(text: string, box: { w: number; h: number }, opts: FitOptions): FitResult {
  const lh = opts.lineHeight ?? 1.15;
  const lo0 = Math.max(1, Math.floor(opts.minSize));
  const hi0 = Math.max(lo0, Math.floor(opts.maxSize));
  const evaluate = (size: number) => {
    const lines = wrapText(text, box.w, opts, size);
    const width = Math.max(...lines.map((l) => measureLine(l, opts, size)), 0);
    const height = lines.length * size * lh;
    const ok = width <= box.w + 0.01 && height <= box.h + 0.01 && (opts.maxLines === undefined || lines.length <= opts.maxLines);
    return { size, lines, width, height, ok };
  };
  let lo = lo0;
  let hi = hi0;
  let best = evaluate(lo0);
  if (best.ok) {
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const r = evaluate(mid);
      if (r.ok) {
        best = r;
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
  }
  return { fontSize: best.size, lines: best.lines, width: best.width, height: best.height, fits: best.ok };
}
