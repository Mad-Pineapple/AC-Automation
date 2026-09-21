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
  | "kicker"
  | "subheadline"
  | "message"
  | "cta"
  | "ctaLabel"
  | "ctaIcon"
  | "lockup"
  | "logo"
  | "other";

export const SLOT_ROLES: SlotRole[] = [
  "photo", "cutout", "scrim", "panel", "band", "headline", "kicker", "subheadline", "message",
  "cta", "ctaLabel", "ctaIcon", "lockup", "logo", "other",
];

/** A part of the master that a build left out, and why. `byRule` is true
 *  when a profile rule or a guideline allowed the drop. */
export interface DroppedPart {
  slot: string;
  reason: string;
  byRule: boolean;
}

import { sanitizeConstraints, effectiveConstraints, resolveLiquid, type LiquidConstraints } from "./liquid";

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
  /** Stable block exported by the InDesign bridge. All members receive one
   * uniform transform, so a CTA, logo lockup or pattern never comes apart. */
  layoutBlock?: string;
  /** Explicit master-relative placement exported by InDesign. */
  anchorX?: "left" | "center" | "right" | "stretch";
  anchorY?: "top" | "center" | "bottom" | "stretch";
  scaleMode?: "uniform" | "fill" | "fixed";
  /** Liquid-layout switches (pin top/bottom/left/right, flexible width/height),
   * see lib/liquid.ts. Absent = inferred from the master. */
  constraints?: LiquidConstraints;
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
  /** The panel graphic has had its cut parts painted out in the ground
   * colour, so drawing it together with its parts never doubles them. */
  panelMasked?: boolean;
  /** A photo cut to a shape, read off its transparency (lib/anther.ts): the
   *  council's anther. Carried on the element so every engine and the quality
   *  gate can honour "the anther is never cropped". */
  shape?: { kind: "anther" | "shape"; cx: number; cy: number; r: number; stemX?: number; stemY?: number; aspect?: number };
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
  /** Parts of the master this build left out, structured (see DroppedPart). */
  droppedParts?: DroppedPart[];
  /** A slot was missing, dropped or fitted at the floor — a designer should look. */
  needsReview?: boolean;
  /** Design-principle scores (0..1) and the worst contrast ratio behind copy. */
  principles?: { alignment: number; margins: number; balance: number; contrast: number | null; contrastDetail?: Array<{ id: string; label: string; ratio: number; floor: number }> };
  /** The layout came from the AC InDesign bridge and is authoritative.
   * Generic recipes and AI may validate it, but must not redesign it. */
  sourceMode?: "indesign-bridge";
  masterFamily?: "portrait" | "landscape" | "slim-portrait" | "slim-landscape";
  authoritativeGeometry?: boolean;
  /** Engine geometry before any human correction, used to learn proportional edits. */
  adaptationBaseline?: Array<{ id: string; slot?: SlotRole; x: number; y: number; w: number; h: number }>;
  /** Remembered deterministic correction rule ids applied during this build. */
  appliedCorrectionRuleIds?: number[];
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
  const tolX = Math.max(2, srcW * 0.012);
  const tolY = Math.max(2, srcH * 0.012);
  const R = Math.round;

  type El = FreeformConfig["elements"][number];
  type Box = { x: number; y: number; w: number; h: number };
  const touchesL = (el: El) => el.x <= tolX;
  const touchesR = (el: El) => el.x + el.w >= srcW - tolX;
  const touchesT = (el: El) => el.y <= tolY;
  const touchesB = (el: El) => el.y + el.h >= srcH - tolY;
  const fullW = (el: El) => el.w >= srcW * 0.97 && touchesL(el) && touchesR(el);
  const fullH = (el: El) => el.h >= srcH * 0.97 && touchesT(el) && touchesB(el);
  const fullBleed = (el: El) => el.w >= srcW * 0.9 && el.h >= srcH * 0.9;

  // ---- Zones: full-width strips (stacked layouts) and full-height columns
  // (side layouts) keep their span, snap to the canvas edges and TILE: a
  // strip whose master top met another strip's bottom keeps meeting it, and
  // the strip that touched the far edge fills to it. This is what keeps a
  // photo / band / panel stack seamless instead of three centred stamps.
  const placed = new Map<string, Box>();
  const zones: El[] = master.elements.filter((el) => !fullBleed(el) && (fullW(el) || fullH(el)));
  const strips = zones.filter((el) => fullW(el) && !fullH(el)).sort((a, b) => a.y - b.y);
  const columns = zones.filter((el) => fullH(el) && !fullW(el)).sort((a, b) => a.x - b.x);
  for (const el of strips) {
    const h = Math.max(1, R(el.h * scale));
    let y: number | null = null;
    if (touchesT(el)) y = 0;
    else {
      for (const prev of strips) {
        if (prev === el) continue;
        const pb = placed.get(prev.id);
        if (pb && Math.abs(prev.y + prev.h - el.y) <= tolY) { y = pb.y + pb.h; break; }
      }
    }
    if (y === null) y = R((el.y / srcH) * dstH);
    const fill = touchesB(el) ? Math.max(1, dstH - y) : h;
    placed.set(el.id, { x: 0, y, w: dstW, h: fill });
  }
  for (const el of columns) {
    const w = Math.max(1, R(el.w * scale));
    let x: number | null = null;
    if (touchesL(el)) x = 0;
    else {
      for (const prev of columns) {
        if (prev === el) continue;
        const pb = placed.get(prev.id);
        if (pb && Math.abs(prev.x + prev.w - el.x) <= tolX) { x = pb.x + pb.w; break; }
      }
    }
    if (x === null) x = R((el.x / srcW) * dstW);
    const fill = touchesR(el) ? Math.max(1, dstW - x) : w;
    placed.set(el.id, { x, y: 0, w: fill, h: dstH });
  }

  const adaptAxis = (pos: number, size: number, srcLen: number, dstLen: number, newSize: number): number => {
    const centre = pos + size / 2;
    if (centre < srcLen / 3) return R(pos * scale); // near the leading edge: keep scaled margin
    if (centre > (2 * srcLen) / 3) return R(dstLen - (srcLen - pos - size) * scale - newSize); // trailing edge
    return R((centre / srcLen) * dstLen - newSize / 2); // centred band
  };

  // The zone an element sits in (by its centre), so message, pill and lockup
  // travel with the panel and the headline with the photo.
  const zoneOf = (box: Box): El | null => {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    let best: El | null = null;
    for (const z of zones) {
      if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) {
        if (!best || z.w * z.h < best.w * best.h) best = z;
      }
    }
    return best;
  };

  // ---- Clusters: elements that overlap in the master (a pill, its label
  // and its icon; a lockup's marks) move as ONE object. Placing each by its
  // own relative position pulled them apart whenever a zone grew faster
  // than the scale (a 384-wide panel becoming 1920 wide).
  const loose: El[] = master.elements.filter((el) => !fullBleed(el) && !placed.has(el.id));
  const parent = new Map<string, string>();
  const find = (id: string): string => { const p = parent.get(id); if (!p || p === id) return id; const root = find(p); parent.set(id, root); return root; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const el of loose) parent.set(el.id, el.id);
  const meets = (a: El, b: El) => a.x < b.x + b.w + 1 && a.x + a.w + 1 > b.x && a.y < b.y + b.h + 1 && a.y + a.h + 1 > b.y;
  for (let i = 0; i < loose.length; i++) for (let j = i + 1; j < loose.length; j++) if (meets(loose[i], loose[j])) union(loose[i].id, loose[j].id);
  const clusters = new Map<string, El[]>();
  for (const el of loose) { const rt = find(el.id); clusters.set(rt, [...(clusters.get(rt) ?? []), el]); }

  const newBox = new Map<string, Box>();
  for (const members of clusters.values()) {
    const bx0 = Math.min(...members.map((m) => m.x)), by0 = Math.min(...members.map((m) => m.y));
    const bx1 = Math.max(...members.map((m) => m.x + m.w)), by1 = Math.max(...members.map((m) => m.y + m.h));
    const B: Box = { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
    // Liquid layout: the cluster's own switches (a designer's, an IDML
    // rule's, or a verdict's) else switches inferred from where it sits in
    // its zone. Pinned edges keep their scaled offset, pinned-both stretches,
    // unpinned keeps its share of the zone.
    const zone = zoneOf(B);
    const zNew = zone ? placed.get(zone.id) : undefined;
    const zoneSrc: Box = zone ?? { x: 0, y: 0, w: srcW, h: srcH };
    const zoneDst: Box = zone && zNew ? zNew : { x: 0, y: 0, w: dstW, h: dstH };
    const explicit = members.map((m) => m.constraints).find((c) => c && Object.keys(c).length);
    const c = effectiveConstraints(explicit, B, zoneSrc);
    const placedBox = resolveLiquid(B, c, zoneSrc, zoneDst, scale);
    let x = placedBox.x;
    let y = placedBox.y;
    const w = placedBox.w;
    const h = placedBox.h;
    // Unpinned axes stay inside the zone where the master kept them inside.
    if (!c.pinLeft && !c.pinRight && B.x >= zoneSrc.x && B.x + B.w <= zoneSrc.x + zoneSrc.w) x = Math.min(Math.max(x, zoneDst.x), Math.max(zoneDst.x, zoneDst.x + zoneDst.w - w));
    if (!c.pinTop && !c.pinBottom && B.y >= zoneSrc.y && B.y + B.h <= zoneSrc.y + zoneSrc.h) y = Math.min(Math.max(y, zoneDst.y), Math.max(zoneDst.y, zoneDst.y + zoneDst.h - h));
    // Members keep their scaled offsets inside the cluster; a stretched
    // cluster stretches its single member.
    const kx = members.length === 1 ? w / Math.max(1, B.w * scale) : 1;
    const ky = members.length === 1 ? h / Math.max(1, B.h * scale) : 1;
    for (const m of members) {
      newBox.set(m.id, { x: x + R((m.x - B.x) * scale * kx), y: y + R((m.y - B.y) * scale * ky), w: Math.max(1, R(m.w * scale * kx)), h: Math.max(1, R(m.h * scale * ky)) });
    }
  }

  // A pill's label box follows the pill's inner width, so a label that just
  // fitted its master box never wraps after rounding at the new size.
  for (const members of clusters.values()) {
    const pill = members.find((m) => m.slot === "cta" && m.type === "rect");
    const label = members.find((m) => m.slot === "ctaLabel" && m.type === "text");
    if (!pill || !label) continue;
    const pb = newBox.get(pill.id), lb = newBox.get(label.id);
    if (!pb || !lb) continue;
    const pad = Math.max(2, lb.x - pb.x);
    const icon = members.find((m) => m.slot === "ctaIcon");
    const ib = icon ? newBox.get(icon.id) : undefined;
    const right = ib ? ib.x - Math.max(2, R(pad / 2)) : pb.x + pb.w - pad;
    newBox.set(label.id, { ...lb, w: Math.max(1, right - lb.x) });
  }

  const elements = master.elements.map((el) => {
    // Full-bleed backgrounds restretch rather than scale-and-anchor.
    if (fullBleed(el)) {
      return { ...el, x: 0, y: 0, w: dstW, h: dstH };
    }
    const zb = placed.get(el.id);
    if (zb) return { ...el, x: zb.x, y: zb.y, w: zb.w, h: zb.h };
    const nb = newBox.get(el.id) ?? { x: R(el.x * scale), y: R(el.y * scale), w: Math.max(1, R(el.w * scale)), h: Math.max(1, R(el.h * scale)) };
    if (el.type === "text") {
      // A hair of slack so a line that met its box in the master does not
      // wrap after rounding at the new size.
      return {
        ...el,
        x: nb.x, y: nb.y, w: nb.w + Math.max(2, R(nb.w * 0.03)), h: nb.h,
        fontSize: Math.max(6, R(el.fontSize * scale)),
        ...(el.letterSpacing !== undefined ? { letterSpacing: el.letterSpacing * scale } : {}),
      };
    }
    return { ...el, x: nb.x, y: nb.y, w: nb.w, h: nb.h };
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
      ...(typeof el.layoutBlock === "string" && /^[\w:.-]{1,80}$/.test(el.layoutBlock) ? { layoutBlock: el.layoutBlock } : {}),
      ...(el.anchorX === "left" || el.anchorX === "center" || el.anchorX === "right" || el.anchorX === "stretch" ? { anchorX: el.anchorX } : {}),
      ...(el.anchorY === "top" || el.anchorY === "center" || el.anchorY === "bottom" || el.anchorY === "stretch" ? { anchorY: el.anchorY } : {}),
      ...(el.scaleMode === "uniform" || el.scaleMode === "fill" || el.scaleMode === "fixed" ? { scaleMode: el.scaleMode } : {}),
      ...(sanitizeConstraints(el.constraints) ? { constraints: sanitizeConstraints(el.constraints) } : {}),
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
        ...(el.panelMasked === true ? { panelMasked: true } : {}),
        ...(() => {
          const sh = el.shape as Record<string, unknown> | undefined;
          if (!sh || (sh.kind !== "anther" && sh.kind !== "shape")) return {};
          const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
          const cx = n(sh.cx), cy = n(sh.cy), rr = n(sh.r);
          if (cx === null || cy === null || rr === null || rr <= 0) return {};
          const sx = n(sh.stemX), sy = n(sh.stemY), asp = n(sh.aspect);
          return { shape: { kind: sh.kind as "anther" | "shape", cx, cy, r: rr, ...(sx !== null && sy !== null ? { stemX: sx, stemY: sy } : {}), ...(asp !== null && asp > 0 ? { aspect: asp } : {}) } };
        })(),
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
  const rawDropped = (raw as { droppedParts?: unknown }).droppedParts;
  const droppedParts: DroppedPart[] = Array.isArray(rawDropped)
    ? (rawDropped as unknown[])
        .filter((d): d is { slot: string; reason?: unknown; byRule?: unknown } => !!d && typeof d === "object" && typeof (d as { slot?: unknown }).slot === "string")
        .slice(0, 20)
        .map((d) => ({ slot: d.slot.slice(0, 40), reason: typeof d.reason === "string" ? d.reason.slice(0, 200) : "", byRule: d.byRule === true }))
    : [];
  const needsReview = (raw as { needsReview?: unknown }).needsReview === true;
  const rejected = Array.isArray((raw as { rejected?: unknown }).rejected)
    ? ((raw as { rejected: unknown[] }).rejected).filter((r): r is string => typeof r === "string" && r.trim().length > 0).map((r) => r.slice(0, 300)).slice(0, 20)
    : [];
  const sourceMode = (raw as { sourceMode?: unknown }).sourceMode === "indesign-bridge" ? "indesign-bridge" as const : undefined;
  const familyRaw = (raw as { masterFamily?: unknown }).masterFamily;
  const masterFamily = familyRaw === "portrait" || familyRaw === "landscape" || familyRaw === "slim-portrait" || familyRaw === "slim-landscape" ? familyRaw : undefined;
  const authoritativeGeometry = sourceMode === "indesign-bridge" && (raw as { authoritativeGeometry?: unknown }).authoritativeGeometry === true;
  const rawBaseline = (raw as { adaptationBaseline?: unknown }).adaptationBaseline;
  const adaptationBaseline = Array.isArray(rawBaseline) ? rawBaseline.filter((b): b is { id: string; slot?: SlotRole; x: number; y: number; w: number; h: number } => {
    if (!b || typeof b !== "object") return false;
    const v = b as Record<string, unknown>;
    return typeof v.id === "string" && [v.x, v.y, v.w, v.h].every((n) => typeof n === "number" && Number.isFinite(n));
  }).slice(0, MAX_ELEMENTS).map((b) => ({ id: b.id.slice(0,64), ...(b.slot && SLOT_ROLES.includes(b.slot) ? { slot: b.slot } : {}), x:b.x, y:b.y, w:b.w, h:b.h })) : [];
  const appliedCorrectionRuleIds = Array.isArray((raw as { appliedCorrectionRuleIds?: unknown }).appliedCorrectionRuleIds)
    ? ((raw as { appliedCorrectionRuleIds: unknown[] }).appliedCorrectionRuleIds).filter((n): n is number => Number.isInteger(n) && Number(n) > 0).slice(0, 20) : [];

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
    ...(droppedParts.length > 0 ? { droppedParts } : {}),
    ...(needsReview ? { needsReview } : {}),
    ...(principles ? { principles } : {}),
    ...(sourceMode ? { sourceMode } : {}),
    ...(masterFamily ? { masterFamily } : {}),
    ...(authoritativeGeometry ? { authoritativeGeometry: true } : {}),
    ...(adaptationBaseline.length ? { adaptationBaseline } : {}),
    ...(appliedCorrectionRuleIds.length ? { appliedCorrectionRuleIds } : {}),
  };
}
