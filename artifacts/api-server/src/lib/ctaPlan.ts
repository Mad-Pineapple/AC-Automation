/**
 * One pill rule for every engine: the call-to-action is sized FROM its
 * label, never the other way round.
 *
 * Designers' most repeated verdict was "pill too big, copy too small". That
 * came from two unrelated formulas — a pill box from canvas fractions and a
 * label capped at some share of the pill — that met only by accident. Here
 * the label is measured with the real face first, at the label-to-pill
 * ratio the master's own pill uses, and the pill is that label plus the
 * master's padding. When the pill would be wider than its zone allows the
 * label and pill shrink together (the ratio holds), then the icon goes, then
 * the label may take two lines; words are never cut.
 */
import { measureLine, wrapText, fontResolution, type FontSpec } from "./textMeasure";

/** The master's own pill, so its label-to-pill proportion carries. */
export interface CtaMasterRef {
  ctaH: number;
  ctaW: number;
  labelFontSize?: number;
  labelText?: string;
  labelSpec?: FontSpec;
  hasIcon?: boolean;
}

export interface CtaPlanInput {
  label: string;
  spec: FontSpec;
  master?: CtaMasterRef | null;
  /** Pill height the recipe asks for before the label is considered. */
  targetH: number;
  /** Legibility floors and the zone's ceiling for the pill. */
  minH: number;
  maxH: number;
  /** Widest the pill may be in this zone. */
  maxW: number;
  /** Smallest label the studio accepts (px). */
  minLabelPx?: number;
  /** A magnifier disc (or similar) rides at the right of the label. */
  icon?: boolean;
  /** Tall narrow canvases may set the label on two lines rather than shrink
   *  it below the floor. */
  allowTwoLines?: boolean;
}

export interface CtaPlan {
  h: number;
  w: number;
  fontSize: number;
  padX: number;
  iconSize: number;
  iconGap: number;
  lines: string[];
  /** False when even the floors could not make the label fit the zone. */
  fits: boolean;
  /** Label size as a share of pill height, as used. */
  labelRatio: number;
  padRatio: number;
  notes: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r = (v: number) => Math.round(v);

/** Label-to-pill height ratio read off the master (shipped OOH pills sit
 *  near 0.47, DV360 buttons near 0.42); 0.5 when the master has no label. */
export function masterLabelRatio(master?: CtaMasterRef | null): number {
  if (!master || !master.labelFontSize || master.ctaH <= 0) return 0.5;
  return clamp(master.labelFontSize / master.ctaH, 0.3, 0.6);
}

/** Horizontal padding as a share of pill height, read off the master's
 *  measured label; 0.45 when it cannot be measured. */
export function masterPadRatio(master?: CtaMasterRef | null): number {
  if (!master || !master.labelText || !master.labelFontSize || master.ctaH <= 0) return 0.45;
  const spec = master.labelSpec ?? { weight: 700 };
  const labelW = measureLine(master.labelText.replace(/\s+/g, " ").trim(), spec, master.labelFontSize);
  const iconW = master.hasIcon ? master.ctaH * 0.72 + master.ctaH * 0.25 : 0;
  const pad = (master.ctaW - labelW - iconW) / 2;
  if (!Number.isFinite(pad) || pad <= 0) return 0.45;
  return clamp(pad / master.ctaH, 0.3, 1.2);
}

export function planCta(input: CtaPlanInput): CtaPlan {
  const label = input.label.replace(/\s+/g, " ").trim();
  const minLabel = input.minLabelPx ?? 9;
  const labelRatio = masterLabelRatio(input.master);
  let padRatio = masterPadRatio(input.master);
  const notes: string[] = [];
  const res = fontResolution(input.spec);
  if (res.substituted) notes.push(`Check: the pill label was measured in ${res.used} because "${res.requested}" is not registered on this server — confirm its width on export.`);

  let icon = !!input.icon;
  let h = clamp(input.targetH, input.minH, input.maxH);
  let fontSize = h * labelRatio;
  // The label never drops below the floor: the pill grows to keep the ratio.
  if (fontSize < minLabel) {
    fontSize = minLabel;
    h = clamp(fontSize / labelRatio, input.minH, input.maxH);
  }
  const geometry = () => {
    const padX = r(h * padRatio);
    const iconSize = icon ? r(h * 0.72) : 0;
    const iconGap = icon ? r(h * 0.25) : 0;
    // Measured width plus a little slack: the renderer wraps a line that
    // meets its box to the pixel, and rounding here must never cause that.
    const labelW = Math.ceil(measureLine(label, input.spec, fontSize) + fontSize * 0.2) + 2;
    const w = r(labelW + padX * 2 + iconSize + iconGap);
    return { padX, iconSize, iconGap, labelW, w };
  };
  let g = geometry();
  let lines = [label];
  let fits = true;

  // 1. Too wide: label and pill shrink together down to the floor.
  if (g.w > input.maxW) {
    const k = input.maxW / g.w;
    fontSize = Math.max(minLabel, fontSize * k);
    h = clamp(fontSize / labelRatio, input.minH, input.maxH);
    g = geometry();
  }
  // 1b. Still too wide: tighten the padding towards the floor before
  //     anything else gives.
  if (g.w > input.maxW && padRatio > 0.3) {
    padRatio = 0.3;
    g = geometry();
  }
  // 2. Still too wide: give up the icon before the words.
  if (g.w > input.maxW && icon) {
    icon = false;
    g = geometry();
    notes.push("Pill icon dropped: no room beside the label at this size.");
  }
  // 3. Still too wide: two lines on a tall pill, never a cut word.
  if (g.w > input.maxW && input.allowTwoLines) {
    const inner = Math.max(10, input.maxW - g.padX * 2);
    const wrapped = wrapText(label, inner, input.spec, fontSize);
    if (wrapped.length >= 2 && wrapped.length <= 3 && wrapped.every((l) => measureLine(l, input.spec, fontSize) <= inner + 0.01)) {
      lines = wrapped;
      const widest = Math.max(...wrapped.map((l) => measureLine(l, input.spec, fontSize)));
      const padY = Math.max(2, (h - fontSize) / 2);
      h = r(fontSize * 1.15 * wrapped.length + padY * 2);
      g = { ...g, labelW: widest, w: r(widest + g.padX * 2) };
      notes.push(`Pill label set on ${wrapped.length} lines to keep it legible at this width.`);
    }
  }
  if (g.w > input.maxW) {
    fits = false;
    notes.push("Check: the pill label does not fit this zone even at the smallest legible size — shorten the copy for this format.");
    g = { ...g, w: r(input.maxW) };
  }
  return {
    h: r(h),
    w: Math.max(1, g.w),
    fontSize: r(fontSize),
    padX: g.padX,
    iconSize: g.iconSize,
    iconGap: g.iconGap,
    lines,
    fits,
    labelRatio,
    padRatio,
    notes,
  };
}
