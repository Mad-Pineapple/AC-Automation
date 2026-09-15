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

/** What a rectangle is FOR in the composition (see lib/slots.ts). Set by
 * importers or designers; inferred from geometry when absent. */
export type SlotRole =
  | "photo"
  | "cutout"
  | "scrim"
  | "panel"
  | "band"
  | "headline"
  | "subheadline"
  | "message"
  | "cta"
  | "ctaLabel"
  | "ctaIcon"
  | "lockup"
  | "logo"
  | "other";

export const SLOT_ROLES: SlotRole[] = [
  "photo", "cutout", "scrim", "panel", "band", "headline", "subheadline", "message",
  "cta", "ctaLabel", "ctaIcon", "lockup", "logo", "other",
];

export interface FreeformBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Original source-layer name, for example art:headline. Preserved so the
   * WIP editor and layout engine do not lose the designer's semantics. */
  layerName?: string;
  /**
   * Locked elements are pinned brand furniture (logo, strapline, margins):
   * role-based copy/imagery substitution skips them and editors treat them
   * as read-only. Only admins edit templates, so setting the flag is
   * implicitly admin-gated.
   */
  locked?: boolean;
  /** Composition slot (photo, panel, cta, …) — drives recomposition. */
  slot?: SlotRole;
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
  /** "cap": the box hugs the cap height (InDesign auto-sized frame) — the
   * first baseline sits at the box bottom, not at CSS line-box position. */
  baselineFit?: "cap";
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

/** One sample of a layer's motion, relative to its resting box. */
export interface MotionFrame { t: number; dx: number; dy: number; sx: number; sy: number; o: number }
/** A layer's choreography captured from an HTML key visual: offsets in the
 * master's px relative to the resting size (w0×h0), so a piece built at
 * another size replays the same motion scaled to its own layer. */
export interface MotionTrack { dur: number; w0: number; h0: number; frames: MotionFrame[] }
export interface MotionPart { src: string; fx: number; fy: number; fw: number; fh: number; motion?: MotionTrack }

export interface FreeformImage extends FreeformBase {
  type: "image";
  role: ImageRole;
  /** Cut from a baked panel graphic at import (band, message, lockup) so the
   * panel can be re-stacked per zone; the panel image itself stays on the
   * master as the ground reference. */
  panelPart?: boolean;
  /** Motion from the imported HTML example (see MotionTrack). */
  motion?: MotionTrack;
  /** The motion shared by this layer's group (its animated ancestors only);
   * a merged glyph headline inherits this rather than one glyph's flicker. */
  groupMotion?: MotionTrack;
  /** The layer's own animation only (its reveal inside the group). */
  ownMotion?: MotionTrack;
  /** For a merged glyph headline: the glyphs it was built from, each with
   * its own image and reveal, as fractions of this box. The HTML export
   * plays them so a letter-by-letter reveal survives the merge. */
  motionParts?: MotionPart[];
  src: string | null;
  /** The photo was reproduced from a flat document PDF and carries the
   *  original copy in its pixels — size builds refuse such masters. */
  bakedCopy?: boolean;
  fit?: "cover" | "contain";
  radius?: number;
  opacity?: number;
  /** 0..1 focal point for cover crops (drives CSS object-position). */
  focusX?: number;
  focusY?: number;
  /** Hero box in image fractions (0..1): the subject that every adapted
   * format's crop window is chosen around. */
  focusBox?: { x: number; y: number; w: number; h: number };
  /** Who set the hero box: Claude vision, sharp's attention crop, or the
   * designer (whose box is never replaced). */
  focusSource?: "vision" | "attention" | "designer";
  /** What the photo is of, as found by subject detection. */
  subject?: string;
  /** Cropping into the hero box would lose meaning (a face, a product). */
  keepWhole?: boolean;
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
  /** Directional opacity/colour gradient (CSS linear-gradient semantics:
   * angle in degrees, stops at 0..1 with per-stop alpha). */
  gradient?: { angle: number; stops: { color: string; alpha: number; at: number }[] };
}

