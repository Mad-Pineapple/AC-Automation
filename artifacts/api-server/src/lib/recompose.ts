/**
 * The recomposer: rebuild a master for a canvas of a different shape the
 * way the studio does — from parts, along the axis the canvas asks for.
 *
 * Shipped AC creative (AEM Get Ready, docs/complex-size-layouts.md) never
 * scales a layout into a skyscraper or a billboard. The photo is re-cropped
 * and panned, the headline is re-set to fill the photo zone, the solid
 * panel moves from below the photo to beside it, the kotahitanga band tiles
 * along the seam, and the CTA keeps its pixel size. Body copy is dropped
 * before anything shrinks below legibility.
 *
 * Pipeline: slots (lib/slots.ts) → format class + budget (lib/formatCatalog)
 * → recipe (lib/recipes.ts) → this solver, which places each slot with real
 * text measurement (lib/textMeasure.ts) and returns an ordinary freeform
 * config, so the editor, exports and renderers need nothing new.
 *
 * Deterministic: the same master and target always produce the same layout.
 */
import sharp from "sharp";
import type { DroppedPart, FreeformConfig, FreeformElement, FreeformImage, FreeformRect, FreeformText, LayoutOption } from "./freeform";
import { aspectDistance, classifyAspect, classifyBudget, needsRebuild, type FormatClass, type PixelBudget } from "./formatCatalog";
import { inferSlots, type Box, type SemanticMaster } from "./slots";
import { recipeFor, type Recipe } from "./recipes";
import { fitText, prepareMeasurement, type FontSpec, capHeightPx, fontResolution } from "./textMeasure";
import { planCta, type CtaPlan } from "./ctaPlan";
import { LABEL_FLOOR_PX, type RuleLayer } from "./partRulesLayer";
import { guidelineLogoPlacement, isSocialSquare } from "./logoRules";
import { ObjectStorageService } from "./objectStorage";

const OCEAN = "#11263d";
const HEADLINE_MIN_PX = 12;

export interface RecomposeBrand {
  logoUrl: string | null;
  strapline?: string | null;
}

export interface RecomposeOptions {
  brand: RecomposeBrand;
  /** Natural pixel size of an image src; defaults to object storage + sharp. */
  loadImageSize?: (src: string) => Promise<{ w: number; h: number } | null>;
  /** Recipe fields measured off an approved piece of the same family
   * (lib/exemplars.ts); they win over the class recipe. */
  recipeOverrides?: Partial<Recipe>;
  /** Format class decided from the brief's name/channel; overrides the
   * dimensions-only classification. */
  formatClass?: FormatClass;
  /** The campaign's part rules (lib/partRulesLayer.ts): floors, drops, pins. */
  rules?: RuleLayer;
}

export interface RecomposeResult {
  config: FreeformConfig;
  formatClass: FormatClass;
  budget: PixelBudget;
  axis: Recipe["axis"];
  notes: string[];
  /** True when a slot was missing or dropped — a designer should look. */
  needsReview: boolean;
}

// ---------------------------------------------------------------------------
// Image sizes (cached per process)
// ---------------------------------------------------------------------------

const storage = new ObjectStorageService();
const sizeCache = new Map<string, { w: number; h: number } | null>();

