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
  /** Distance from the pill's left edge to the label's left edge in the
   *  master. A search-field pill sets its label at the left with the icon
   *  tucked into the right-hand round end, so its padding is not symmetric. */
  labelInset?: number;
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
  /** Space between the icon and the pill's right edge: the icon sits
   *  concentric in the round end, as on the shipped search pills. */
  iconInset: number;
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

/** Label-to-pill height ratio read off the master. Measured on the studio's
 *  own files: OOH search pills 0.66–0.68 (22px in a 32px pill, 19px in 29px),
 *  DV360 buttons near 0.42; 0.5 when the master has no label. The ceiling
 *  was 0.6, which set every rebuilt search pill's label a size too small. */
export function masterLabelRatio(master?: CtaMasterRef | null): number {
  if (!master || !master.labelFontSize || master.ctaH <= 0) return 0.5;
  return clamp(master.labelFontSize / master.ctaH, 0.3, 0.72);
}

const ICON_SHARE = 0.74; // icon diameter as a share of pill height (23.8 in 32.2)
const iconInsetFor = (h: number) => (h - h * ICON_SHARE) / 2;

/** Horizontal padding as a share of pill height, read off the master's
 *  measured label; 0.45 when it cannot be measured. */
export function masterPadRatio(master?: CtaMasterRef | null): number {
  if (!master || !master.labelText || !master.labelFontSize || master.ctaH <= 0) return 0.45;
  // The master's own left inset is the truth when it is known.
  if (master.labelInset != null && master.labelInset > 0) return clamp(master.labelInset / master.ctaH, 0.25, 1.2);
  const spec = master.labelSpec ?? { weight: 700 };
  const labelW = measureLine(master.labelText.replace(/\s+/g, " ").trim(), spec, master.labelFontSize);
  const iconW = master.hasIcon ? master.ctaH * 0.72 + master.ctaH * 0.25 : 0;
  const pad = (master.ctaW - labelW - iconW) / 2;
  if (!Number.isFinite(pad) || pad <= 0) return 0.45;
  return clamp(pad / master.ctaH, 0.3, 1.2);
}

/** Space between the end of the label and the icon, as a share of pill
 *  height, read off the master; 0.25 when it cannot be measured. */
export function masterIconGapRatio(master?: CtaMasterRef | null): number {
  if (!master || !master.hasIcon || !master.labelText || !master.labelFontSize || master.ctaH <= 0 || master.labelInset == null) return 0.25;
  const spec = master.labelSpec ?? { weight: 700 };
  const labelW = measureLine(master.labelText.replace(/\s+/g, " ").trim(), spec, master.labelFontSize);
  const gap = master.ctaW - master.labelInset - labelW - master.ctaH * ICON_SHARE - iconInsetFor(master.ctaH);
  if (!Number.isFinite(gap)) return 0.25;
  return clamp(gap / master.ctaH, 0.15, 1.0);
}

export function planCta(input: CtaPlanInput): CtaPlan {
  const label = input.label.replace(/\s+/g, " ").trim();
  const minLabel = input.minLabelPx ?? 9;
  const labelRatio = masterLabelRatio(input.master);
  let padRatio = masterPadRatio(input.master);
  let gapRatio = masterIconGapRatio(input.master);
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
    const iconSize = icon ? r(h * ICON_SHARE) : 0;
    const iconGap = icon ? r(h * gapRatio) : 0;
    const iconInset = icon ? Math.max(1, r(iconInsetFor(h))) : 0;
    // Measured width plus a little slack: the renderer wraps a line that
    // meets its box to the pixel, and rounding here must never cause that.
    const labelW = Math.ceil(measureLine(label, input.spec, fontSize) + fontSize * 0.2) + 2;
    // With an icon: left pad, label, gap, icon, inset. Without: even pads.
    const w = icon ? r(padX + labelW + iconGap + iconSize + iconInset) : r(labelW + padX * 2);
    return { padX, iconSize, iconGap, iconInset, labelW, w };
  };
  let g = geometry();
  let lines = [label];
  let fits = true;

  // 0. A narrow zone that may set the label on two lines does so BEFORE the
  //    label collapses: a 160px tower carried "Auckland emergency
  //    management" on one 9px line in a sliver of a pill. Two lines at a
  //    readable size win when one line would lose more than a quarter.
  let twoLineDone = false;
  if (g.w > input.maxW && input.allowTwoLines && input.maxW / g.w < 0.75 && /\s/.test(label)) {
    const tryAt = (fs: number) => {
      const hh = clamp(fs / labelRatio, input.minH, input.maxH);
      const pad = r(hh * Math.min(padRatio, 0.45));
      const inner = Math.max(10, input.maxW - pad * 2);
      const wrapped = wrapText(label, inner, input.spec, fs);
      const ok = wrapped.length === 2 && wrapped.every((l) => measureLine(l, input.spec, fs) <= inner + 0.01);
      return ok ? { wrapped, pad, widest: Math.max(...wrapped.map((l) => measureLine(l, input.spec, fs))) } : null;
    };
    for (let fs = fontSize; fs >= Math.max(minLabel, fontSize * 0.6); fs -= 0.5) {
      const t = tryAt(fs);
      if (!t) continue;
      fontSize = fs;
      icon = false;
      lines = t.wrapped;
      const padY = Math.max(3, fs * 0.45);
      h = r(fs * 1.15 * 2 + padY * 2);
      g = { padX: t.pad, iconSize: 0, iconGap: 0, iconInset: 0, labelW: t.widest, w: Math.min(r(input.maxW), r(Math.ceil(t.widest + fs * 0.2) + 2 + t.pad * 2)) };
      notes.push("Pill label set on 2 lines to keep it legible at this width.");
      twoLineDone = true;
      break;
    }
  }
  // 1. Too wide: label and pill shrink together down to the floor.
  if (!twoLineDone && g.w > input.maxW) {
    const k = input.maxW / g.w;
    fontSize = Math.max(minLabel, fontSize * k);
    h = clamp(fontSize / labelRatio, input.minH, input.maxH);
    g = geometry();
  }
  // 1b. Still too wide: tighten the padding towards the floor before
  //     anything else gives.
  if (g.w > input.maxW && (padRatio > 0.3 || gapRatio > 0.2)) {
    padRatio = Math.min(padRatio, 0.3);
    gapRatio = Math.min(gapRatio, 0.2);
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
    iconInset: g.iconInset,
    lines,
    fits,
    labelRatio,
    padRatio,
    notes,
  };
}