export type FreeformElement = FreeformText | FreeformImage | FreeformRect;

/** An alternative headline placement the layout engine scored; applying one
 * patches the kv_headline element. */
export interface LayoutOption {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  align: "left" | "center" | "right";
  color: string;
  score: number;
}

export interface SourceAsset {
  name: string;
  objectPath: string;
  contentType: string;
  kind: string;
}

export interface FreeformConfig {
  kind: "freeform";
  elements: FreeformElement[];
  layoutOptions?: LayoutOption[];
  /** Files that arrived with an imported package. Not shown anywhere until
   *  the user chooses "add to library" at sign-off. */
  sourceFolder?: string;
  sourceAssets?: SourceAsset[];
  /** A runnable copy of the original HTML banner (animation intact), stored
   *  at import for the WIP "Preview" option. */
  previewHtml?: string;
  /** How this layout was derived from its master ("recomposed:portrait",
   *  "scaled", "key-visual"). */
  adaptMethod?: string;
  /** Set when the automated layout failed the mandatory-element gate: the
   * reasons a designer must resolve before the piece can be used. */
  rejected?: string[];
  /** What the adapt engine decided and what a designer should check. */
  adaptNotes?: string[];
  /** Design-principle scores (0..1) and the worst contrast ratio behind copy. */
  principles?: { alignment: number; margins: number; balance: number; contrast: number | null; contrastDetail?: Array<{ id: string; label: string; ratio: number; floor: number }> };
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
const SAFE_LAYER_NAME = /^[\p{L}\p{N}\s:._()&+\/-]{1,120}$/u;

function sanitizeFontFamily(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 && SAFE_FONT_FAMILY.test(s) ? s : undefined;
}

function sanitizeLayerName(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 && SAFE_LAYER_NAME.test(s) ? s : undefined;
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
const MAX_MOTION_FRAMES = 200;
function sanitizeMotion(raw: unknown): MotionTrack | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  const dur = num(m.dur);
  const w0 = num(m.w0), h0 = num(m.h0);
  if (!(dur > 0) || dur > 60 || !(w0 > 0) || !(h0 > 0) || !Array.isArray(m.frames)) return undefined;
  const frames: MotionFrame[] = [];
  for (const f of (m.frames as unknown[]).slice(0, MAX_MOTION_FRAMES)) {
    if (typeof f !== "object" || f === null) continue;
    const r = f as Record<string, unknown>;
    const t = num(r.t);
    if (!(t >= 0 && t <= 1)) continue;
    frames.push({
      t: Math.round(t * 10000) / 10000,
      dx: Math.max(-20000, Math.min(20000, num(r.dx))),
      dy: Math.max(-20000, Math.min(20000, num(r.dy))),
      sx: Math.max(0, Math.min(50, num(r.sx, 1))),
      sy: Math.max(0, Math.min(50, num(r.sy, 1))),
      o: Math.max(0, Math.min(1, num(r.o, 1))),
    });
  }
  if (frames.length < 2) return undefined;
  frames.sort((a, b) => a.t - b.t);
  return { dur: Math.round(dur * 100) / 100, w0: Math.round(w0), h0: Math.round(h0), frames };
}

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
      ...(sanitizeLayerName(el.layerName) ? { layerName: sanitizeLayerName(el.layerName) } : {}),
      ...(el.locked === true ? { locked: true } : {}),
      ...(SLOT_ROLES.includes(el.slot as SlotRole) && el.slot !== "other" ? { slot: el.slot as SlotRole } : {}),
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
        ...(el.baselineFit === "cap" ? { baselineFit: "cap" as const } : {}),
        ...(opacity !== undefined ? { opacity } : {}),
      });
    } else if (el.type === "image") {
      const role = IMAGE_ROLES.includes(el.role as ImageRole) ? (el.role as ImageRole) : "decoration";
      const opacity = clampOpacity(el.opacity);
      const focusX = clampOpacity(el.focusX);
      const focusY = clampOpacity(el.focusY);
      const motion = sanitizeMotion(el.motion);
      const groupMotion = sanitizeMotion(el.groupMotion);
      const ownMotion = sanitizeMotion(el.ownMotion);
      const motionParts = Array.isArray(el.motionParts)
        ? (el.motionParts as unknown[])
            .slice(0, 40)
            .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
            .map((p) => {
              const src = sanitizeSrc(p.src);
              const pm = sanitizeMotion(p.motion);
              return src ? { src, fx: num(p.fx), fy: num(p.fy), fw: Math.max(0, num(p.fw)), fh: Math.max(0, num(p.fh)), ...(pm ? { motion: pm } : {}) } : null;
            })
            .filter((p): p is MotionPart => p !== null)
        : [];
      const fbRaw = el.focusBox as Record<string, unknown> | undefined;
      const focusBox =
        fbRaw && typeof fbRaw === "object"
          ? {
              x: clampOpacity(fbRaw.x) ?? 0,
              y: clampOpacity(fbRaw.y) ?? 0,
              w: Math.max(0.02, clampOpacity(fbRaw.w) ?? 0.5),
              h: Math.max(0.02, clampOpacity(fbRaw.h) ?? 0.5),
            }
          : undefined;
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
        ...(focusBox ? { focusBox } : {}),
        ...(el.focusSource === "vision" || el.focusSource === "attention" || el.focusSource === "designer" ? { focusSource: el.focusSource } : {}),
        ...(typeof el.subject === "string" && el.subject.trim() ? { subject: el.subject.trim().slice(0, 120) } : {}),
        ...(el.keepWhole === true ? { keepWhole: true } : {}),
        ...(el.bakedCopy === true ? { bakedCopy: true } : {}),
        ...(el.panelPart === true ? { panelPart: true } : {}),
        ...(kvText && kvText.length > 0 ? { kvText } : {}),
        ...(motion ? { motion } : {}),
        ...(groupMotion ? { groupMotion } : {}),
        ...(ownMotion ? { ownMotion } : {}),
        ...(motionParts.length > 0 ? { motionParts } : {}),
      });
    } else if (el.type === "rect") {
      const opacity = clampOpacity(el.opacity);
      const borderWidth = el.borderWidth !== undefined ? Math.max(0, num(el.borderWidth)) : undefined;
      const rawGrad = el.gradient as { angle?: unknown; stops?: unknown } | undefined;
      const gradStops = Array.isArray(rawGrad?.stops)
        ? (rawGrad!.stops as unknown[])
            .slice(0, 4)
            .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
            .map((s) => ({
              color: sanitizeColor(s.color, "#000000"),
              alpha: clampOpacity(s.alpha) ?? 1,
              at: Math.max(0, Math.min(1, num(s.at))),
            }))
        : [];
      elements.push({
        ...base,
        type: "rect",
        fill: sanitizeColor(el.fill, "#ffffff"),
        ...(el.radius !== undefined ? { radius: Math.max(0, num(el.radius)) } : {}),
        ...(borderWidth !== undefined ? { borderWidth } : {}),
        ...(el.borderColor !== undefined ? { borderColor: sanitizeColor(el.borderColor, "#000000") } : {}),
        ...(opacity !== undefined ? { opacity } : {}),
        ...(gradStops.length >= 2 ? { gradient: { angle: num(rawGrad?.angle) % 360, stops: gradStops } } : {}),
      });
    }
  }

  const rawOpts = (raw as { layoutOptions?: unknown }).layoutOptions;
  const layoutOptions = Array.isArray(rawOpts)
    ? (rawOpts as unknown[])
        .slice(0, 4)
        .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null)
        .map((o) => ({
          label: String(o.label ?? "Option").slice(0, 40),
          x: num(o.x),
          y: num(o.y),
          w: Math.max(1, num(o.w)),
          h: Math.max(1, num(o.h)),
          fontSize: Math.min(2000, Math.max(1, num(o.fontSize, 16))),
          align: (o.align === "center" || o.align === "right" ? o.align : "left") as "left" | "center" | "right",
          color: sanitizeColor(o.color, "#ffffff"),
          score: num(o.score),
        }))
    : [];
  // Preserve the imported-package manifest (used by the add-to-library
  // choice at sign-off) — bounded and string-only.
  const rawSrc = (raw as { sourceAssets?: unknown }).sourceAssets;
  const sourceAssets: SourceAsset[] = Array.isArray(rawSrc)
    ? (rawSrc as unknown[])
        .slice(0, 500)
        .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
        .map((a) => ({
          name: String(a.name ?? "").slice(0, 300),
          objectPath: String(a.objectPath ?? "").slice(0, 500),
          contentType: String(a.contentType ?? "").slice(0, 100),
          kind: String(a.kind ?? "image").slice(0, 40),
        }))
        .filter((a) => a.name && a.objectPath)
    : [];
  const rawFolder = (raw as { sourceFolder?: unknown }).sourceFolder;
  const sourceFolder = typeof rawFolder === "string" ? rawFolder.slice(0, 200) : undefined;
  const rawPrev = (raw as { previewHtml?: unknown }).previewHtml;
  const previewHtml =
    typeof rawPrev === "string" && rawPrev.startsWith("/api/storage/") ? rawPrev.slice(0, 500) : undefined;
  const rawMethod = (raw as { adaptMethod?: unknown }).adaptMethod;
  const adaptMethod = typeof rawMethod === "string" && /^[\w:-]{1,40}$/.test(rawMethod) ? rawMethod : undefined;
  const rawNotes = (raw as { adaptNotes?: unknown }).adaptNotes;
  const adaptNotes = Array.isArray(rawNotes)
    ? (rawNotes as unknown[]).filter((n): n is string => typeof n === "string" && n.trim().length > 0).slice(0, 16).map((n) => n.slice(0, 240))
    : [];
  const rawPr = (raw as { principles?: unknown }).principles as Record<string, unknown> | undefined;
  const unit = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
  const principles = rawPr && typeof rawPr === "object" && unit(rawPr.alignment) != null && unit(rawPr.margins) != null && unit(rawPr.balance) != null
    ? {
        alignment: unit(rawPr.alignment)!, margins: unit(rawPr.margins)!, balance: unit(rawPr.balance)!,
        contrast: typeof rawPr.contrast === "number" && Number.isFinite(rawPr.contrast) ? Math.round(rawPr.contrast * 100) / 100 : null,
        ...(Array.isArray(rawPr.contrastDetail)
          ? { contrastDetail: (rawPr.contrastDetail as unknown[]).filter((d): d is { id: string; label: string; ratio: number; floor: number } => !!d && typeof d === "object" && typeof (d as { id?: unknown }).id === "string" && typeof (d as { ratio?: unknown }).ratio === "number").slice(0, 8).map((d) => ({ id: String(d.id).slice(0, 80), label: String(d.label ?? d.id).slice(0, 40), ratio: d.ratio, floor: d.floor === 4.5 ? 4.5 : 3 })) }
          : {}),
      }
    : null;
  const rejected = Array.isArray((raw as { rejected?: unknown }).rejected)
    ? ((raw as { rejected: unknown[] }).rejected).filter((r): r is string => typeof r === "string" && r.trim().length > 0).map((r) => r.slice(0, 300)).slice(0, 20)
    : [];

  return {
    kind: "freeform",
    elements,
    ...(layoutOptions.length > 0 ? { layoutOptions } : {}),
    ...(sourceFolder ? { sourceFolder } : {}),
    ...(sourceAssets.length > 0 ? { sourceAssets } : {}),
    ...(previewHtml ? { previewHtml } : {}),
    ...(adaptMethod ? { adaptMethod } : {}),
    ...(adaptNotes.length > 0 ? { adaptNotes } : {}),
    ...(rejected.length > 0 ? { rejected } : {}),
    ...(principles ? { principles } : {}),
  };
}
