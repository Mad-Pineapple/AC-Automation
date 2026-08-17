/**
 * Freeform template layout: the data model + a defensive sanitizer.
 *
 * A freeform template stores its layout as a list of absolutely-positioned
 * elements (text / image / rect) inside the existing `templates.config` JSON
 * column, discriminated by `kind: "freeform"`. Coordinates use a top-left
 * origin with 1 unit == 1 px, relative to the template's width/height.
 *
 * Both the PDF dissection pipeline and the templates create/update routes run
 * untrusted-ish input through `normalizeFreeformConfig` so colors, sizes and
 * src URLs are bounded before they ever reach a React `style` attribute.
 */

export type TextRole = "headline" | "subhead" | "body" | "cta" | "other";
export type ImageRole = "product" | "logo" | "decoration";

export interface FreeformBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Locked elements are pinned brand furniture (logo, strapline, margins):
   * role-based copy/imagery substitution skips them and editors treat them
   * as read-only. Only admins edit templates, so setting the flag is
   * implicitly admin-gated.
   */
  locked?: boolean;
}

export interface FreeformText extends FreeformBase {
  type: "text";
  role: TextRole;
  text: string;
  fontSize: number;
  fontWeight: 400 | 700;
  color: string;
  align: "left" | "center" | "right";
  lineHeight?: number;
  fontFamily?: string;
  fontStyle?: "normal" | "italic";
  letterSpacing?: number;
  opacity?: number;
}

/** A baked-in text block captured from an imported key visual: carried as
 * metadata (never rendered) so size adaptation can re-set the copy on each
 * format's grid instead of cropping it. Coordinates in template px. */
export interface KvTextBlock {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  color?: string;
  role?: string;
}

export interface FreeformImage extends FreeformBase {
  type: "image";
  role: ImageRole;
  src: string | null;
  fit?: "cover" | "contain";
  radius?: number;
  opacity?: number;
  /** 0..1 focal point for cover crops (drives CSS object-position). */
  focusX?: number;
  focusY?: number;
  /** Key-visual metadata: source text blocks lifted at import. */
  kvText?: KvTextBlock[];
}

export interface FreeformRect extends FreeformBase {
  type: "rect";
  fill: string;
  radius?: number;
  borderColor?: string;
  borderWidth?: number;
  opacity?: number;
}

export type FreeformElement = FreeformText | FreeformImage | FreeformRect;

export interface FreeformConfig {
  kind: "freeform";
  elements: FreeformElement[];
}

const MAX_ELEMENTS = 200;
const MAX_TEXT_LEN = 2000;
const MAX_SRC_LEN = 2048;

const SAFE_COLOR =
  /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\))$/;

const TEXT_ROLES: TextRole[] = ["headline", "subhead", "body", "cta", "other"];
const IMAGE_ROLES: ImageRole[] = ["product", "logo", "decoration"];

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeColor(v: unknown, fallback: string): string {
  return typeof v === "string" && SAFE_COLOR.test(v.trim()) ? v.trim() : fallback;
}

function sanitizeSrc(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, MAX_SRC_LEN);
  if (/^(https?:\/\/|\/|data:image\/)/i.test(s)) return s;
  return null;
}

// fontFamily lands in a React `style` attribute, so whitelist it tightly to
// avoid CSS injection (no parens, semicolons, braces or angle brackets).
const SAFE_FONT_FAMILY = /^[\w\s,'-]{1,100}$/;

function sanitizeFontFamily(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 && SAFE_FONT_FAMILY.test(s) ? s : undefined;
}

function clampOpacity(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(1, n));
}

let idCounter = 0;
function ensureId(v: unknown): string {
  if (typeof v === "string" && v.length > 0 && v.length <= 64) return v;
  return `el_${Date.now().toString(36)}_${idCounter++}`;
}

function isFreeformConfigShape(v: unknown): v is { kind?: unknown; elements?: unknown } {
  return typeof v === "object" && v !== null;
}

export function isFreeformConfig(v: unknown): boolean {
  return isFreeformConfigShape(v) && (v as { kind?: unknown }).kind === "freeform";
}

/**
 * Adapt a freeform master layout to a new canvas size (the "Adaptation
 * Studio" pattern): one designed master yields per-format layouts a designer
 * then fine-tunes, instead of rebuilding each size from scratch.
 *
 * Deterministic heuristics, no AI:
 * - Backgrounds (elements covering ~the whole master) stretch to the new
 *   full bleed.
 * - Everything else keeps its size relative to the canvas (min-ratio scale)
 *   and re-anchors per axis: elements near an edge keep their scaled margin
 *   to that edge, centred elements stay proportionally centred. This is what
 *   keeps a bottom-right logo bottom-right in every format.
 * - Elements fully inside the master stay fully inside the target; elements
 *   that deliberately bled off-canvas keep bleeding.
 * - `locked` flags survive, so pinned brand furniture stays pinned.
 */
