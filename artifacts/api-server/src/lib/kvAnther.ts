/**
 * Composer for the "full-bleed key visual with an anther" style
 * (AC Brand Guidelines June 2025 p.36: full-bleed photography with the anther
 * intersecting the image; Auckland Heritage Festival 2026 is the reference).
 *
 * The style, as a designer reads it:
 *   - a graded photograph fills the artwork; an ANTHER frames the subject with
 *     its own clean copy of the picture (the focus of the piece);
 *   - a TITLE LOCK-UP (artwork, not live type) names the campaign;
 *   - the EVENT COPY (live: name + dates) and a URL PILL carry the message;
 *   - a BADGE may ride on the anther's shoulder; a pattern, a strapline, the
 *     logo and a picture credit finish the piece.
 *
 * Schema rules (docs/style-specs/key-visual-layouts.md):
 *   1. The anther is never cropped and nothing covers its circle (lib/anther.ts).
 *      The background photograph is LOCKED to it, so the picture inside the
 *      anther and the picture behind it stay one photograph.
 *   2. Reading order never changes: title → event copy → pill → logo.
 *   3. Parts leave in a fixed order when a size cannot carry them legibly:
 *      credit → strapline → pattern → badge → dates → event copy. The title,
 *      the pill, the logo and the anther never leave (the anther only below
 *      a 36px circle, where it no longer reads as a device).
 *   4. Tall sizes stack (title · anther · copy · pill · logo). Square and
 *      landscape sizes put the anther on the LEFT, where its stem can run off
 *      the edge, and the copy in a column on the right with the logo in the
 *      bottom-right corner. Strips run anther · title · copy · pill · logo.
 *   5. Artwork parts scale uniformly; live copy is re-set at a size that holds
 *      the master's proportion to the width of its column.
 */
import type { FreeformConfig, FreeformElement, FreeformImage, FreeformRect, FreeformText, DroppedPart } from "./freeform";
import { placeAnther, circleOf, ANTHER_RULE, type AntherShape } from "./anther";
import { fitText, prepareMeasurement, type FontSpec } from "./textMeasure";
import { inferSlots } from "./slots";

type Box = { x: number; y: number; w: number; h: number };
const r = (v: number) => Math.round(v);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Block { els: FreeformElement[]; x: number; y: number; w: number; h: number }

interface Parts {
  bg: FreeformImage;
  anther: FreeformImage & { shape: AntherShape };
  /** A named block may be several elements (a badge's disc and its live
   *  type, from the InDesign bridge): it is placed as ONE object. */
  title: Block | null;
  badge: Block | null;
  credit: Block | null;
  pattern: FreeformImage | null;
  logo: FreeformImage | null;
  cta: FreeformElement[];
  headline: FreeformText;
  dates: FreeformText | null;
  strapline: FreeformText | null;
  shade: FreeformRect | null;
}

function findParts(cfg: FreeformConfig): Parts | null {
  const els = cfg.elements;
  const images = els.filter((e): e is FreeformImage => e.type === "image");
  const anther = images.find((e) => e.shape?.kind === "anther") as Parts["anther"] | undefined;
  const bg = images.filter((e) => e !== anther && (e.slot === "photo" || e.role === "product") && !e.shape).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const headline = els.find((e): e is FreeformText => e.type === "text" && e.slot === "headline");
  if (!anther || !bg || !headline) return null;
  const block = (name: string) => els.find((e) => e.layoutBlock === name);
  const group = (name: string): Block | null => {
    const g = els.filter((e) => e.layoutBlock === name && e !== anther);
    if (!g.length) return null;
    const x = Math.min(...g.map((e) => e.x)), y = Math.min(...g.map((e) => e.y));
    return { els: g, x, y, w: Math.max(...g.map((e) => e.x + e.w)) - x, h: Math.max(...g.map((e) => e.y + e.h)) - y };
  };
  return {
    bg, anther, headline,
    title: group("title"),
    badge: group("badge"),
    credit: group("credit"),
    pattern: (images.find((e) => e.slot === "band") ?? null),
    logo: (images.find((e) => e.slot === "lockup" || e.slot === "logo" || e.role === "logo") ?? null),
    cta: els.filter((e) => e.slot === "cta" || e.slot === "ctaLabel" || e.slot === "ctaIcon"),
    dates: (els.find((e): e is FreeformText => e.type === "text" && e.slot === "subheadline") ?? null),
    strapline: ((els.find((e) => e.layoutBlock === "strapline" && e.type === "text") as FreeformText | undefined) ?? null),
    shade: (els.find((e): e is FreeformRect => e.type === "rect" && !!e.gradient) ?? null),
  };
}

