/**
 * Liquid layout constraints — InDesign's object-based model, per element.
 *
 * Six switches on an element: pin top / bottom / left / right, and flexible
 * width / height. Per axis the rule resolves the same way InDesign does:
 *   - pinned on both sides + flexible  → the element stretches with its zone
 *   - pinned on one side, fixed size   → it rides that edge, keeping its offset
 *   - pinned on both sides, fixed size → it stretches anyway (the pins win)
 *   - unpinned                         → proportional (its centre keeps its share)
 * Offsets and sizes scale with the canvas (the min ratio), never in raw px,
 * so a 384-wide master and a 1920-wide build keep the same look.
 *
 * Where the switches come from, in order: the element's own `constraints`
 * (set by the designer in the editor, imported from an IDML package's
 * object-based rules, or written by a structured verdict); else inferred
 * from the master — flush to a zone edge → pinned there; spanning ≥96% of
 * the zone's axis → pinned both sides and flexible; else unpinned.
 *
 * This is geometry only. Type fitting stays with lib/ctaPlan.ts and the
 * engines; extreme shape jumps still go to the recompose engines.
 */

export interface LiquidConstraints {
  pinTop?: boolean;
  pinBottom?: boolean;
  pinLeft?: boolean;
  pinRight?: boolean;
  flexW?: boolean;
  flexH?: boolean;
}

export interface Box { x: number; y: number; w: number; h: number }

export const CONSTRAINT_KEYS = ["pinTop", "pinBottom", "pinLeft", "pinRight", "flexW", "flexH"] as const;

/** Keep only the six known booleans; undefined when nothing is set. */
export function sanitizeConstraints(raw: unknown): LiquidConstraints | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const out: LiquidConstraints = {};
  for (const k of CONSTRAINT_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === true) out[k] = true;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Edge tolerance: proportional, never under 2px. */
export function edgeTolerance(len: number): number {
  return Math.max(2, len * 0.012);
}

/** Infer the switches from where an element sits in its zone in the master. */
export function inferConstraints(el: Box, zone: Box): LiquidConstraints {
  const tx = edgeTolerance(zone.w), ty = edgeTolerance(zone.h);
  const left = el.x <= zone.x + tx;
  const right = el.x + el.w >= zone.x + zone.w - tx;
  const top = el.y <= zone.y + ty;
  const bottom = el.y + el.h >= zone.y + zone.h - ty;
  const spansW = el.w >= zone.w * 0.96;
  const spansH = el.h >= zone.h * 0.96;
  return {
    ...(left || spansW ? { pinLeft: true } : {}),
    ...(right || spansW ? { pinRight: true } : {}),
    ...(top || spansH ? { pinTop: true } : {}),
    ...(bottom || spansH ? { pinBottom: true } : {}),
    ...(spansW ? { flexW: true } : {}),
    ...(spansH ? { flexH: true } : {}),
  };
}

/** Merge explicit switches over inferred ones. An explicit object replaces
 *  the inference entirely (a designer who set pins meant all six). */
export function effectiveConstraints(explicit: LiquidConstraints | undefined, el: Box, zone: Box): LiquidConstraints {
  return explicit && Object.keys(explicit).length ? explicit : inferConstraints(el, zone);
}

function resolveAxis(
  pos: number, size: number,
  zoneSrcPos: number, zoneSrcLen: number,
  zoneDstPos: number, zoneDstLen: number,
  scale: number,
  pinStart: boolean, pinEnd: boolean, flexible: boolean,
): { pos: number; size: number } {
  const startOff = (pos - zoneSrcPos) * scale;
  const endOff = (zoneSrcPos + zoneSrcLen - (pos + size)) * scale;
  const scaled = Math.max(1, size * scale);
  if (pinStart && pinEnd) {
    // Stretch between the pins (flexible or not: the pins win).
    const s = Math.max(1, zoneDstLen - startOff - endOff);
    return { pos: zoneDstPos + startOff, size: s };
  }
  if (pinStart) return { pos: zoneDstPos + startOff, size: flexible ? Math.max(1, Math.min(scaled, zoneDstLen - startOff)) : scaled };
  if (pinEnd) return { pos: zoneDstPos + zoneDstLen - endOff - scaled, size: scaled };
  // Unpinned: the centre keeps its share of the zone.
  const centreFrac = (pos + size / 2 - zoneSrcPos) / Math.max(1, zoneSrcLen);
  return { pos: zoneDstPos + centreFrac * zoneDstLen - scaled / 2, size: scaled };
}

/** Place `el` (a master box) in `zoneDst` given where it sat in `zoneSrc`. */
export function resolveLiquid(el: Box, c: LiquidConstraints, zoneSrc: Box, zoneDst: Box, scale: number): Box {
  const h = resolveAxis(el.x, el.w, zoneSrc.x, zoneSrc.w, zoneDst.x, zoneDst.w, scale, !!c.pinLeft, !!c.pinRight, !!c.flexW);
  const v = resolveAxis(el.y, el.h, zoneSrc.y, zoneSrc.h, zoneDst.y, zoneDst.h, scale, !!c.pinTop, !!c.pinBottom, !!c.flexH);
  return { x: Math.round(h.pos), y: Math.round(v.pos), w: Math.max(1, Math.round(h.size)), h: Math.max(1, Math.round(v.size)) };
}

/**
 * InDesign IDML object-based rules → switches. The attributes hold three
 * tokens per axis: [start, dimension, end], each FixedDimension or
 * FlexibleDimension. A fixed start/end is a pin; a flexible dimension is
 * a spring. Returns undefined for the all-default "no rule" case.
 */
export function constraintsFromIdml(horizontal: unknown, vertical: unknown): LiquidConstraints | undefined {
  const toks = (v: unknown) => (typeof v === "string" ? v.trim().split(/\s+/) : []);
  const hz = toks(horizontal), vt = toks(vertical);
  if (hz.length !== 3 && vt.length !== 3) return undefined;
  const fixed = (t: string | undefined) => t === "FixedDimension";
  const flex = (t: string | undefined) => t === "FlexibleDimension";
  const out: LiquidConstraints = {};
  if (hz.length === 3) {
    if (fixed(hz[0])) out.pinLeft = true;
    if (fixed(hz[2])) out.pinRight = true;
    if (flex(hz[1])) out.flexW = true;
  }
  if (vt.length === 3) {
    if (fixed(vt[0])) out.pinTop = true;
    if (fixed(vt[2])) out.pinBottom = true;
    if (flex(vt[1])) out.flexH = true;
  }
  // InDesign's default with no object rule is Flexible/Fixed/Flexible on
  // both axes (unpinned, fixed size): nothing to carry.
  const isDefault = !out.pinLeft && !out.pinRight && !out.pinTop && !out.pinBottom && !out.flexW && !out.flexH;
  return isDefault ? undefined : out;
}

/** Plain words for a set of switches, for notes and the editor. */
export function describeConstraints(c: LiquidConstraints): string {
  const pins = [c.pinTop && "top", c.pinBottom && "bottom", c.pinLeft && "left", c.pinRight && "right"].filter(Boolean) as string[];
  const flex = [c.flexW && "width", c.flexH && "height"].filter(Boolean) as string[];
  if (!pins.length && !flex.length) return "proportional";
  return `${pins.length ? `pinned ${pins.join(" + ")}` : "unpinned"}${flex.length ? `, flexible ${flex.join(" + ")}` : ""}`;
}