export function adaptFreeformConfig(
  master: FreeformConfig,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): FreeformConfig {
  const scale = Math.min(dstW / srcW, dstH / srcH);

  const adaptAxis = (
    pos: number,
    size: number,
    srcLen: number,
    dstLen: number,
    newSize: number,
  ): number => {
    const centre = pos + size / 2;
    if (centre < srcLen / 3) {
      return Math.round(pos * scale); // near the leading edge: keep scaled margin
    }
    if (centre > (2 * srcLen) / 3) {
      return Math.round(dstLen - (srcLen - pos - size) * scale - newSize); // trailing edge
    }
    return Math.round((centre / srcLen) * dstLen - newSize / 2); // centred band
  };

  const elements = master.elements.map((el) => {
    // Full-bleed backgrounds restretch rather than scale-and-anchor.
    if (el.w >= srcW * 0.9 && el.h >= srcH * 0.9) {
      return { ...el, x: 0, y: 0, w: dstW, h: dstH };
    }

    const w = Math.max(1, Math.round(el.w * scale));
    const h = Math.max(1, Math.round(el.h * scale));
    let x = adaptAxis(el.x, el.w, srcW, dstW, w);
    let y = adaptAxis(el.y, el.h, srcH, dstH, h);

    // Preserve containment, but only where the master was contained — bleed
    // is a design choice.
    if (el.x >= 0 && el.x + el.w <= srcW) x = Math.min(Math.max(x, 0), Math.max(0, dstW - w));
    if (el.y >= 0 && el.y + el.h <= srcH) y = Math.min(Math.max(y, 0), Math.max(0, dstH - h));

    if (el.type === "text") {
      return {
        ...el,
        x, y, w, h,
        fontSize: Math.max(6, Math.round(el.fontSize * scale)),
        ...(el.letterSpacing !== undefined ? { letterSpacing: el.letterSpacing * scale } : {}),
      };
    }
    return { ...el, x, y, w, h };
  });

  return { kind: "freeform", elements };
}

/**
 * Coerce arbitrary input into a safe FreeformConfig. Invalid elements are
 * dropped rather than throwing, so a partially-bad payload still yields a
 * usable template.
 */
export function normalizeFreeformConfig(raw: unknown): FreeformConfig {
  const rawElements: unknown[] = isFreeformConfigShape(raw) && Array.isArray(raw.elements) ? raw.elements : [];
  const elements: FreeformElement[] = [];

  for (const rawEl of rawElements.slice(0, MAX_ELEMENTS)) {
    if (typeof rawEl !== "object" || rawEl === null) continue;
    const el = rawEl as Record<string, unknown>;
    const base: FreeformBase = {
      id: ensureId(el.id),
      x: num(el.x),
      y: num(el.y),
      w: Math.max(0, num(el.w)),
      h: Math.max(0, num(el.h)),
      ...(el.locked === true ? { locked: true } : {}),
    };

    if (el.type === "text") {
      const role = TEXT_ROLES.includes(el.role as TextRole) ? (el.role as TextRole) : "other";
      const align =
        el.align === "center" || el.align === "right" ? (el.align as "center" | "right") : "left";
      const fontFamily = sanitizeFontFamily(el.fontFamily);
      const opacity = clampOpacity(el.opacity);
      elements.push({
        ...base,
        type: "text",
        role,
        text: String(el.text ?? "").slice(0, MAX_TEXT_LEN),
        fontSize: Math.min(2000, Math.max(1, num(el.fontSize, 16))),
        fontWeight: num(el.fontWeight) >= 600 ? 700 : 400,
        color: sanitizeColor(el.color, "#000000"),
        align,
        ...(el.lineHeight !== undefined ? { lineHeight: Math.max(0.5, num(el.lineHeight, 1.2)) } : {}),
        ...(fontFamily ? { fontFamily } : {}),
        ...(el.fontStyle === "italic" ? { fontStyle: "italic" as const } : {}),
        ...(el.letterSpacing !== undefined ? { letterSpacing: num(el.letterSpacing, 0) } : {}),
        ...(opacity !== undefined ? { opacity } : {}),
      });
    } else if (el.type === "image") {
      const role = IMAGE_ROLES.includes(el.role as ImageRole) ? (el.role as ImageRole) : "decoration";
      const opacity = clampOpacity(el.opacity);
      const focusX = clampOpacity(el.focusX);
      const focusY = clampOpacity(el.focusY);
      const kvText = Array.isArray(el.kvText)
        ? (el.kvText as unknown[])
            .slice(0, 12)
            .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
            .map((t) => ({
              text: String(t.text ?? "").slice(0, MAX_TEXT_LEN),
              x: num(t.x),
              y: num(t.y),
              w: Math.max(0, num(t.w)),
              h: Math.max(0, num(t.h)),
              fontSize: Math.min(2000, Math.max(1, num(t.fontSize, 16))),
              ...(typeof t.color === "string" && SAFE_COLOR.test(t.color.trim())
                ? { color: t.color.trim() }
                : {}),
              ...(typeof t.role === "string" ? { role: t.role.slice(0, 20) } : {}),
            }))
            .filter((t) => t.text.trim().length > 0)
        : undefined;
      elements.push({
        ...base,
        type: "image",
        role,
        src: sanitizeSrc(el.src),
        ...(el.fit === "contain" || el.fit === "cover" ? { fit: el.fit } : {}),
        ...(el.radius !== undefined ? { radius: Math.max(0, num(el.radius)) } : {}),
        ...(opacity !== undefined ? { opacity } : {}),
        ...(focusX !== undefined ? { focusX } : {}),
        ...(focusY !== undefined ? { focusY } : {}),
        ...(kvText && kvText.length > 0 ? { kvText } : {}),
      });
    } else if (el.type === "rect") {
      const opacity = clampOpacity(el.opacity);
      const borderWidth = el.borderWidth !== undefined ? Math.max(0, num(el.borderWidth)) : undefined;
      elements.push({
        ...base,
        type: "rect",
        fill: sanitizeColor(el.fill, "#ffffff"),
        ...(el.radius !== undefined ? { radius: Math.max(0, num(el.radius)) } : {}),
        ...(borderWidth !== undefined ? { borderWidth } : {}),
        ...(el.borderColor !== undefined ? { borderColor: sanitizeColor(el.borderColor, "#000000") } : {}),
        ...(opacity !== undefined ? { opacity } : {}),
      });
    }
  }

  return { kind: "freeform", elements };
}