/** A master in this style: an anther-shaped picture over a separate full-bleed photograph. */
export function isAntherKeyVisual(cfg: FreeformConfig, width: number, height: number): boolean {
  const p = findParts(cfg);
  if (!p) return false;
  return p.bg.w * p.bg.h >= width * height * 0.9;
}

const spec = (t: FreeformText): FontSpec => ({
  family: t.fontFamily,
  weight: t.fontWeight === 700 ? 700 : 400,
  italic: t.fontStyle === "italic",
  ...(t.letterSpacing !== undefined && t.fontSize > 0 ? { letterSpacingEm: t.letterSpacing / t.fontSize } : {}),
});

export interface AntherKvResult { config: FreeformConfig; notes: string[]; formatKind: "tall" | "square" | "column" | "banner" | "strip" }

export async function composeAntherKeyVisual(master: FreeformConfig, srcW: number, srcH: number, W: number, H: number): Promise<AntherKvResult | null> {
  const p = findParts(master);
  if (!p) return null;
  await prepareMeasurement();
  const notes: string[] = [];
  const dropped: DroppedPart[] = [];
  const drop = (slot: string, reason: string) => { dropped.push({ slot, reason, byRule: true }); notes.push(reason); };
  // The gate reads an untagged strapline as whichever copy slot it infers
  // (message, or sub-line when the dates share the heading's frame): a
  // strapline left out is recorded under that name, so it is not "missing".
  const semMaster = inferSlots(master, srcW, srcH);
  const straplineSlot = p.strapline && semMaster.subheadline?.id === p.strapline.id ? "subheadline" : "message";
  const ratio = W / H, short = Math.min(W, H);
  const kind: AntherKvResult["formatKind"] = H <= 120 && ratio >= 2.5 ? "strip" : ratio >= 2.5 ? "banner" : ratio >= 1.15 ? "column" : ratio >= 0.9 ? "square" : "tall";
  const m = Math.max(5, r(short * 0.055));
  const mi = Math.max(3, r(m * 0.5)); // artwork parts carry their own soft shadow padding
  const out: FreeformElement[] = [];
  const aspect = (e: { w: number; h: number }) => e.w / Math.max(1, e.h);
  const put = <T extends FreeformElement>(el: T, id: string, box: Box, extra: Partial<T> = {}): T => ({ ...el, id, x: r(box.x), y: r(box.y), w: Math.max(1, r(box.w)), h: Math.max(1, r(box.h)), ...extra } as T);
  const within = (a: number, maxW: number, maxH: number) => { let w = maxW, h = w / a; if (h > maxH) { h = maxH; w = h * a; } return { w, h }; };

  // A block placed as one object: every member keeps its place in the block.
  const putBlock = (b: Block, id: string, box: Box): FreeformElement[] => {
    const k = box.w / Math.max(1, b.w);
    return b.els.map((e, i) => put(e, i === 0 ? id : `${id}_${i}`, { x: box.x + (e.x - b.x) * k, y: box.y + (e.y - b.y) * k, w: e.w * k, h: e.h * k }, (e.type === "text" ? { fontSize: Math.max(6, Math.round((e as FreeformText).fontSize * k * 10) / 10), letterSpacing: (e as FreeformText).letterSpacing !== undefined ? ((e as FreeformText).letterSpacing as number) * k : undefined } : {}) as Partial<FreeformElement>));
  };

  // Live copy, fitted to a column. The master's own line breaks are kept.
  const setCopy = (col: Box, align: "left" | "center", headPx: number, maxLines: number) => {
    const hText = p.headline.text.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
    // Dates set in the heading's own frame arrive as a third line: the copy keeps
    // the designer's line count rather than being run together and re-wrapped.
    maxLines = Math.max(maxLines, hText.split("\n").length);
    let fit = fitText(hText, { w: col.w * 0.94, h: headPx * 1.1 * (maxLines + 0.3) }, { ...spec(p.headline), minSize: 11, maxSize: Math.max(11, headPx), lineHeight: 1.05, maxLines });
    if (!fit.fits) fit = fitText(hText.replace(/\n/g, " "), { w: col.w * 0.94, h: headPx * 1.1 * (maxLines + 1.3) }, { ...spec(p.headline), minSize: 10, maxSize: Math.max(10, headPx), lineHeight: 1.05, maxLines: maxLines + 1 });
    const hh = r(fit.height);
    let dFit: ReturnType<typeof fitText> | null = null;
    if (p.dates) {
      const dPx = Math.max(9, r(fit.fontSize * clamp(p.dates.fontSize / p.headline.fontSize, 0.45, 0.8)));
      dFit = fitText(p.dates.text.replace(/\s+/g, " ").trim(), { w: col.w * 0.94, h: dPx * 1.4 }, { ...spec(p.dates), minSize: 9, maxSize: dPx, lineHeight: 1.1, maxLines: 1 });
      if (!dFit.fits) { dFit = null; drop("subheadline", "Dates left out: they cannot be set legibly on one line at this size."); }
    }
    const gap = dFit ? r(fit.fontSize * 0.18) : 0;
    const dh = dFit ? r(dFit.height) : 0;
    const build = (y: number): FreeformElement[] => {
      const els: FreeformElement[] = [put(p.headline, "kva_headline", { x: col.x, y, w: col.w, h: hh }, { fontSize: fit.fontSize, text: fit.lines.join("\n"), align, lineHeight: 1.05, letterSpacing: p.headline.letterSpacing !== undefined ? (p.headline.letterSpacing * fit.fontSize) / p.headline.fontSize : undefined } as Partial<FreeformText>)];
      if (dFit && p.dates) els.push(put(p.dates, "kva_dates", { x: col.x, y: y + hh + gap, w: col.w, h: dh }, { fontSize: dFit.fontSize, text: dFit.lines.join("\n"), align, lineHeight: 1.1, letterSpacing: p.dates.letterSpacing !== undefined ? (p.dates.letterSpacing * dFit.fontSize) / p.dates.fontSize : undefined } as Partial<FreeformText>));
      return els;
    };
    return { h: hh + gap + dh, build, fits: fit.fits, px: fit.fontSize };
  };
  // The pill (artwork, or rect + label): scaled as one object, never reshaped.
  const ctaBox = (() => { if (!p.cta.length) return null; const x0 = Math.min(...p.cta.map((e) => e.x)), y0 = Math.min(...p.cta.map((e) => e.y)); return { x: x0, y: y0, w: Math.max(...p.cta.map((e) => e.x + e.w)) - x0, h: Math.max(...p.cta.map((e) => e.y + e.h)) - y0 }; })();
  const setPill = (box: Box): FreeformElement[] => {
    if (!ctaBox) return [];
    const k = box.w / ctaBox.w;
    return p.cta.map((e, i) => put(e, i === 0 ? "kva_cta" : `kva_cta_${i}`, { x: box.x + (e.x - ctaBox.x) * k, y: box.y + (e.y - ctaBox.y) * k, w: e.w * k, h: e.h * k }, (e.type === "text" ? { fontSize: Math.max(8, r((e as FreeformText).fontSize * k)), letterSpacing: (e as FreeformText).letterSpacing !== undefined ? ((e as FreeformText).letterSpacing as number) * k : undefined } : {}) as Partial<FreeformElement>));
  };
  const pillSize = (maxW: number, wantW: number) => { if (!ctaBox) return { w: 0, h: 0 }; const a = aspect(ctaBox); let w = clamp(wantW, Math.min(maxW, 18 * a), maxW); return { w, h: w / a }; };

  let antherZone: Box;
  const later: FreeformElement[] = []; // copy, pill, logo — drawn above the anther
  const under: FreeformElement[] = []; // pattern — drawn under the anther
  let shadeBoxes: Array<{ box: Box; angle: number; from: number; to: number; mid?: { at: number; alpha: number } }> = [];
  let showAnther = true;
  let titleBottom = 0;

  if (kind === "tall") {
    const tower = W < 220;
    // Top: the title lock-up, margin to margin.
    if (p.title) { const s = within(aspect(p.title), W - mi * 2, H * 0.2); const b = { x: (W - s.w) / 2, y: r(H * 0.03), w: s.w, h: s.h }; later.push(...putBlock(p.title, "kva_title", b)); titleBottom = b.y + b.h; }
    // Bottom row: strapline left, logo right (tower: logo centred, no strapline).
    let rowTop = H - r(H * 0.02);
    let logoBox: Box | null = null;
    if (p.logo) { const s = within(aspect(p.logo), tower ? W * 0.72 : W * (W <= 400 ? 0.36 : 0.3), clamp(H * (W <= 400 ? 0.075 : 0.062), 16, short * 0.3)); logoBox = { x: tower ? (W - s.w) / 2 : W - mi - s.w, y: H - r(H * 0.02) - s.h, w: s.w, h: s.h }; later.push(put(p.logo, "kva_logo", logoBox, { slot: "lockup" } as Partial<FreeformImage>)); rowTop = logoBox.y; }
    if (p.strapline) {
      if (tower || W < 260) drop(straplineSlot, "Strapline left out: no legible room beside the logo at this width.");
      else { const px = clamp(r(H * 0.0175), 9, 44); const col = { x: m, y: 0, w: (logoBox ? logoBox.x : W) - m * 2, h: 0 }; const f = fitText(p.strapline.text, { w: col.w, h: px * 2.6 }, { ...spec(p.strapline), minSize: 9, maxSize: px, lineHeight: 1.12, maxLines: 2 }); if (f.fits) { const h = r(f.height); later.push(put(p.strapline, "kva_strapline", { x: m, y: H - r(H * 0.024) - h, w: col.w, h }, { fontSize: f.fontSize, text: f.lines.join("\n"), lineHeight: 1.12, letterSpacing: p.strapline.letterSpacing !== undefined ? (p.strapline.letterSpacing * f.fontSize) / p.strapline.fontSize : undefined } as Partial<FreeformText>)); rowTop = Math.min(rowTop, H - r(H * 0.024) - h); } else drop(straplineSlot, "Strapline left out: it cannot be set legibly at this size."); }
    }
    const gap = Math.max(6, r(H * 0.028));
    const ps = pillSize(W - m * 2, tower ? W - m * 2 : W * (W <= 400 ? 0.56 : 0.46));
    // Online sizes are read at arm's length, not across a street: their copy
    // is set larger against the width than the poster's.
    const copy = setCopy({ x: m, y: 0, w: W - m * 2, h: 0 }, "center", clamp(r(W * (W <= 400 ? 0.088 : 0.068)), tower ? 15 : 12, 400), tower ? 3 : 2);
    let pillY = rowTop - gap - ps.h;
    let copyY = pillY - r(gap * 0.9) - copy.h;
    // A narrow tall size binds the anther by WIDTH, leaving height unused.
    // A designer shares that spare height between the gaps rather than
    // leaving one hole under the anther: the copy and the pill move up.
    const zoneTop = titleBottom + r(gap * 0.4);
    const spare = (copyY - r(gap * 0.5) - zoneTop) - (W - mi * 2);
    if (spare > H * 0.06) { copyY -= r(spare * 0.5); pillY -= r(spare * 0.36); notes.push("The anther is as wide as this size allows; the spare height is shared between the gaps so the stack reads as one piece."); }
    later.push(...setPill({ x: (W - ps.w) / 2, y: pillY, w: ps.w, h: ps.h }));
    later.push(...copy.build(copyY));
    antherZone = { x: 0, y: zoneTop, w: W, h: Math.max(40, copyY - r(gap * 0.5) - zoneTop) };
    if (p.pattern) { const h = r(H * 0.188), w = h * aspect(p.pattern); under.push(put(p.pattern, "kva_pattern", { x: W - w + 2, y: H - h, w, h })); }
    shadeBoxes = [{ box: { x: -2, y: -2, w: W + 4, h: r(titleBottom + H * 0.07) }, angle: 180, from: 0.62, to: 0 }, { box: { x: -2, y: r(copyY - H * 0.1), w: W + 4, h: H - r(copyY - H * 0.1) + 2 }, angle: 0, from: 0.86, to: 0, mid: { at: clamp((H - copyY) / Math.max(1, H - (copyY - H * 0.1)), 0.3, 0.9), alpha: W <= 400 ? 0.74 : 0.6 } }];
    if (p.credit) { if (H >= 500 && W >= 260) { const s = within(aspect(p.credit), W * 0.02, H * 0.48); later.push(...putBlock(p.credit, "kva_credit", { x: W - s.w - 3, y: r(H * 0.26), w: s.w, h: s.h })); } else drop("other", "Picture credit left out: it cannot be read at this size — carry it in the media booking."); }
  } else if (kind === "square") {
    // Square: the title leads across the top (right-aligned, clear of the
    // badge); the anther takes the left below it, the copy the right.
    let logoBox: Box | null = null, rowTop = H - m;
    if (p.logo) { const s = within(aspect(p.logo), W * 0.3, clamp(H * 0.1, 16, H * 0.16)); logoBox = { x: W - mi - s.w, y: H - r(H * 0.035) - s.h, w: s.w, h: s.h }; later.push(put(p.logo, "kva_logo", logoBox, { slot: "lockup" } as Partial<FreeformImage>)); rowTop = logoBox.y; }
    if (p.title) { const s = within(aspect(p.title), W * 0.66, H * 0.27); const b = { x: W - mi - s.w, y: r(H * 0.035), w: s.w, h: s.h }; later.push(...putBlock(p.title, "kva_title", b)); titleBottom = b.y + b.h; }
    const zTop = titleBottom - r(H * 0.02);
    const zw = r(Math.min(W * 0.6, (H - zTop) * 1.02));
    const cx = zw + r(m * 0.1), cw = W - cx - m;
    const ps = pillSize(cw, cw * 0.96);
    const copy = setCopy({ x: cx, y: 0, w: cw, h: 0 }, "left", clamp(r(cw * 0.125), 12, 300), 2);
    const gap = Math.max(5, r(H * 0.032));
    const blockH = copy.h + gap + ps.h;
    const y0 = clamp(titleBottom + (rowTop - titleBottom - blockH) * 0.46, titleBottom + gap, Math.max(titleBottom + gap, rowTop - gap - blockH));
    later.push(...copy.build(y0), ...setPill({ x: cx, y: y0 + copy.h + gap, w: ps.w, h: ps.h }));
    if (p.strapline) {
      // Bottom-left, under the anther, where the poster carries it.
      const px = clamp(r(H * 0.024), 9, 40), room = (logoBox ? logoBox.x : W) - m * 2;
      const f = fitText(p.strapline.text, { w: room * 0.5, h: px * 2.6 }, { ...spec(p.strapline), minSize: 9, maxSize: px, lineHeight: 1.12, maxLines: 2 });
      if (f.fits && H >= 400) { const h = r(f.height); later.push(put(p.strapline, "kva_strapline", { x: m, y: H - r(H * 0.04) - h, w: room * 0.5, h }, { fontSize: f.fontSize, text: f.lines.join("\n"), lineHeight: 1.12, letterSpacing: p.strapline.letterSpacing !== undefined ? (p.strapline.letterSpacing * f.fontSize) / p.strapline.fontSize : undefined } as Partial<FreeformText>)); rowTop = Math.min(rowTop, H - r(H * 0.04) - h); }
      else drop(straplineSlot, "Strapline left out: it cannot be set legibly at this size.");
    }
    antherZone = { x: 0, y: zTop, w: zw, h: rowTop - r(gap * 0.3) - zTop };
    if (p.pattern) { const h = r(H * 0.2), w = h * aspect(p.pattern); under.push(put(p.pattern, "kva_pattern", { x: W - w + 2, y: H - h, w, h })); }
    shadeBoxes = [{ box: { x: -2, y: -2, w: W + 4, h: r(titleBottom + H * 0.08) }, angle: 180, from: 0.66, to: 0 }, { box: { x: r(zw * 0.8), y: -2, w: W - r(zw * 0.8) + 2, h: H + 4 }, angle: 90, from: 0, to: 0.8 }, { box: { x: -2, y: r(H * 0.76), w: W + 4, h: H - r(H * 0.76) + 2 }, angle: 0, from: 0.6, to: 0 }];
    if (p.credit) drop("other", "Picture credit left out: this layout has no edge for it — carry it in the media booking.");
  } else if (kind === "column") {
    // Anther on the LEFT (its stem runs off that edge); copy column on the right.
    const zw = r(Math.min(W * 0.52, H * 1.02));
    const cx = zw + r(m * 0.2), cw = W - cx - m;
    let logoBox: Box | null = null, rowTop = H - m;
    if (p.logo) { const s = within(aspect(p.logo), cw * 0.5, clamp(H * 0.115, 16, H * 0.18)); logoBox = { x: W - mi - s.w, y: H - r(H * 0.035) - s.h, w: s.w, h: s.h }; later.push(put(p.logo, "kva_logo", logoBox, { slot: "lockup" } as Partial<FreeformImage>)); rowTop = logoBox.y; }
    if (p.strapline) {
      const room = (logoBox ? logoBox.x : W) - cx - m;
      const px = clamp(r(H * 0.03), 9, 40); const f = room > 110 ? fitText(p.strapline.text, { w: room, h: px * 2.6 }, { ...spec(p.strapline), minSize: 9, maxSize: px, lineHeight: 1.12, maxLines: 2 }) : null;
      if (f?.fits) { const h = r(f.height); later.push(put(p.strapline, "kva_strapline", { x: cx, y: H - r(H * 0.04) - h, w: room, h }, { fontSize: f.fontSize, text: f.lines.join("\n"), lineHeight: 1.12, letterSpacing: p.strapline.letterSpacing !== undefined ? (p.strapline.letterSpacing * f.fontSize) / p.strapline.fontSize : undefined } as Partial<FreeformText>)); rowTop = Math.min(rowTop, H - r(H * 0.04) - h); }
      else drop(straplineSlot, "Strapline left out: no legible room beside the logo in the copy column.");
    }
    if (p.title) { const s = within(aspect(p.title), cw + mi, H * 0.32); const b = { x: cx - mi, y: r(H * 0.04), w: s.w, h: s.h }; later.push(...putBlock(p.title, "kva_title", b)); titleBottom = b.y + b.h; }
    const ps = pillSize(cw, cw * 0.74);
    const copy = setCopy({ x: cx, y: 0, w: cw, h: 0 }, "left", clamp(r(Math.min(cw * 0.105, H * 0.08)), 12, 300), 2);
    const gap = Math.max(5, r(H * 0.035));
    const blockH = copy.h + gap + ps.h;
    const y0 = clamp(titleBottom + (rowTop - titleBottom - blockH) / 2, titleBottom + r(gap * 0.5), Math.max(titleBottom + r(gap * 0.5), rowTop - gap - blockH));
    later.push(...copy.build(y0), ...setPill({ x: cx, y: y0 + copy.h + gap, w: ps.w, h: ps.h }));
    antherZone = { x: 0, y: 0, w: zw, h: H };
    if (p.pattern) { const h = r(H * 0.22), w = h * aspect(p.pattern); under.push(put(p.pattern, "kva_pattern", { x: W - w + 2, y: H - h, w, h })); }
    shadeBoxes = [{ box: { x: r(zw * 0.72), y: -2, w: W - r(zw * 0.72) + 2, h: H + 4 }, angle: 90, from: 0, to: 0.82 }, { box: { x: -2, y: r(H * 0.72), w: W + 4, h: H - r(H * 0.72) + 2 }, angle: 0, from: 0.55, to: 0 }];
    if (p.credit) drop("other", "Picture credit left out: this layout has no edge for it — carry it in the media booking.");
  } else if (kind === "banner") {
    // Anther · title over copy · pill over logo.
    const zw = r(H * 1.02);
    const x0 = zw + r(m * 0.2), midW = r((W - x0 - m) * 0.6), rx = x0 + midW + m, rw = W - rx - m;
    if (p.title) { const s = within(aspect(p.title), midW + mi, H * 0.46); const b = { x: x0 - mi, y: r(H * 0.05), w: s.w, h: s.h }; later.push(...putBlock(p.title, "kva_title", b)); titleBottom = b.y + b.h; }
    const copy = setCopy({ x: x0, y: 0, w: midW, h: 0 }, "left", clamp(r(H * 0.115), 11, 200), 2);
    later.push(...copy.build(clamp(titleBottom + r(H * 0.03), 0, H - m - copy.h)));
    const ps = pillSize(rw, rw * 0.92);
    later.push(...setPill({ x: W - m - ps.w, y: r(H * 0.2), w: ps.w, h: ps.h }));
    if (p.logo) { const s = within(aspect(p.logo), rw * 0.9, H * 0.3); later.push(put(p.logo, "kva_logo", { x: W - m - s.w + r(mi * 0.4), y: H - r(H * 0.08) - s.h, w: s.w, h: s.h }, { slot: "lockup" } as Partial<FreeformImage>)); }
    if (p.strapline) drop(straplineSlot, "Strapline left out: a banner carries the title, the event, the pill and the logo.");
    if (p.credit) drop("other", "Picture credit left out: it cannot be read at this size — carry it in the media booking.");
    antherZone = { x: 0, y: 0, w: zw, h: H };
    if (p.pattern) { const h = r(H * 0.34), w = h * aspect(p.pattern); under.push(put(p.pattern, "kva_pattern", { x: W - w + 2, y: H - h, w, h })); }
    shadeBoxes = [{ box: { x: r(zw * 0.7), y: -2, w: W - r(zw * 0.7) + 2, h: H + 4 }, angle: 90, from: 0, to: 0.84 }];
  } else {
    // Strip: anther · title · copy · pill · logo, in one row.
    // Below 400px wide there is no room for the anther AND a legible pill:
    // the device leaves, the photograph stays full-bleed on its subject.
    const micro = W < 400;
    if (micro) { showAnther = false; drop("cutout", "Anther left out: on a strip this small it would be under 48px and crowd out the web address. The photograph stays, centred on the subject."); }
    const zw = r(H * 1.12);
    let x = micro ? m : zw + r(m * 0.4), right = W - mi;
    if (p.logo) { const s = within(aspect(p.logo), W * (micro ? 0.23 : 0.2), H * 0.62); right -= s.w; later.push(put(p.logo, "kva_logo", { x: right, y: (H - s.h) / 2, w: s.w, h: s.h }, { slot: "lockup" } as Partial<FreeformImage>)); right -= micro ? r(m * 1.6) : m; }
    const ps = pillSize(W * (micro ? 0.42 : 0.3), (H * 0.36) * (ctaBox ? aspect(ctaBox) : 6));
    right -= ps.w; later.push(...setPill({ x: right, y: (H - ps.h) / 2, w: ps.w, h: ps.h })); right -= micro ? r(m * 1.6) : m;
    if (p.title) { const s = within(aspect(p.title), micro ? right - x + mi : (right - x) * 0.5, H * (micro ? 0.8 : 0.74)); later.push(...putBlock(p.title, "kva_title", { x: x - mi, y: (H - s.h) / 2, w: s.w, h: s.h })); x += s.w + r(m * 0.3); }
    const room = right - x;
    if (room >= 120) { const copy = setCopy({ x, y: 0, w: room, h: 0 }, "left", clamp(r(H * 0.2), 10, 40), 2); if (copy.fits && copy.h <= H - 6) later.push(...copy.build((H - copy.h) / 2)); else drop("headline", "Event copy left out: the strip carries the title, the pill and the logo."); }
    else drop("headline", "Event copy left out: the strip carries the title, the pill and the logo.");
    if (p.badge) drop("other", "Badge left out: it cannot be read on a strip.");
    if (p.strapline) drop(straplineSlot, "Strapline left out: a strip carries the title, the pill and the logo.");
    if (p.pattern) drop("band", "Pattern left out: strips carry no pattern.");
    if (p.credit) drop("other", "Picture credit left out: it cannot be read at this size — carry it in the media booking.");
    antherZone = { x: 0, y: 0, w: zw, h: H };
    shadeBoxes = micro ? [{ box: { x: -2, y: -2, w: W + 4, h: H + 4 }, angle: 90, from: 0.72, to: 0.8 }] : [{ box: { x: r(zw * 0.8), y: -2, w: W - r(zw * 0.8) + 2, h: H + 4 }, angle: 90, from: 0.2, to: 0.78 }];
  }

  // The anther: whole, as large as its zone's margins allow, stem off the edge.
  const placed = placeAnther(antherZone, { w: W, h: H }, p.anther.shape.aspect ? { w: p.anther.shape.aspect * 1000, h: 1000 } : { w: p.anther.w, h: p.anther.h }, p.anther.shape, kind === "strip" ? 3 : mi, kind === "tall" ? r(mi * 0.4) : undefined);
  const antherEl = put(p.anther, "kva_anther", placed.box, { slot: "cutout", fit: "contain" } as Partial<FreeformImage>);
  if (showAnther) notes.push(`${ANTHER_RULE.title}: shown whole, as large as the margins allow, its stem running off the artwork's edge.`, ...placed.notes);

  // Rule 1: the photograph behind stays locked to the anther (one picture).
  const k = placed.box.w / p.anther.w;
  let bgBox: Box = { x: placed.box.x + (p.bg.x - p.anther.x) * k, y: placed.box.y + (p.bg.y - p.anther.y) * k, w: p.bg.w * k, h: p.bg.h * k };
  const covers = (b: Box) => b.x <= 0.5 && b.y <= 0.5 && b.x + b.w >= W - 0.5 && b.y + b.h >= H - 0.5;
  if (!covers(bgBox)) {
    // Not enough picture at that scale: enlarge it about the anther's centre.
    const c = placed.circle, u = (c.cx - bgBox.x) / bgBox.w, v = (c.cy - bgBox.y) / bgBox.h;
    const need = Math.max(W / bgBox.w, H / bgBox.h, c.cx / (u * bgBox.w), (W - c.cx) / ((1 - u) * bgBox.w), c.cy / (v * bgBox.h), (H - c.cy) / ((1 - v) * bgBox.h));
    const s = Math.max(1, need) * 1.002;
    bgBox = { x: c.cx - u * bgBox.w * s, y: c.cy - v * bgBox.h * s, w: bgBox.w * s, h: bgBox.h * s };
    notes.push("The photograph behind the anther is enlarged to fill this shape; the picture inside the anther is unchanged.");
  }
  out.push(put(p.bg, "kva_photo", bgBox, { slot: "photo", fit: "cover", focusX: undefined, focusY: undefined, focusBox: undefined } as Partial<FreeformImage>));
  const shadeColour = p.shade?.fill ?? "#140d06";
  shadeBoxes.forEach((sb, i) => out.push({ id: `kva_shade_${i}`, type: "rect", slot: "scrim", fill: shadeColour, x: r(sb.box.x), y: r(sb.box.y), w: r(sb.box.w), h: r(sb.box.h), locked: true, gradient: { angle: sb.angle, stops: [{ color: shadeColour, alpha: sb.from, at: 0 }, ...(sb.mid ? [{ color: shadeColour, alpha: sb.mid.alpha, at: sb.mid.at }] : []), { color: shadeColour, alpha: sb.to, at: 1 }] } } as FreeformRect));
  out.push(...under, ...(showAnther ? [antherEl] : []));

  // The badge rides on the anther's upper-left shoulder, clear of the title.
  if (p.badge && kind !== "strip" && showAnther) {
    const c = placed.circle, d = c.r * 2 * 0.31;
    if (d < 44) drop("other", "Badge left out: it cannot be read at this size.");
    else {
      const bx = clamp(c.cx - c.r * 0.79 - d / 2, mi, W - mi - d), by = clamp(c.cy - c.r * 0.89 - d / 2, titleBottom > 0 && kind === "tall" ? titleBottom - d * 0.12 : mi, H - mi - d);
      out.push(...putBlock(p.badge, "kva_badge", { x: bx, y: by, w: d, h: d / aspect(p.badge) }));
    }
  }
  out.push(...later);

  notes.unshift(`Key visual composed as a ${kind === "tall" ? "tall stack" : kind === "square" ? "square (title across the top, anther left, copy right)" : kind === "column" ? "two-column layout (anther left, copy right)" : kind === "banner" ? "banner (anther · title and event · pill and logo)" : "strip (anther · title · event · pill · logo)"}.`);
  return {
    config: { kind: "freeform", elements: out, adaptMethod: "key-visual:anther", adaptNotes: notes, ...(dropped.length ? { droppedParts: dropped, needsReview: true } : {}) } as FreeformConfig,
    notes,
    formatKind: kind,
  };
}