async function defaultImageSize(src: string): Promise<{ w: number; h: number } | null> {
  if (sizeCache.has(src)) return sizeCache.get(src) ?? null;
  let out: { w: number; h: number } | null = null;
  try {
    const objectPath = src.replace(/^\/api\/storage/, "");
    const file = await storage.getObjectEntityFile(objectPath);
    const response = await storage.downloadObject(file);
    const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    if (meta.width && meta.height) out = { w: meta.width, h: meta.height };
  } catch {
    out = null;
  }
  sizeCache.set(src, out);
  return out;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r = (v: number) => Math.round(v);

/** Cover-fit an image into `zone`, oversized so the subject can be panned
 * to `target` (zone fractions), clamped so the zone stays covered. */
function coverPlace(
  zone: Box,
  imgW: number,
  imgH: number,
  focus: { x: number; y: number },
  oversize: number,
  target: { x: number; y: number },
  box?: { x: number; y: number; w: number; h: number } | null,
): Box {
  const s = Math.max(zone.w / imgW, zone.h / imgH) * oversize;
  const w = imgW * s;
  const h = imgH * s;
  let x = clamp(zone.x + zone.w * target.x - focus.x * w, zone.x + zone.w - w, zone.x);
  let y = clamp(zone.y + zone.h * target.y - focus.y * h, zone.y + zone.h - h, zone.y);
  if (box) {
    // The subject box (fractions of the image) stays inside the zone when it
    // fits; when it is wider or taller than the zone the crop centres on it.
    const bx0 = x + box.x * w, bx1 = bx0 + box.w * w, by0 = y + box.y * h, by1 = by0 + box.h * h;
    if (box.w * w <= zone.w) { if (bx0 < zone.x) x += zone.x - bx0; else if (bx1 > zone.x + zone.w) x -= bx1 - (zone.x + zone.w); }
    if (box.h * h <= zone.h) { if (by0 < zone.y) y += zone.y - by0; else if (by1 > zone.y + zone.h) y -= by1 - (zone.y + zone.h); }
    x = clamp(x, zone.x + zone.w - w, zone.x); y = clamp(y, zone.y + zone.h - h, zone.y);
  }
  return { x: r(x), y: r(y), w: r(w), h: r(h) };
}

function fontSpec(t: FreeformText | null | undefined, scale = 1): FontSpec {
  return {
    family: t?.fontFamily,
    weight: t?.fontWeight === 700 ? 700 : 400,
    italic: t?.fontStyle === "italic",
    letterSpacing: t?.letterSpacing !== undefined ? t.letterSpacing * scale : undefined,
  };
}

function textEl(
  id: string,
  slot: FreeformText["slot"],
  role: FreeformText["role"],
  from: FreeformText,
  box: Box,
  fontSize: number,
  text: string,
  align: FreeformText["align"],
  lineHeight: number,
  extra: Partial<FreeformText> = {},
): FreeformText {
  const scale = fontSize / Math.max(1, from.fontSize);
  return {
    id,
    type: "text",
    slot,
    role,
    text,
    x: r(box.x),
    y: r(box.y),
    w: r(box.w),
    h: r(box.h),
    fontSize,
    fontWeight: from.fontWeight,
    color: from.color,
    align,
    lineHeight,
    ...(from.fontFamily ? { fontFamily: from.fontFamily } : {}),
    ...(from.fontStyle === "italic" ? { fontStyle: "italic" as const } : {}),
    ...(from.letterSpacing !== undefined ? { letterSpacing: from.letterSpacing * scale } : {}),
    ...(from.opacity !== undefined ? { opacity: from.opacity } : {}),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The solver
// ---------------------------------------------------------------------------

/** Whether the recomposer should handle this master→target pair.
 *
 * Any change of shape class is a rebuild. A panel master (photo stacked over
 * or beside a brand panel) is also rebuilt for same-class targets that are
 * not near-identical in shape: geometric scaling of a stack leaves gaps and
 * shrinks the CTA, while the recipe reproduces the studio's own treatment.
 * Full-bleed key visuals keep the key-visual engine for same-class targets. */
export function shouldRecompose(master: FreeformConfig, srcW: number, srcH: number, dstW: number, dstH: number): boolean {
  if (needsRebuild(srcW, srcH, dstW, dstH)) return true;
  const dist = aspectDistance(srcW, srcH, dstW, dstH);
  if (dist <= SAME_SHAPE_TOLERANCE) return false;
  const axis = inferSlots(master, srcW, srcH).axis;
  return axis === "stacked" || axis === "side";
}

/** Shapes closer than this are "the same": scale, don't rebuild. */
const SAME_SHAPE_TOLERANCE = 0.08;

export async function recomposeToFormat(
  master: FreeformConfig,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  opts: RecomposeOptions,
): Promise<RecomposeResult | null> {
  const sem: SemanticMaster = inferSlots(master, srcW, srcH);
  // No live headline (image-only working files, flat art) → nothing to
  // re-set; the route falls through to the other engines or refuses.
  if (!sem.headline) return null;

  await prepareMeasurement();
  const loadSize = opts.loadImageSize ?? defaultImageSize;

  const formatClass = opts.formatClass ?? classifyAspect(dstW, dstH);
  const budget = classifyBudget(dstW, dstH);
  const base = recipeFor(formatClass, budget);
  const ovAll = opts.recipeOverrides ?? {};
  // An approved piece's axis-bound numbers (axis, photo and band shares,
  // headline position and size) only apply when it lays out along the same
  // axis as this class: a wide approved piece must not turn a portrait into
  // columns. Pill, lockup and copy ratios carry across either way.
  const sameAxis = !ovAll.axis || ovAll.axis === base.axis;
  const AXIS_BOUND = new Set(["axis", "photoFrac", "bandFrac", "headlineCentreFrac", "headlineCentreFracBare", "headlineWidthFrac", "headlineMaxHeightFrac"]);
  const ov: Partial<Recipe> = sameAxis ? ovAll : (Object.fromEntries(Object.entries(ovAll).filter(([k]) => !AXIS_BOUND.has(k))) as Partial<Recipe>);
  const recipe: Recipe = { ...base, ...ov, axis: base.axis === "row" ? "row" : (ov.axis ?? base.axis), keep: base.keep };
  const keep = new Set(recipe.keep);
  const short = Math.min(dstW, dstH);
  const margin = Math.max(4, r(short * recipe.marginFrac));
  const social = isSocialSquare(dstW, dstH);
  const notes: string[] = [...sem.notes];
  let needsReview = sem.notes.length > 0;
  const dropped: DroppedPart[] = [];
  const drop = (slot: string, reason: string, byRule: boolean) => { dropped.push({ slot, reason, byRule }); notes.push(reason); };
  const panelFill = sem.panelFill ?? OCEAN;
  const rules = opts.rules;
  const headlineMin = rules?.floor("headline") ?? HEADLINE_MIN_PX;
  const sublineMin = rules?.floor("subheadline") ?? 10;
  const messageMin = rules?.floor("message") ?? 13;
  const lockupMin = rules?.floor("lockup") ?? 16;
  const hasPhoto = !!(sem.photo && sem.photo.src && keep.has("photo"));
  const hasBand = !!(sem.band && sem.band.src && keep.has("band") && recipe.bandAt !== "none" && rules?.pin("band") !== "none");

  // ---- Zones ---------------------------------------------------------------
  let photoZone: Box;
  let bandZone: Box | null = null;
  let panelZone: Box;
  let tileZone: Box | null = null; // strip: full-height logo tile on the right
  if (recipe.axis === "stacked") {
    const ph = r(dstH * recipe.photoFrac);
    const bh = hasBand ? Math.max(4, r(dstH * recipe.bandFrac)) : 0;
    photoZone = { x: 0, y: 0, w: dstW, h: ph };
    if (hasBand) bandZone = { x: 0, y: ph, w: dstW, h: bh };
    panelZone = { x: 0, y: ph + bh, w: dstW, h: dstH - ph - bh };
  } else if (recipe.axis === "side") {
    const pw = r(dstW * recipe.photoFrac);
    const bh = hasBand ? clamp(r(dstH * recipe.bandFrac), 4, r(dstH * 0.2)) : 0;
    photoZone = { x: 0, y: 0, w: pw, h: dstH };
    if (hasBand) bandZone = { x: pw, y: 0, w: dstW - pw, h: bh };
    panelZone = { x: pw, y: bh, w: dstW - pw, h: dstH - bh };
  } else {
    const tile = opts.brand.logoUrl && !social ? dstH : 0;
    const pw = hasPhoto ? clamp(Math.max(r(dstH * 1.3), r(dstW * recipe.photoFrac)), 0, r(dstW * 0.42)) : 0;
    photoZone = { x: 0, y: 0, w: pw, h: dstH };
    panelZone = { x: pw, y: 0, w: dstW - pw - tile, h: dstH };
    if (tile) tileZone = { x: dstW - tile, y: 0, w: tile, h: tile };
  }

  const elements: FreeformElement[] = [];
  const options: LayoutOption[] = [];

  // ---- 1. Panel ground -------------------------------------------------------
  elements.push({ id: "rc_panel", type: "rect", slot: "panel", fill: panelFill, x: 0, y: 0, w: dstW, h: dstH, locked: true } as FreeformRect);

  // ---- 2. Photo ----------------------------------------------------------------
  if (hasPhoto && sem.photo) {
    const photo = sem.photo;
    const natural = (await loadSize(photo.src as string)) ?? { w: photo.w, h: photo.h };
    const focus = photo.focusBox
      ? { x: photo.focusBox.x + photo.focusBox.w / 2, y: photo.focusBox.y + photo.focusBox.h / 2 }
      : { x: photo.focusX ?? 0.5, y: photo.focusY ?? 0.45 };
    // Tall zones want the subject a touch below centre (headline sits above
    // it); wide zones want it centred.
    const target = recipe.axis === "stacked" ? { x: 0.5, y: 0.55 } : { x: 0.5, y: 0.5 };
    const subjectBox = photo.focusSource === "vision" || photo.focusSource === "designer" ? photo.focusBox ?? null : null;
    const placed = coverPlace(photoZone, natural.w, natural.h, focus, recipe.photoOversize, target, subjectBox);
    if (subjectBox && photo.subject) {
      const fits = subjectBox.w * placed.w <= photoZone.w + 0.5 && subjectBox.h * placed.h <= photoZone.h + 0.5;
      notes.push(fits ? `Photo window keeps ${photo.subject} whole.` : `Check: ${photo.subject} is larger than this photo window; the crop is centred on it.`);
    }
    elements.push({
      ...photo,
      id: "rc_photo",
      slot: "photo",
      role: "product",
      fit: "cover",
      ...placed,
      locked: false,
    } as FreeformImage);
  } else if (sem.photo && !keep.has("photo")) {
    drop("photo", "Photo dropped: this format has no room for it.", false);
  }

  // ---- 3. Scrim over the photo zone ------------------------------------------------
  if (hasPhoto && sem.headline && keep.has("headline")) {
    const ms = sem.scrim;
    const frac = ms && sem.photoBox ? clamp(ms.h / Math.max(1, sem.photoBox.h), 0.35, 1) : 0.75;
    const topAligned = !ms || !sem.photoBox || ms.y <= sem.photoBox.y + sem.photoBox.h * 0.15;
    const sh = r(photoZone.h * (recipe.axis === "row" ? 1 : frac));
    const box: Box = { x: photoZone.x, y: topAligned ? photoZone.y : photoZone.y + photoZone.h - sh, w: photoZone.w, h: sh };
    const gradient = ms?.gradient ?? {
      angle: topAligned ? 180 : 0,
      stops: [
        { color: OCEAN, alpha: 0.6, at: 0 },
        { color: OCEAN, alpha: 0, at: 1 },
      ],
    };
    elements.push({
      id: "rc_scrim",
      type: "rect",
      slot: "scrim",
      fill: ms?.fill ?? OCEAN,
      ...box,
      gradient,
      locked: true,
    } as FreeformRect);
  }

  // ---- 4. Cut-out on the photo ---------------------------------------------------------
  const cutout = sem.cutouts[0];
  if (cutout && hasPhoto && keep.has("cutout") && recipe.cutoutWidthFrac > 0) {
    const natural = (await loadSize(cutout.src as string)) ?? { w: cutout.w, h: cutout.h };
    const w = r(photoZone.w * recipe.cutoutWidthFrac);
    const h = r((w * natural.h) / Math.max(1, natural.w));
    const x = recipe.axis === "stacked" ? photoZone.x + r((photoZone.w - w) / 2) : photoZone.x + margin;
    const y = photoZone.y + photoZone.h - h;
    elements.push({ ...cutout, id: "rc_cutout", slot: "cutout", role: "decoration", fit: "contain", x, y, w, h } as FreeformImage);
  }

  // ---- 5. Panel zone (hides the photo's oversize spill) -----------------------------------
  if (hasPhoto && (panelZone.w < dstW || panelZone.h < dstH)) {
    elements.push({ id: "rc_panel_zone", type: "rect", slot: "panel", fill: panelFill, ...panelZone, locked: true } as FreeformRect);
    if (bandZone) elements.push({ id: "rc_band_ground", type: "rect", slot: "panel", fill: panelFill, ...bandZone, locked: true } as FreeformRect);
  }

  // ---- 6. Band, tiled along the seam ------------------------------------------------------
  if (hasBand && bandZone && sem.band) {
    const natural = (await loadSize(sem.band.src as string)) ?? { w: sem.band.w, h: sem.band.h };
    const aspect = natural.w / Math.max(1, natural.h);
    const tileW = Math.max(8, r(bandZone.h * aspect));
    const n = Math.min(12, Math.ceil(bandZone.w / tileW));
    for (let i = 0; i < n; i++) {
      elements.push({
        ...sem.band,
        id: `rc_band_${i}`,
        slot: "band",
        role: "decoration",
        fit: "cover",
        x: bandZone.x + i * tileW,
        y: bandZone.y,
        w: tileW,
        h: bandZone.h,
        locked: true,
      } as FreeformImage);
    }
  } else if (sem.band && recipe.bandAt === "none") {
    drop("band", "Pattern band dropped: strips carry photo, headline, CTA and logo only.", true);
  }

  // ---- CTA plan: the pill is sized from its measured label (lib/ctaPlan.ts) ------------------
  // Planned before the headline so a strip's headline is fitted beside the
  // real pill instead of an estimate it later overlaps.
  const CTA_MIN_PX = rules?.rules.cta?.minPx ?? (budget === "micro" ? 18 : 24);
  const ctaPlanned = (): CtaPlan | null => {
    if (!sem.cta || !keep.has("cta")) return null;
    const cta = sem.cta;
    const maxH = recipe.axis === "row" ? dstH * 0.64 : panelZone.h * 0.4;
    const targetH = Math.max(recipe.ctaFloorPx, short * recipe.ctaHeightFrac);
    if (!sem.ctaLabel) {
      // A pill with no live label keeps the master's proportions.
      const aspect = cta.w / Math.max(1, cta.h) || 4;
      const h = r(clamp(targetH, CTA_MIN_PX, maxH));
      const w = r(Math.min(h * aspect, panelZone.w * recipe.ctaMaxWidthFrac));
      return { h, w, fontSize: 0, padX: r(h * 0.45), iconSize: 0, iconGap: 0, lines: [], fits: true, labelRatio: 0.5, padRatio: 0.45, notes: [] };
    }
    return planCta({
      label: sem.ctaLabel.text,
      spec: fontSpec(sem.ctaLabel),
      master: { ctaH: cta.h, ctaW: cta.w, labelFontSize: sem.ctaLabel.fontSize, labelText: sem.ctaLabel.text, labelSpec: fontSpec(sem.ctaLabel), hasIcon: !!sem.ctaIcon },
      targetH,
      minH: CTA_MIN_PX,
      maxH,
      maxW: panelZone.w * (recipe.axis === "row" ? 0.5 : Math.min(0.92, recipe.ctaMaxWidthFrac + 0.15)),
      minLabelPx: budget === "micro" ? Math.min(8, LABEL_FLOOR_PX) : LABEL_FLOOR_PX,
      icon: !!sem.ctaIcon,
      allowTwoLines: formatClass === "tower" || dstW < 200,
    });
  };
  if (sem.headline) {
    const res = fontResolution(fontSpec(sem.headline));
    if (res.substituted) notes.push(`Check: the headline was measured in ${res.used} because "${res.requested}" is not registered on this server — confirm its width on export.`);
  }

  // ---- 7. Headline (+ sub-headline) ----------------------------------------------------------
  const copyZone: Box = recipe.axis === "row" ? panelZone : photoZone;
  if (sem.headline && keep.has("headline")) {
    const hl = sem.headline;
    const rawText = hl.text.replace(/\s+/g, " ").trim();
    const words = rawText.split(" ").filter(Boolean);
    const text = recipe.headlineWordPerLine && words.length > 1 ? words.join("\n") : rawText;
    const zoneW = copyZone.w - margin * 2;
    if (recipe.axis === "row") {
      // One row: headline flexes between the photo and the CTA.
      const ctaW = ctaPlanned()?.w ?? 0;
      const box: Box = { x: panelZone.x + margin, y: panelZone.y, w: Math.max(20, panelZone.w - ctaW - margin * 3), h: dstH };
      let fit = fitText(text, { w: box.w, h: dstH * recipe.headlineMaxHeightFrac }, { ...fontSpec(hl), minSize: headlineMin, maxSize: dstH, lineHeight: 1.0, maxLines: 1 });
      if (!fit.fits) fit = fitText(text, { w: box.w, h: dstH * 0.86 }, { ...fontSpec(hl), minSize: headlineMin, maxSize: dstH, lineHeight: 1.0, maxLines: 2 });
      const h = r(fit.height);
      elements.push(textEl("rc_headline", "headline", "headline", hl, { x: box.x, y: r((dstH - h) / 2), w: box.w, h }, fit.fontSize, fit.lines.join("\n"), "left", 1.0));
      if (!fit.fits) { notes.push("Headline does not fit the strip at the minimum size — shorten the copy."); needsReview = true; }
      if (sem.kicker) drop("kicker", "Kicker line dropped: strips carry the headline only.", true);
    } else {
      const maxLines = recipe.headlineWordPerLine ? Math.max(1, words.length) : 2;
      const box = { w: zoneW * recipe.headlineWidthFrac, h: copyZone.h * recipe.headlineMaxHeightFrac };
      const fit = fitText(text, box, { ...fontSpec(hl), minSize: headlineMin, maxSize: copyZone.h, lineHeight: 1.02, maxLines });
      if (!fit.fits) { notes.push("Headline shrank to the floor size and still overflows — shorten the copy."); needsReview = true; }
      const hlH = r(fit.height);
      // Sub-headline rides directly under the headline at the recipe ratio.
      let subFit: ReturnType<typeof fitText> | null = null;
      const sub = sem.subheadline;
      if (sub && keep.has("subheadline")) {
        const subText = sub.text.replace(/\s+/g, " ").trim();
        const subMax = Math.max(sublineMin, r(fit.fontSize * recipe.subheadRatio));
        subFit = fitText(subText, { w: zoneW * 0.9, h: subMax * 2.4 }, { ...fontSpec(sub), minSize: sublineMin, maxSize: subMax, lineHeight: 1.1, maxLines: 2 });
        if (!subFit.fits && budget !== "large" && (rules?.drop("subheadline") ?? true)) { subFit = null; drop("subheadline", "Sub-headline dropped: no legible room under the headline.", rules?.drop("subheadline") === true); }
      }
      // Kicker: the line above the headline, at the master's ratio to it.
      let kickFit: ReturnType<typeof fitText> | null = null;
      const kick = sem.kicker;
      if (kick) {
        const ratio = clamp(kick.fontSize / Math.max(1, hl.fontSize), 0.15, 0.6);
        const kickMax = Math.max(sublineMin, r(fit.fontSize * ratio));
        kickFit = fitText(kick.text.replace(/\s+/g, " ").trim(), { w: zoneW * 0.9, h: kickMax * 2.4 }, { ...fontSpec(kick), minSize: sublineMin, maxSize: kickMax, lineHeight: 1.1, maxLines: 2 });
        if (!kickFit.fits) { kickFit = null; drop("kicker", "Kicker line dropped: no legible room above the headline.", true); }
      }
      const kickGap = kickFit ? r(fit.fontSize * 0.15) : 0;
      const kickH = kickFit ? r(kickFit.height) : 0;
      const gap = subFit ? r(fit.fontSize * 0.12) : 0;
      const blockH = kickH + kickGap + hlH + gap + (subFit ? r(subFit.height) : 0);
      // With no cut-out on the photo, the headline drops onto the subject
      // (shipped Quakes vs Storms) so the lower photo zone never reads empty.
      const hasCutout = elements.some((e) => e.id === "rc_cutout");
      const centreFrac = hasCutout ? recipe.headlineCentreFrac : recipe.headlineCentreFracBare;
      const centreY = copyZone.y + copyZone.h * centreFrac;
      const y0 = r(clamp(centreY - blockH / 2, copyZone.y + margin, copyZone.y + copyZone.h - blockH - margin));
      const hlY = y0 + kickH + kickGap;
      const hlBox: Box = { x: copyZone.x + r((copyZone.w - box.w) / 2), y: hlY, w: r(box.w), h: hlH };
      if (kickFit && kick) {
        const kw = r(zoneW * 0.9);
        elements.push(textEl("rc_kicker", "kicker", "subhead", kick, { x: copyZone.x + r((copyZone.w - kw) / 2), y: y0, w: kw, h: kickH }, kickFit.fontSize, kickFit.lines.join("\n"), "center", 1.1));
      }
      elements.push(textEl("rc_headline", "headline", "headline", hl, hlBox, fit.fontSize, fit.lines.join("\n"), "center", 1.02));
      if (subFit) {
        const sw = r(zoneW * 0.9);
        elements.push(textEl("rc_subheadline", "subheadline", "subhead", sub as FreeformText, { x: copyZone.x + r((copyZone.w - sw) / 2), y: hlY + hlH + gap, w: sw, h: r(subFit.height) }, subFit.fontSize, subFit.lines.join("\n"), "center", 1.1));
      }
      // Alternatives a designer can switch to without re-running.
      const alt = (label: string, frac: number, score: number) => {
        const y = r(clamp(copyZone.y + copyZone.h * frac - blockH / 2, copyZone.y + margin, copyZone.y + copyZone.h - blockH - margin));
        options.push({ label, x: hlBox.x, y, w: hlBox.w, h: hlH, fontSize: fit.fontSize, align: "center", color: hl.color, score });
      };
      alt("Recipe position", centreFrac, 100);
      alt("Headline higher", Math.max(0.15, centreFrac - 0.15), 80);
      alt("Headline lower", Math.min(0.85, centreFrac + 0.15), 70);
    }
  }

  // ---- 8. Panel contents: message, CTA, lockup ---------------------------------------------
  type Item = { kind: "message" | "cta" | "lockup"; w: number; h: number; build: (x: number, y: number) => FreeformElement[] };
  const items: Item[] = [];
  const headlineSize = (elements.find((e) => e.id === "rc_headline") as FreeformText | undefined)?.fontSize ?? r(short * 0.12);

  if (recipe.axis !== "row" && sem.message && keep.has("message")) {
    const msg = sem.message;
    const text = msg.text.replace(/\s+/g, " ").trim();
    const maxSize = Math.max(messageMin, r(headlineSize * recipe.messageMaxRatio));
    const w = r(panelZone.w * 0.85);
    const fit = fitText(text, { w, h: maxSize * 2.5 }, { ...fontSpec(msg), minSize: messageMin, maxSize, lineHeight: 1.15, maxLines: 2 });
    if (fit.fits) {
      const h = r(fit.height);
      items.push({ kind: "message", w, h, build: (x, y) => [textEl("rc_message", "message", "body", msg, { x, y, w, h }, fit.fontSize, fit.lines.join("\n"), "center", 1.15)] });
    } else {
      drop("message", "Message dropped: it would not fit the panel legibly.", rules?.drop("message") === true);
    }
  }

  const ctaPlan = ctaPlanned();
  if (sem.cta && ctaPlan) {
    const cta = sem.cta;
    const ctaW = ctaPlan.w;
    const ctaH = ctaPlan.h;
    const padX = ctaPlan.padX;
    const iconSize = ctaPlan.iconSize;
    for (const n of ctaPlan.notes) notes.push(n);
    if (!ctaPlan.fits) needsReview = true;
    const build = (x: number, y: number): FreeformElement[] => {
      const out: FreeformElement[] = [];
      if (cta.type === "rect") {
        out.push({ id: "rc_cta", type: "rect", slot: "cta", fill: cta.fill, x, y, w: ctaW, h: ctaH, radius: sem.ctaKind === "pill" ? ctaH / 2 : r((cta.radius ?? 0) * (ctaH / Math.max(1, cta.h))), locked: true } as FreeformRect);
      } else {
        out.push({ ...cta, id: "rc_cta", slot: "cta", role: "decoration", fit: "contain", x, y, w: ctaW, h: ctaH, locked: true } as FreeformImage);
      }
      if (sem.ctaLabel && ctaPlan.lines.length > 0) {
        const lw = ctaW - padX * 2 - (iconSize ? iconSize + ctaPlan.iconGap : 0);
        if (ctaPlan.lines.length === 1) {
          // Centre the label's CAP HEIGHT on the pill's centre line — the same
          // cap-fit frame InDesign uses — so the copy sits dead centre in both
          // the export and the editor regardless of font metrics.
          const capH = capHeightPx(fontSpec(sem.ctaLabel), ctaPlan.fontSize);
          const lh = Math.max(1, r(capH));
          out.push(
            textEl("rc_cta_label", "ctaLabel", "cta", sem.ctaLabel, { x: x + padX, y: y + r((ctaH - lh) / 2), w: lw, h: lh }, ctaPlan.fontSize, ctaPlan.lines[0] ?? "", iconSize ? "left" : "center", 1.1, {
              baselineFit: "cap",
            }),
          );
        } else {
          const lh = r(ctaPlan.fontSize * 1.15 * ctaPlan.lines.length);
          out.push(textEl("rc_cta_label", "ctaLabel", "cta", sem.ctaLabel, { x: x + padX, y: y + r((ctaH - lh) / 2), w: lw, h: lh }, ctaPlan.fontSize, ctaPlan.lines.join("\n"), "center", 1.15));
        }
      }
      if (sem.ctaIcon && iconSize) {
        out.push({ ...sem.ctaIcon, id: "rc_cta_icon", slot: "ctaIcon", role: "decoration", fit: "contain", x: x + ctaW - padX - iconSize, y: y + r((ctaH - iconSize) / 2), w: iconSize, h: iconSize, locked: true } as FreeformImage);
      }
      return out;
    };
    items.push({ kind: "cta", w: ctaW, h: ctaH, build });
  }

  if (recipe.axis !== "row" && sem.lockup && sem.lockup.src && keep.has("lockup") && !social) {
    const lk = sem.lockup;
    const natural = (await loadSize(lk.src as string)) ?? { w: lk.w, h: lk.h };
    const aspect = natural.w / Math.max(1, natural.h);
    let h = r(short * recipe.lockupHeightFrac);
    let w = r(h * aspect);
    const maxW = r(panelZone.w * recipe.lockupMaxWidthFrac);
    if (w > maxW) { w = maxW; h = r(w / aspect); }
    // Never below the lockup floor (illegible marks on towers).
    if (h < lockupMin) { h = lockupMin; w = r(h * aspect); if (w > panelZone.w - margin * 2) { w = panelZone.w - margin * 2; h = r(w / aspect); } }
    items.push({ kind: "lockup", w, h, build: (x, y) => [{ ...lk, id: "rc_lockup", slot: "lockup", role: "decoration", fit: "contain", x, y, w, h, locked: true } as FreeformImage] });
  } else if (sem.lockup && social) {
    drop("lockup", "Logo lockup omitted: social squares carry no logo (guidelines).", true);
  }

  if (recipe.axis === "row") {
    // Strip: CTA sits at the right of the panel zone, vertically centred.
    const cta = items.find((i) => i.kind === "cta");
    if (cta) elements.push(...cta.build(panelZone.x + panelZone.w - cta.w - margin, r((dstH - cta.h) / 2)));
    if (tileZone && opts.brand.logoUrl) {
      elements.push({ id: "rc_logo", type: "image", slot: "logo", role: "logo", src: opts.brand.logoUrl, fit: "contain", ...tileZone, locked: true } as FreeformImage);
    }
  } else {
    // Stack the panel items, centred; drop the message, then shrink gaps,
    // when the panel cannot hold everything. When the guideline logo tile
    // will sit bottom-right (no lockup), keep the stack clear of it.
    // The tile is wanted when no lockup ENDS UP in the panel, so it is
    // decided after the drops below (it used to be computed before the
    // lockup could be dropped, leaving neither lockup nor tile).
    const wantsTileNow = () => !items.some((i) => i.kind === "lockup") && !!opts.brand.logoUrl && !social && keep.has("lockup");
    const tileReserve = wantsTileNow() ? (guidelineLogoPlacement(dstW, dstH)?.tile.w ?? 0) : 0;
    const inner = panelZone.h - r(margin * 1.5);
    let gap = clamp(r(panelZone.h * 0.07), 4, 48);
    const total = () => items.reduce((s, i) => s + i.h, 0) + gap * Math.max(0, items.length - 1);
    if (total() > inner && (rules?.drop("message") ?? true)) {
      const idx = items.findIndex((i) => i.kind === "message");
      if (idx >= 0) { items.splice(idx, 1); drop("message", "Message dropped: the panel is too short for message, CTA and lockup.", rules?.drop("message") === true); }
    }
    if (total() > inner) gap = Math.max(2, r(gap / 2));
    if (total() > inner && (rules ? rules.drop("lockup") !== false : true)) {
      const idx = items.findIndex((i) => i.kind === "lockup");
      if (idx >= 0) { items.splice(idx, 1); drop("lockup", "Lockup dropped: no room in the panel — the logo tile is used instead.", rules?.drop("lockup") === true); }
    }
    const wantsTile = wantsTileNow();
    const stackW = Math.max(1, panelZone.w - (tileReserve ? tileReserve + margin : 0));
    // Shipped OOH puts the message + pill in the upper part of the panel and
    // the lockup at the bottom. A centred stack reproduces that on a short
    // panel, but on a tall one (2160×3840) it left the lockup floating mid-
    // panel — designers: "logo placement is wrong". Anchor the lockup to the
    // bottom whenever the panel has room to spare.
    const lockupItem = items.find((i) => i.kind === "lockup");
    const spare = panelZone.h - total();
    if (lockupItem && spare > total() * 0.6) {
      const rest = items.filter((i) => i !== lockupItem);
      const restH = rest.reduce((s, i) => s + i.h, 0) + gap * Math.max(0, rest.length - 1);
      const lockupY = panelZone.y + panelZone.h - lockupItem.h - r(margin * 1.2);
      // Message + pill centred on the upper third of the room above the lockup.
      let y = r(clamp(panelZone.y + (lockupY - panelZone.y) * 0.42 - restH / 2, panelZone.y + margin, lockupY - restH - gap));
      for (const item of rest) {
        elements.push(...item.build(panelZone.x + r((stackW - item.w) / 2), y));
        y += item.h + gap;
      }
      elements.push(...lockupItem.build(panelZone.x + r((stackW - lockupItem.w) / 2), lockupY));
    } else {
      let y = panelZone.y + r((panelZone.h - total()) / 2);
      for (const item of items) {
        const x = panelZone.x + r((stackW - item.w) / 2);
        elements.push(...item.build(x, y));
        y += item.h + gap;
      }
    }
    // No lockup in the panel: the brand tile goes bottom-right per the guidelines.
    if (wantsTile) {
      const placement = guidelineLogoPlacement(dstW, dstH);
      if (placement) {
        elements.push({ id: "rc_logo", type: "image", slot: "logo", role: "logo", src: opts.brand.logoUrl, fit: "contain", ...placement.tile, locked: true } as FreeformImage);
      }
    }
  }

  if (formatClass === "tower" || formatClass === "strip") needsReview = true;
  if (!hasPhoto) needsReview = true;

  const axisWord = recipe.axis === "stacked" ? "stack" : recipe.axis === "side" ? "columns" : "one row";
  notes.unshift(
    `Recomposed with the ${formatClass} recipe (${axisWord}): photo ${Math.round(recipe.photoFrac * 100)}%${hasBand ? `, band ${Math.round(recipe.bandFrac * 100)}%` : ""}, headline ${headlineSize}px, CTA ${items.find((i) => i.kind === "cta")?.h ?? "—"}px.`,
  );

  return {
    config: {
      kind: "freeform",
      elements,
      ...(options.length > 1 ? { layoutOptions: options } : {}),
      adaptMethod: `recomposed:${formatClass}`,
      adaptNotes: notes,
      ...(dropped.length ? { droppedParts: dropped } : {}),
      needsReview,
    },
    formatClass,
    budget,
    axis: recipe.axis,
    notes,
    needsReview,
  };
}
