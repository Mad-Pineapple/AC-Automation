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
import { recipeFor, RECIPES, type Recipe } from "./recipes";
import { fitText, prepareMeasurement, type FontSpec, capHeightPx, fontResolution } from "./textMeasure";
import { planCta, masterLabelRatio, pillHeightFromHeadline, type CtaPlan } from "./ctaPlan";
import { placeAnther, circleOf, ANTHER_RULE, type AntherShape } from "./anther";
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
  /** True when recipeOverrides were measured off an APPROVED piece (they
   *  then lead over everything); false/absent when they are the campaign's
   *  general zone numbers, which the online look refines. */
  overridesFromApproved?: boolean;
  /** Format class decided from the brief's name/channel; overrides the
   * dimensions-only classification. */
  formatClass?: FormatClass;
  /** The campaign's part rules (lib/partRulesLayer.ts): floors, drops, pins. */
  rules?: RuleLayer;
  /** Test hook: whether an image is cut to a shape (real transparency). */
  imageIsShaped?: (src: string) => Promise<boolean>;
  /**
   * The campaign's ONLINE call-to-action, when this size runs as a display
   * banner and the master carries the out-of-home one. Online a banner is
   * clicked, so the council sets an action button ("Learn more", 14–16% of
   * the short side in the brand guidelines and in the shipped Get Ready
   * DV360 files); the search pill tells people what to look up when they
   * cannot click (screens, print). Building online sizes from an OOH master
   * carried the search pill, the wrong device at two thirds of the size.
   */
  displayCta?: DisplayCta | null;
}

export interface DisplayCta {
  label: string;
  fill: string;
  labelColor: string;
  /** Button height as a share of the short side, per axis. */
  heightOfShort: { stacked: number; side: number };
  /** The shipped button, so its label share and padding carry. */
  reference: { w: number; h: number; labelPx: number };
  /**
   * The rest of the campaign's online look, measured on its shipped display
   * banners. Each number is set only for a shape that was really measured
   * (300×600 and 970×250 for Get Ready); anything absent keeps the build's
   * own rule.
   */
  look?: {
    /** Photo's share of the long axis (970×250 ships at 69%, not the OOH 50%). */
    photoFrac?: number;
    /** Pattern band thickness as a share of the short side. */
    bandOfShort?: number;
    /** Heading cap height as a share of the short side. */
    headlineCapOfShort?: number;
    /** Logo lockup width as a share of the panel. */
    lockupWidthOfPanel?: number;
    /** false: online banners ship with no dark scrim over the photograph. */
    scrim?: boolean;
  };
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

const shapedCache = new Map<string, boolean>();
/** True when an image has REAL transparency — a photo already cut to a shape
 *  (the council's anther: a circle on a stem), not a rectangle of pixels. */
async function defaultImageIsShaped(src: string): Promise<boolean> {
  if (shapedCache.has(src)) return shapedCache.get(src) ?? false;
  let shaped = false;
  try {
    const objectPath = src.replace(/^\/api\/storage/, "");
    const file = await storage.getObjectEntityFile(objectPath);
    const response = await storage.downloadObject(file);
    const img = sharp(Buffer.from(await response.arrayBuffer()), { failOn: "none" });
    const meta = await img.metadata();
    if (meta.hasAlpha) {
      // A few soft edge pixels do not make a shape (the Flood illustration is
      // a plain rectangle with an alpha channel). A shape leaves a real share
      // of its box empty, corners first.
      const N = 48;
      const { data } = await img.resize(N, N, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let clear = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] < 40) clear++;
      const a = (x: number, y: number) => data[(y * N + x) * 4 + 3];
      const corners = [a(1, 1), a(N - 2, 1), a(1, N - 2), a(N - 2, N - 2)].filter((v) => v < 40).length;
      shaped = clear / (N * N) >= 0.1 && corners >= 2;
    }
  } catch {
    shaped = false;
  }
  shapedCache.set(src, shaped);
  return shaped;
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

/**
 * Where the subject is, read off the master when nobody has marked it.
 *
 * A designer sets the copy over the quiet part of the photograph and leaves
 * the subject clear below it (the flooded car under "STORMS", the cracked
 * road under "QUAKES"). So the subject is the part of the visible photo
 * zone under the copy block. Returned as fractions of the image itself, so
 * a new shape can keep that part of the picture in view — a centre crop
 * of the Storms photo on a 960×256 showed only dark trees.
 */
function inferSubjectFocus(
  sem: ReturnType<typeof inferSlots>,
  photo: FreeformImage,
  natural: { w: number; h: number },
  srcW: number,
  srcH: number,
): { x: number; y: number } | null {
  const pb = sem.photoBox;
  if (!pb || natural.w <= 0 || natural.h <= 0) return null;
  let vx0 = Math.max(0, pb.x), vy0 = Math.max(0, pb.y), vx1 = Math.min(srcW, pb.x + pb.w), vy1 = Math.min(srcH, pb.y + pb.h);
  const panel = sem.panelBox;
  if (panel) {
    // A panel laid over a full-canvas photo hides that part of it.
    if (panel.w >= srcW * 0.9 && panel.y > vy0 && panel.y < vy1) vy1 = panel.y;
    else if (panel.h >= srcH * 0.9 && panel.x > vx0 && panel.x < vx1) vx1 = panel.x;
  }
  const zoneH = vy1 - vy0;
  if (vx1 - vx0 < 8 || zoneH < 8) return null;
  const copy: Box[] = [];
  for (const t of [sem.kicker, sem.headline, sem.subheadline]) if (t && t.y + t.h / 2 >= vy0 && t.y + t.h / 2 <= vy1) copy.push({ x: t.x, y: t.y, w: t.w, h: t.h });
  if (!copy.length) return null;
  const copyBottom = Math.max(...copy.map((t) => t.y + t.h));
  if (vy1 - copyBottom < zoneH * 0.18) return null;
  const mx = (vx0 + vx1) / 2;
  const my = (copyBottom + vy1) / 2;
  const sr = (photo as FreeformImage & { srcRect?: { x: number; y: number; w: number; h: number } }).srcRect;
  let fx: number, fy: number;
  if (sr) {
    fx = sr.x + ((mx - pb.x) / pb.w) * sr.w;
    fy = sr.y + ((my - pb.y) / pb.h) * sr.h;
  } else {
    const k = Math.max(pb.w / natural.w, pb.h / natural.h);
    const dw = natural.w * k, dh = natural.h * k;
    const ox = (pb.w - dw) * (photo.focusX ?? 0.5), oy = (pb.h - dh) * (photo.focusY ?? 0.5);
    fx = (mx - pb.x - ox) / dw;
    fy = (my - pb.y - oy) / dh;
  }
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
  return { x: clamp(fx, 0, 1), y: clamp(fy, 0, 1) };
}

/**
 * Where the master sets its copy block (kicker + heading + sub-line) in the
 * visible photo area, as a share of that area's height. The designer places
 * it per picture — on the Get Ready masters the block centre is 51% down
 * for Storms, 54% for Quakes and 62% for Tsunami — so one constant per shape
 * cannot be right for all three.
 */
function masterCopyCentre(sem: ReturnType<typeof inferSlots>, srcW: number, srcH: number): number | null {
  const pb = sem.photoBox;
  if (!pb || !sem.headline) return null;
  let vy0 = Math.max(0, pb.y), vy1 = Math.min(srcH, pb.y + pb.h);
  const panel = sem.panelBox;
  if (panel && panel.w >= srcW * 0.9 && panel.y > vy0 && panel.y < vy1) vy1 = panel.y;
  if (sem.band && sem.band.w >= srcW * 0.9 && sem.band.y > vy0 && sem.band.y < vy1) vy1 = sem.band.y;
  const zoneH = vy1 - vy0;
  if (zoneH < 8) return null;
  const parts = [sem.kicker, sem.headline, sem.subheadline].filter((t): t is NonNullable<typeof t> => !!t).filter((t) => t.y + t.h / 2 >= vy0 && t.y + t.h / 2 <= vy1);
  if (!parts.some((t) => t === sem.headline)) return null;
  const top = Math.min(...parts.map((t) => t.y)), bottom = Math.max(...parts.map((t) => t.y + t.h));
  const frac = ((top + bottom) / 2 - vy0) / zoneH;
  return Number.isFinite(frac) ? frac : null;
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
  // The online look applies only when the master carries the out-of-home
  // device (a display master already IS the online look and is reproduced).
  const normLabel = (t: string | undefined) => (t ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const displayCta = opts.displayCta && sem.cta && sem.ctaLabel && normLabel(sem.ctaLabel.text) !== normLabel(opts.displayCta.label) ? opts.displayCta : null;
  const look = displayCta?.look ?? null;
  const lookOv: Partial<Recipe> = look && base.axis !== "row"
    ? { ...(look.photoFrac ? { photoFrac: look.photoFrac } : {}), ...(look.bandOfShort ? { bandFrac: (look.bandOfShort * Math.min(dstW, dstH)) / dstH } : {}) }
    : {};
  // An approved piece's measurements lead over the campaign's online look;
  // the campaign's general (out-of-home) zone numbers do not — they are what
  // the online look refines (970×250 ships with the photo at 69%, not 50%).
  const recipe: Recipe = { ...base, ...(opts.overridesFromApproved ? lookOv : {}), ...ov, ...(opts.overridesFromApproved ? {} : lookOv), axis: base.axis === "row" ? "row" : (ov.axis ?? base.axis), keep: base.keep };
  const keep = new Set(recipe.keep);
  const short = Math.min(dstW, dstH);
  const margin = Math.max(4, r(short * recipe.marginFrac));
  const social = isSocialSquare(dstW, dstH);
  const notes: string[] = [...sem.notes];
  let needsReview = sem.notes.length > 0;
  const dropped: DroppedPart[] = [];
  const drop = (slot: string, reason: string, byRule: boolean) => { dropped.push({ slot, reason, byRule }); notes.push(reason); };
  // Parts the class recipe does not carry at all (a tower keeps no
  // sub-line, a strip no message) are dropped by rule, and said so.
  for (const [slot, has] of [["subheadline", !!sem.subheadline], ["message", !!sem.message], ["kicker", !!sem.kicker], ["band", !!sem.band], ["cutout", sem.cutouts.length > 0]] as Array<[string, boolean]>) {
    if (slot === "message" && recipe.axis === "row") continue; // decided where the strip's panel is stacked
    if (has && !(keep as Set<string>).has(slot)) drop(slot, `${slot === "cutout" ? "Cut-out" : slot === "subheadline" ? "Sub-line" : slot === "kicker" ? "Kicker line" : slot === "band" ? "Pattern band" : "Message"} left out: the ${formatClass} recipe does not carry it.`, true);
  }
  const panelFill = sem.panelFill ?? OCEAN;
  const rules = opts.rules;
  const headlineMin = rules?.floor("headline") ?? HEADLINE_MIN_PX;
  const sublineMin = rules?.floor("subheadline") ?? 10;
  const messageMin = rules?.floor("message") ?? 13;
  const lockupMin = rules?.floor("lockup") ?? 16;
  const hasPhoto = !!(sem.photo && sem.photo.src && keep.has("photo"));
  const hasBand = !!(sem.band && sem.band.src && keep.has("band") && recipe.bandAt !== "none" && rules?.pin("band") !== "none");

  // ---- Structure read off the master -----------------------------------------
  // Not every campaign sets its heading over the photograph. The council's
  // standard brand layout sets it on the colour ground, with the photo cut to
  // the anther shape beside or below it. Forcing that copy onto the photo
  // put dark type on a dark picture (rejected for contrast on every size).
  // So: copy that sits on the ground in the master stays on the ground.
  const antherShape: AntherShape | null = hasPhoto ? ((sem.photo as FreeformImage | null)?.shape ?? null) : null;
  const photoShaped = !!antherShape || (hasPhoto && sem.photo?.src ? await (opts.imageIsShaped ?? defaultImageIsShaped)(sem.photo.src as string) : false);
  const sitsOnPhoto = (t: { x: number; y: number; w: number; h: number } | null | undefined): boolean => {
    const pb = sem.photoBox;
    if (!t || !pb) return false;
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    if (cx < pb.x || cx > pb.x + pb.w || cy < pb.y || cy > pb.y + pb.h) return false;
    if (!photoShaped) return true;
    if (antherShape) {
      // Inside the anther's circle is on the picture; the rest of its box is ground.
      const c = circleOf(pb, antherShape);
      return Math.hypot(cx - c.cx, cy - c.cy) <= c.r;
    }
    // A shaped photo only covers the middle of its box.
    const nx = (cx - (pb.x + pb.w / 2)) / (pb.w / 2), ny = (cy - (pb.y + pb.h / 2)) / (pb.h / 2);
    return nx * nx + ny * ny <= 0.49;
  };
  const headlineOffPhoto = hasPhoto && !!sem.headline && !sitsOnPhoto(sem.headline);
  const copyOnGround = recipe.axis !== "row" && headlineOffPhoto;
  // Tall layouts whose master sets the heading ABOVE the photo keep it there
  // (brand guidelines p.16: heading, picture, message, button).
  const headerOnTop = copyOnGround && recipe.axis === "stacked" && !!sem.photoBox && !!sem.headline
    && sem.headline.y + sem.headline.h <= sem.photoBox.y + sem.photoBox.h * 0.15
    && Math.min(sem.headline.x + sem.headline.w, sem.photoBox.x + sem.photoBox.w) - Math.max(sem.headline.x, sem.photoBox.x) > sem.headline.w * 0.5;
  const headerH = headerOnTop ? r(dstH * clamp((sem.photoBox as Box).y / Math.max(1, srcH) + 0.02, 0.12, 0.24)) : 0;
  if (copyOnGround) notes.push(headerOnTop ? "Heading kept on the colour ground above the picture, as the master sets it." : "Heading kept on the colour ground with the copy, as the master sets it — not over the picture.");

  // ---- Zones ---------------------------------------------------------------
  let photoZone: Box;
  let bandZone: Box | null = null;
  let panelZone: Box;
  let tileZone: Box | null = null; // strip: full-height logo tile on the right
  if (recipe.axis === "stacked") {
    // Copy on the ground needs the panel's room: the picture gives some up.
    const ph = antherShape
      // The circle runs to the side margins, up to half the height.
      ? headerH + Math.min(dstW, r(dstH * 0.5))
      : r(dstH * (copyOnGround && !headerOnTop ? Math.min(recipe.photoFrac, 0.42) : recipe.photoFrac));
    const bh = hasBand ? Math.max(4, r(dstH * recipe.bandFrac)) : 0;
    photoZone = { x: 0, y: headerH, w: dstW, h: ph - headerH };
    if (hasBand) bandZone = { x: 0, y: ph, w: dstW, h: bh };
    panelZone = { x: 0, y: ph + bh, w: dstW, h: dstH - ph - bh };
  } else if (recipe.axis === "side") {
    const pw = r(dstW * (copyOnGround ? Math.min(recipe.photoFrac, 0.48) : recipe.photoFrac));
    const bh = hasBand ? clamp(r(dstH * recipe.bandFrac), 4, r(dstH * 0.2)) : 0;
    photoZone = { x: 0, y: 0, w: pw, h: dstH };
    if (hasBand) bandZone = { x: pw, y: 0, w: dstW - pw, h: bh };
    panelZone = { x: pw, y: bh, w: dstW - pw, h: dstH - bh };
  } else {
    const tile = opts.brand.logoUrl && !social ? dstH : 0;
    const pw = !hasPhoto ? 0 : antherShape ? Math.min(r(dstH * 1.25), r(dstW * 0.3)) : clamp(Math.max(r(dstH * 2.4), r(dstW * recipe.photoFrac)), 0, r(dstW * 0.5));
    photoZone = { x: 0, y: 0, w: pw, h: dstH };
    panelZone = { x: pw, y: 0, w: dstW - pw - tile, h: dstH };
    if (tile) tileZone = { x: dstW - tile, y: 0, w: tile, h: tile };
  }

  const elements: FreeformElement[] = [];
  const options: LayoutOption[] = [];
  let antherEl: FreeformImage | null = null;

  // ---- 1. Panel ground -------------------------------------------------------
  elements.push({ id: "rc_panel", type: "rect", slot: "panel", fill: panelFill, x: 0, y: 0, w: dstW, h: dstH, locked: true } as FreeformRect);

  // ---- 2. Photo ----------------------------------------------------------------
  if (hasPhoto && sem.photo) {
    const photo = sem.photo;
    const natural = (await loadSize(photo.src as string)) ?? { w: photo.w, h: photo.h };
    // A focus a person or the vision model marked is trusted. The automatic
    // "attention" pass is not: it reads contrast, and on the Storms photo it
    // picked the bare trees over the flooded car. The designer's own layout
    // (where the copy was NOT put) outranks it.
    const trusted = photo.focusSource === "vision" || photo.focusSource === "designer";
    const inferred = !trusted && recipe.axis !== "row" ? inferSubjectFocus(sem, photo, natural, srcW, srcH) : null;
    const focus = inferred
      ? inferred
      : photo.focusBox
        ? { x: photo.focusBox.x + photo.focusBox.w / 2, y: photo.focusBox.y + photo.focusBox.h / 2 }
        : { x: photo.focusX ?? 0.5, y: photo.focusY ?? 0.45 };
    // Tall zones want the subject a touch below centre (headline sits above
    // it); wide zones want it centred. A subject read off the master sits
    // where the master had it: under the copy (the shipped Storms wide has
    // the car centred 80% down the photo zone).
    const target = inferred ? { x: 0.5, y: 0.82 } : recipe.axis === "stacked" ? { x: 0.5, y: 0.55 } : { x: 0.5, y: 0.5 };
    if (inferred) notes.push("Photo crop keeps the part of the picture the master leaves clear under the copy.");
    const subjectBox = photo.focusSource === "vision" || photo.focusSource === "designer" ? photo.focusBox ?? null : null;
    // A photo cut to a shape is shown whole (a cover crop slices the anther
    // in half); a rectangle of pixels covers its zone as before.
    const antherPlaced = antherShape
      ? placeAnther(photoZone, { w: dstW, h: dstH }, antherShape.aspect ? { w: antherShape.aspect * 1000, h: 1000 } : natural, antherShape, Math.max(margin, r((guidelineLogoPlacement(dstW, dstH)?.tile.w ?? 0) / 2)))
      : null;
    if (antherPlaced) {
      notes.push(`${ANTHER_RULE.title}: shown whole, as large as the margins allow${antherShape?.kind === "anther" ? ", its stem running off the artwork's edge" : ""}.`);
      notes.push(...antherPlaced.notes);
      // Whole, but small in a wide zone: within the rule, worth a designer's eye.
      if (recipe.axis === "stacked" && antherPlaced.circle.r * 2 < photoZone.w * 0.55) {
        notes.push("Check: the anther is whole but leaves open ground beside it at this size — a designer may want to rebalance the layout.");
        needsReview = true;
      }
    }
    const placed = antherPlaced
      ? antherPlaced.box
      : photoShaped
      ? (() => {
          const k = Math.min(photoZone.w / natural.w, photoZone.h / natural.h) * 0.96;
          const w = r(natural.w * k), h = r(natural.h * k);
          return { x: photoZone.x + r((photoZone.w - w) / 2), y: photoZone.y + r((photoZone.h - h) / 2), w, h };
        })()
      : coverPlace(photoZone, natural.w, natural.h, focus, recipe.photoOversize, target, subjectBox);
    if (subjectBox && photo.subject) {
      const fits = subjectBox.w * placed.w <= photoZone.w + 0.5 && subjectBox.h * placed.h <= photoZone.h + 0.5;
      notes.push(fits ? `Photo window keeps ${photo.subject} whole.` : `Check: ${photo.subject} is larger than this photo window; the crop is centred on it.`);
    }
    const photoEl = {
      ...photo,
      id: "rc_photo",
      slot: "photo",
      role: "product",
      fit: photoShaped ? "contain" : "cover",
      ...placed,
      locked: false,
    } as FreeformImage;
    // The anther goes on ABOVE the panel and band grounds (rule 1: nothing is
    // laid over it — a panel rect drawn later hid its stem), under the copy.
    if (antherPlaced) antherEl = photoEl;
    else elements.push(photoEl);
  } else if (sem.photo && !keep.has("photo")) {
    drop("photo", "Photo dropped: this format has no room for it.", false);
  }

  // ---- 3. Scrim over the photo zone ------------------------------------------------
  // Strips keep the scrim: their heading sits on a sliver of the photograph
  // and, with no shipped strip to go by, legibility wins (Quakes 728×90 read
  // at 2.7:1 without it).
  if (copyOnGround || headlineOffPhoto) {
    // No copy on the picture: nothing for a scrim to do.
  } else if (hasPhoto && sem.headline && keep.has("headline") && look?.scrim === false && recipe.axis !== "row") {
    notes.push("Online size: no scrim over the photograph, as on the campaign's shipped display banners.");
  } else if (hasPhoto && sem.headline && keep.has("headline")) {
    const ms = sem.scrim;
    // Same axis: the master's own scrim share carries. Across axes it does
    // not — the studio runs the scrim 70% down a stacked photo and 84% down
    // a side one (measured on the 384×592 and 960×256 masters); carrying
    // the wide's 84% onto a portrait darkened the whole photograph.
    const masterAxis = sem.axis === "stacked" || sem.axis === "side" ? sem.axis : srcW / Math.max(1, srcH) >= 1.12 ? "side" : "stacked";
    const crossAxis = recipe.axis !== "row" && masterAxis !== recipe.axis;
    const classShare = recipe.axis === "side" ? 0.84 : 0.7;
    const frac = crossAxis && ms ? classShare : ms && sem.photoBox ? clamp(ms.h / Math.max(1, sem.photoBox.h), 0.35, 1) : 0.75;
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
  // Swap to the online button only when the master really carries a
  // different device (a search pill): a display master already has it.
  if (displayCta) notes.push(`Online size: the search pill becomes the "${displayCta.label}" button, sized as on the campaign's shipped display banners.`);
  const CTA_MIN_PX = rules?.rules.cta?.minPx ?? (budget === "micro" ? 18 : 24);
  const COMFORT_LABEL_PX = 18;
  const ctaPlanned = (headlinePx?: number): CtaPlan | null => {
    if (!sem.cta || !keep.has("cta")) return null;
    const cta = sem.cta;
    const maxH = recipe.axis === "row" ? dstH * 0.64 : panelZone.h * 0.4;
    // The recipe's pixel floor exists to keep the LABEL readable (it was
    // learned on DV360 buttons, whose label is 42% of the button: 43px →
    // 18px type). A search pill sets its label at 68% of the pill, so the
    // same 18px label needs only a 27px pill — the shipped 384×592 pill is
    // 28.9px, and forcing 43px there cost it the icon and the message.
    if (displayCta && sem.ctaLabel) {
      // The online button: sized from the shipped one, no icon, one line.
      const ref = displayCta.reference;
      const share = recipe.axis === "side" ? displayCta.heightOfShort.side : displayCta.heightOfShort.stacked;
      const dLabelShare = masterLabelRatio({ ctaH: ref.h, ctaW: ref.w, labelFontSize: ref.labelPx });
      const dPill = pillHeightFromHeadline({
        masterPillH: ref.h, masterHeadlinePx: null, headlinePx: null,
        fallbackH: recipe.axis === "row" ? short * recipe.ctaHeightFrac : short * share,
        labelRatio: dLabelShare, minH: CTA_MIN_PX, maxH, recipeFloorPx: recipe.ctaFloorPx, comfortLabelPx: COMFORT_LABEL_PX,
      });
      const dSpec = { ...fontSpec(sem.ctaLabel), weight: 700 as const };
      return planCta({
        label: displayCta.label,
        spec: dSpec,
        master: { ctaH: ref.h, ctaW: ref.w, labelFontSize: ref.labelPx, labelText: displayCta.label, labelSpec: dSpec, hasIcon: false },
        targetH: dPill.h,
        minH: CTA_MIN_PX,
        maxH,
        maxW: panelZone.w * (recipe.axis === "row" ? (hasPhoto && !headlineOffPhoto ? 0.88 : 0.5) : 0.9),
        minLabelPx: budget === "micro" ? Math.min(8, LABEL_FLOOR_PX) : LABEL_FLOOR_PX,
        icon: false,
        allowTwoLines: false,
      });
    }
    const labelShare = sem.ctaLabel ? masterLabelRatio({ ctaH: cta.h, ctaW: cta.w, labelFontSize: sem.ctaLabel.fontSize }) : 0.42;
    // The pill formula (lib/ctaPlan.ts): the pill keeps the master's
    // proportion to the HEADING as built here. Strips are the exception —
    // their heading is set by the strip's height, so the pill takes the
    // recipe's share of that height instead.
    const pill = pillHeightFromHeadline({
      masterPillH: cta.h,
      // An approved piece's own measured pill share leads when there is one.
      masterHeadlinePx: recipe.axis === "row" || ovAll.ctaHeightFrac != null ? null : sem.headline?.fontSize,
      headlinePx: recipe.axis === "row" || ovAll.ctaHeightFrac != null ? null : headlinePx,
      fallbackH: short * recipe.ctaHeightFrac,
      labelRatio: labelShare,
      minH: CTA_MIN_PX,
      maxH,
      recipeFloorPx: recipe.ctaFloorPx,
      comfortLabelPx: COMFORT_LABEL_PX,
    });
    // Same guard for the pill: never under 60% of its master share of the short side.
    const pillGroundFloor = copyOnGround ? Math.min((cta.h / Math.max(1, Math.min(srcW, srcH))) * short * 0.6, (headlinePx ?? short * 0.12) * 0.6) : 0;
    const targetH = Math.min(maxH, Math.max(pill.h, pillGroundFloor));
    if (!sem.ctaLabel) {
      // A pill with no live label keeps the master's proportions.
      const aspect = cta.w / Math.max(1, cta.h) || 4;
      const h = r(clamp(targetH, CTA_MIN_PX, maxH));
      const w = r(Math.min(h * aspect, panelZone.w * recipe.ctaMaxWidthFrac));
      return { h, w, fontSize: 0, padX: r(h * 0.45), iconSize: 0, iconGap: 0, iconInset: 0, lines: [], fits: true, labelRatio: 0.5, padRatio: 0.45, notes: [] };
    }
    return planCta({
      label: sem.ctaLabel.text,
      spec: fontSpec(sem.ctaLabel),
      master: { ctaH: cta.h, ctaW: cta.w, labelFontSize: sem.ctaLabel.fontSize, labelText: sem.ctaLabel.text, labelSpec: fontSpec(sem.ctaLabel), hasIcon: !!sem.ctaIcon, labelInset: sem.ctaLabel.x - cta.x },
      targetH,
      minH: CTA_MIN_PX,
      maxH,
      // A narrow column gives the pill the whole column inside the margins:
      // the small-budget cap (62% + 15%) left a 160px tower 123px for a
      // search pill, which cost it the icon and set the label at 10px.
      maxW: recipe.axis === "row"
        ? panelZone.w * (hasPhoto ? 0.88 : 0.5)
        : formatClass === "tower" || dstW < 200
          ? Math.max(panelZone.w * 0.8, panelZone.w - Math.min(margin * 2, 12))
          : panelZone.w * Math.min(0.92, recipe.ctaMaxWidthFrac + 0.15),
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
  if (antherEl) elements.push(antherEl);
  const copyZone: Box = recipe.axis === "row" ? panelZone : photoZone;
  type GroundItem = { kind: "copy"; w: number; h: number; build: (x: number, y: number) => FreeformElement[] };
  const groundCopy: GroundItem[] = [];
  let groundHeadlinePx: number | null = null;
  if (copyOnGround && sem.headline && keep.has("headline")) {
    const hl = sem.headline;
    const text = hl.text.replace(/\s+/g, " ").trim();
    const zone: Box = headerOnTop ? { x: 0, y: 0, w: dstW, h: headerH } : panelZone;
    const w = r(zone.w - margin * 2);
    const maxH = headerOnTop ? zone.h - margin * 1.2 : zone.h * 0.34;
    const fit = fitText(text, { w: w * 0.96, h: maxH }, { ...fontSpec(hl), minSize: headlineMin, maxSize: Math.max(headlineMin, maxH), lineHeight: 1.02, maxLines: headerOnTop ? 2 : 3 });
    if (!fit.fits) { notes.push("Heading shrank to the floor size and still overflows — shorten the copy."); needsReview = true; }
    groundHeadlinePx = fit.fontSize;
    const cap = fit.lines.length === 1;
    const h = cap ? Math.max(1, r(capHeightPx(fontSpec(hl), fit.fontSize))) : r(fit.height);
    const sub = sem.subheadline && keep.has("subheadline") ? sem.subheadline : null;
    let subFit: ReturnType<typeof fitText> | null = null;
    if (sub) {
      const ratio = ovAll.subheadRatio ?? clamp(sub.fontSize / Math.max(1, hl.fontSize), 0.15, 0.6);
      const subMax = Math.max(sublineMin, r(fit.fontSize * ratio));
      subFit = fitText(sub.text.replace(/\s+/g, " ").trim(), { w: w * 0.96, h: subMax * 2.4 }, { ...fontSpec(sub), minSize: sublineMin, maxSize: subMax, lineHeight: 1.1, maxLines: 2 });
      if (!subFit.fits) { subFit = null; drop("subheadline", "Sub-headline dropped: no legible room under the heading.", rules?.drop("subheadline") === true); }
    }
    const subH = subFit ? r(subFit.height) : 0;
    const gap = subFit ? r(fit.fontSize * 0.14) : 0;
    const buildCopy = (x: number, y: number): FreeformElement[] => {
      const out: FreeformElement[] = [textEl("rc_headline", "headline", "headline", hl, { x, y, w, h }, fit.fontSize, fit.lines.join("\n"), "center", 1.02, cap ? { baselineFit: "cap" } : {})];
      if (subFit && sub) out.push(textEl("rc_subheadline", "subheadline", "subhead", sub, { x, y: y + h + gap, w, h: subH }, subFit.fontSize, subFit.lines.join("\n"), "center", 1.1));
      return out;
    };
    // The picture may overflow its zone upwards (cover crops are oversized);
    // the header wears the ground colour over it.
    if (headerOnTop && !photoShaped) elements.push({ id: "rc_header_ground", type: "rect", slot: "panel", fill: panelFill, x: 0, y: 0, w: dstW, h: headerH, locked: true } as FreeformRect);
    if (headerOnTop) elements.push(...buildCopy(r((dstW - w) / 2), r((headerH - (h + gap + subH)) / 2) + r(margin * 0.3)));
    else groundCopy.push({ kind: "copy", w, h: h + gap + subH, build: buildCopy });
    if (sem.kicker) drop("kicker", "Kicker line left out: the heading sits on the colour ground here.", true);
  } else if (sem.headline && keep.has("headline")) {
    const hl = sem.headline;
    const rawText = hl.text.replace(/\s+/g, " ").trim();
    const words = rawText.split(" ").filter(Boolean);
    const text = recipe.headlineWordPerLine && words.length > 1 ? words.join("\n") : rawText;
    const zoneW = copyZone.w - margin * 2;
    if (recipe.axis === "row") {
      // One row. With a photo, the headline sits ON the photo (centred), as
      // on every other Get Ready size; the panel is left to the message and
      // the pill. Without a photo it shares the panel with the pill.
      // …unless the master keeps its heading off the picture (an anther
      // layout): then it shares the panel with the pill.
      const onPhoto = hasPhoto && photoZone.w > 40 && !headlineOffPhoto;
      const ctaW = onPhoto ? 0 : (ctaPlanned()?.w ?? 0);
      const box: Box = onPhoto
        ? { x: photoZone.x + margin, y: 0, w: Math.max(20, photoZone.w - margin * 2), h: dstH }
        : { x: panelZone.x + margin, y: panelZone.y, w: Math.max(20, panelZone.w - ctaW - margin * 3), h: dstH };
      let fit = fitText(text, { w: box.w, h: dstH * recipe.headlineMaxHeightFrac }, { ...fontSpec(hl), minSize: headlineMin, maxSize: dstH, lineHeight: 1.0, maxLines: 1 });
      if (!fit.fits) fit = fitText(text, { w: box.w, h: dstH * 0.86 }, { ...fontSpec(hl), minSize: headlineMin, maxSize: dstH, lineHeight: 1.0, maxLines: 2 });
      const h = r(fit.height);
      elements.push(textEl("rc_headline", "headline", "headline", hl, { x: box.x, y: r((dstH - h) / 2), w: box.w, h }, fit.fontSize, fit.lines.join("\n"), onPhoto ? "center" : "left", 1.0));
      if (!fit.fits) { notes.push("Headline does not fit the strip at the minimum size — shorten the copy."); needsReview = true; }
      if (sem.kicker) drop("kicker", "Kicker line dropped: strips carry the headline only.", true);
    } else {
      const maxLines = recipe.headlineWordPerLine ? Math.max(1, words.length) : 2;
      // The masters' headline run is measured as a share of the WHOLE zone
      // (88% of 384 on the portrait, 81% of 480 on the wide); taking the
      // share of the inset width set every rebuilt headline a size small.
      // How tall the headline may run follows the SHAPE of the photo zone,
      // read off the studio's two masters: in the 384×337 zone (aspect 1.14)
      // the type is 0.28 of the zone's height; in the 480×256 zone (aspect
      // 1.9) it is 0.43, because a flatter zone has the width to carry it.
      // A per-class constant left a 300×250 (zone 300×145, as flat as the
      // wide) with a headline half the width of its space.
      const zoneAspect = copyZone.w / Math.max(1, copyZone.h);
      const shapeFrac = 0.32 + clamp((zoneAspect - 1.14) / (1.9 - 1.14), 0, 1) * (0.45 - 0.32);
      const maxHFrac = recipe.axis === "stacked" || recipe.axis === "side" ? Math.max(recipe.headlineMaxHeightFrac, shapeFrac) : recipe.headlineMaxHeightFrac;
      // Online look: the heading may run as tall as the shipped banners set
      // it (cap height 38% of the short side on 970×250, where the OOH wide
      // stops at 27%). Width still limits it.
      const capShare = look?.headlineCapOfShort ? capHeightPx(fontSpec(hl), 100) / 100 : 0;
      const lookH = capShare > 0 ? ((look!.headlineCapOfShort as number) * short / capShare) * 1.04 : 0;
      const box = { w: Math.min(zoneW, copyZone.w * recipe.headlineWidthFrac), h: Math.max(copyZone.h * maxHFrac, Math.min(lookH, copyZone.h * 0.7)) };
      const fit = fitText(text, box, { ...fontSpec(hl), minSize: headlineMin, maxSize: copyZone.h, lineHeight: 1.02, maxLines });
      if (!fit.fits) { notes.push("Headline shrank to the floor size and still overflows — shorten the copy."); needsReview = true; }
      // One line: the box is the CAP HEIGHT, as InDesign frames it, so the
      // sub-line sits the master's 0.12em under the letters — a line-height
      // box left a visible hole between headline and sub-line.
      const hlCap = fit.lines.length === 1;
      const hlH = hlCap ? Math.max(1, r(capHeightPx(fontSpec(hl), fit.fontSize))) : r(fit.height);
      // Sub-headline rides directly under the headline at the recipe ratio.
      let subFit: ReturnType<typeof fitText> | null = null;
      const sub = sem.subheadline;
      if (sub && keep.has("subheadline")) {
        const subText = sub.text.replace(/\s+/g, " ").trim();
        // The type scale hangs off the heading as it does in the upload:
        // the master's own sub-line : headline ratio, unless an approved
        // piece measured a different one.
        const subRatio = ovAll.subheadRatio ?? clamp(sub.fontSize / Math.max(1, hl.fontSize), 0.15, 0.6);
        const subMax = Math.max(sublineMin, r(fit.fontSize * subRatio));
        // One line first, as on every master (the sub-line runs 83% of the
        // zone at 0.29 of the headline); it may give up a fifth of its size
        // to stay on one line before it is allowed to break in two.
        const subW = Math.min(zoneW, copyZone.w * 0.9);
        const oneLine = fitText(subText, { w: subW, h: subMax * 1.3 }, { ...fontSpec(sub), minSize: Math.max(sublineMin, r(subMax * 0.8)), maxSize: subMax, lineHeight: 1.1, maxLines: 1 });
        subFit = oneLine.fits ? oneLine : fitText(subText, { w: zoneW * 0.9, h: subMax * 2.4 }, { ...fontSpec(sub), minSize: sublineMin, maxSize: subMax, lineHeight: 1.1, maxLines: 2 });
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
      const subCap = !!subFit && subFit.lines.length === 1;
      const subH = subFit ? (subCap ? Math.max(1, r(capHeightPx(fontSpec(sub as FreeformText), subFit.fontSize))) : r(subFit.height)) : 0;
      const blockH = kickH + kickGap + hlH + gap + subH;
      // With no cut-out on the photo, the headline drops onto the subject
      // (shipped Quakes vs Storms) so the lower photo zone never reads empty.
      const hasCutout = elements.some((e) => e.id === "rc_cutout");
      const classCentre = hasCutout ? recipe.headlineCentreFrac : recipe.headlineCentreFracBare;
      // The heading keeps the place the designer gave it on THIS picture,
      // moved by the difference between the two shapes' usual positions.
      // Measured on the studio's own pairs: every hazard's block sits 6–7
      // points higher in the 960×256 than in the 384×592 (Storms 51→44,
      // Quakes 54→48, Tsunami 62→56), which is the recipes' own difference
      // (0.56 → 0.49). A single constant put every hazard at 56%: Storms'
      // heading sat on the car. An approved piece's measured position still
      // leads when there is one.
      const srcClass = classifyAspect(srcW, srcH);
      const srcRecipe = RECIPES[srcClass];
      const srcCentre = sem.cutouts.length > 0 ? srcRecipe.headlineCentreFrac : srcRecipe.headlineCentreFracBare;
      const masterCentre = hasPhoto && srcRecipe.axis !== "row" ? masterCopyCentre(sem, srcW, srcH) : null;
      const approvedLeads = ovAll.headlineCentreFrac != null || ovAll.headlineCentreFracBare != null;
      const centreFrac = masterCentre != null && !approvedLeads ? clamp(masterCentre + (classCentre - srcCentre), 0.22, 0.78) : classCentre;
      if (masterCentre != null && !approvedLeads && Math.abs(centreFrac - classCentre) >= 0.01) {
        notes.push(`Heading placed as on the master: its copy sits ${Math.round(masterCentre * 100)}% down the photo there, ${Math.round(centreFrac * 100)}% here.`);
      }
      const centreY = copyZone.y + copyZone.h * centreFrac;
      const y0 = r(clamp(centreY - blockH / 2, copyZone.y + margin, copyZone.y + copyZone.h - blockH - margin));
      const hlY = y0 + kickH + kickGap;
      const hlBox: Box = { x: copyZone.x + r((copyZone.w - box.w) / 2), y: hlY, w: r(box.w), h: hlH };
      if (kickFit && kick) {
        const kw = r(zoneW * 0.9);
        elements.push(textEl("rc_kicker", "kicker", "subhead", kick, { x: copyZone.x + r((copyZone.w - kw) / 2), y: y0, w: kw, h: kickH }, kickFit.fontSize, kickFit.lines.join("\n"), "center", 1.1));
      }
      elements.push(textEl("rc_headline", "headline", "headline", hl, hlBox, fit.fontSize, fit.lines.join("\n"), "center", 1.02, hlCap ? { baselineFit: "cap" } : {}));
      if (subFit) {
        const sw = r(subFit.lines.length === 1 ? Math.min(zoneW, copyZone.w * 0.9) : zoneW * 0.9);
        elements.push(textEl("rc_subheadline", "subheadline", "subhead", sub as FreeformText, { x: copyZone.x + r((copyZone.w - sw) / 2), y: hlY + hlH + gap, w: sw, h: subH }, subFit.fontSize, subFit.lines.join("\n"), "center", 1.1, subCap ? { baselineFit: "cap" } : {}));
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
  type Item = { kind: "message" | "cta" | "lockup" | "copy"; w: number; h: number; build: (x: number, y: number) => FreeformElement[] };
  const items: Item[] = [...groundCopy];
  const headlineSize = groundHeadlinePx ?? (elements.find((e) => e.id === "rc_headline") as FreeformText | undefined)?.fontSize ?? r(short * 0.12);

  if (recipe.axis !== "row" && sem.message && keep.has("message")) {
    const msg = sem.message;
    const text = msg.text.replace(/\s+/g, " ").trim();
    const msgRatio = ovAll.messageMaxRatio ?? (sem.headline ? clamp(msg.fontSize / Math.max(1, sem.headline.fontSize), 0.12, 0.5) : recipe.messageMaxRatio);
    // A tower's heading is small (one word across 160px), so a message set
    // from it is tiny. The guidelines' own 160×600 sets the message large,
    // over several lines: a tenth of the width, wrapped.
    // When the heading has had to shrink (set on the ground in a narrow
    // column), copy sized from it shrinks out of sight. It never falls under
    // 60% of the share of the short side it holds in the master.
    const masterMsgShare = msg.fontSize / Math.max(1, Math.min(srcW, srcH));
    // Only where the heading really was squeezed (copy on the ground), and
    // never past half the heading: a share of the short side is not the same
    // thing on a 960×256 as on a 300×600, so it is no rule for other builds.
    const groundFloor = copyOnGround ? Math.min(r(short * masterMsgShare * 0.6), r(headlineSize * 0.5)) : 0;
    const maxSize = Math.max(messageMin, r(headlineSize * msgRatio), groundFloor, formatClass === "tower" ? r(dstW * 0.1) : 0);
    const w = r(panelZone.w * 0.85);
    const msgLines = formatClass === "tower" ? 3 : 2;
    // One line first (every master sets the message on one line): it gives
    // up size before it breaks in two. On the online 970×250 the panel is
    // only 300px wide; a message sized from the big heading wrapped to two
    // lines there and was then dropped for height. Towers wrap by design.
    // Fitted to 94% of its box: the renderer wraps a line that meets its box
    // to the pixel ("Make a plan" with "today." pushed out of a cap-height
    // frame), so a one-line fit always leaves slack.
    const shortMessage = text.length <= 24;
    const oneLine = formatClass === "tower" || !shortMessage ? null : fitText(text, { w: w * 0.94, h: maxSize * 1.4 }, { ...fontSpec(msg), minSize: messageMin, maxSize, lineHeight: 1.15, maxLines: 1 });
    const fit = oneLine?.fits ? oneLine : fitText(text, { w, h: maxSize * (msgLines + 0.5) }, { ...fontSpec(msg), minSize: messageMin, maxSize, lineHeight: 1.15, maxLines: msgLines });
    if (fit.fits) {
      const cap = fit.lines.length === 1;
      const h = cap ? Math.max(1, r(capHeightPx(fontSpec(msg), fit.fontSize))) : r(fit.height);
      items.push({ kind: "message", w, h, build: (x, y) => [textEl("rc_message", "message", "body", msg, { x, y, w, h }, fit.fontSize, fit.lines.join("\n"), "center", 1.15, cap ? { baselineFit: "cap" } : {})] });
    } else {
      drop("message", "Message dropped: it would not fit the panel legibly.", rules?.drop("message") === true);
    }
  }

  const builtHeadline = elements.find((e) => e.id === "rc_headline") as FreeformText | undefined;
  const ctaPlan = ctaPlanned(groundHeadlinePx ?? builtHeadline?.fontSize);
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
      if (displayCta) {
        out.push({ id: "rc_cta", type: "rect", slot: "cta", fill: displayCta.fill, x, y, w: ctaW, h: ctaH, radius: ctaH / 2, locked: true } as FreeformRect);
      } else if (cta.type === "rect") {
        out.push({ id: "rc_cta", type: "rect", slot: "cta", fill: cta.fill, x, y, w: ctaW, h: ctaH, radius: sem.ctaKind === "pill" ? ctaH / 2 : r((cta.radius ?? 0) * (ctaH / Math.max(1, cta.h))), locked: true } as FreeformRect);
      } else {
        out.push({ ...cta, id: "rc_cta", slot: "cta", role: "decoration", fit: "contain", x, y, w: ctaW, h: ctaH, locked: true } as FreeformImage);
      }
      const labelFrom: FreeformText | null = sem.ctaLabel
        ? (displayCta ? ({ ...sem.ctaLabel, color: displayCta.labelColor, fontWeight: 700, letterSpacing: undefined } as FreeformText) : sem.ctaLabel)
        : null;
      if (sem.ctaLabel && labelFrom && ctaPlan.lines.length > 0) {
        const lw = iconSize ? ctaW - padX - iconSize - ctaPlan.iconInset - 2 : ctaW - padX * 2;
        if (ctaPlan.lines.length === 1) {
          // Centre the label's CAP HEIGHT on the pill's centre line — the same
          // cap-fit frame InDesign uses — so the copy sits dead centre in both
          // the export and the editor regardless of font metrics.
          const capH = capHeightPx(fontSpec(labelFrom), ctaPlan.fontSize);
          const lh = Math.max(1, r(capH));
          out.push(
            textEl("rc_cta_label", "ctaLabel", "cta", labelFrom, { x: x + padX, y: y + r((ctaH - lh) / 2), w: lw, h: lh }, ctaPlan.fontSize, ctaPlan.lines[0] ?? "", iconSize ? "left" : "center", 1.1, {
              baselineFit: "cap",
            }),
          );
        } else {
          const lh = r(ctaPlan.fontSize * 1.15 * ctaPlan.lines.length);
          out.push(textEl("rc_cta_label", "ctaLabel", "cta", labelFrom, { x: x + padX, y: y + r((ctaH - lh) / 2), w: lw, h: lh }, ctaPlan.fontSize, ctaPlan.lines.join("\n"), "center", 1.15));
        }
      }
      if (sem.ctaIcon && iconSize && !displayCta) {
        out.push({ ...sem.ctaIcon, id: "rc_cta_icon", slot: "ctaIcon", role: "decoration", fit: "contain", x: x + ctaW - ctaPlan.iconInset - iconSize, y: y + r((ctaH - iconSize) / 2), w: iconSize, h: iconSize, locked: true } as FreeformImage);
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
    // Online look: the lockup is set by its width in the panel (70% on the
    // shipped banners), never taller than 22% of the short side.
    if (look?.lockupWidthOfPanel) { w = r(panelZone.w * look.lockupWidthOfPanel); h = r(w / aspect); if (h > short * 0.22) { h = r(short * 0.22); w = r(h * aspect); } }
    // The class's width cap still holds for every other build; only a lockup
    // sized by the online look may run wider than it.
    const maxW = look?.lockupWidthOfPanel ? Math.max(w, r(panelZone.w * recipe.lockupMaxWidthFrac)) : r(panelZone.w * recipe.lockupMaxWidthFrac);
    if (w > maxW) { w = maxW; h = r(w / aspect); }
    // Never below the lockup floor (illegible marks on towers).
    if (h < lockupMin) { h = lockupMin; w = r(h * aspect); if (w > panelZone.w - margin * 2) { w = panelZone.w - margin * 2; h = r(w / aspect); } }
    items.push({ kind: "lockup", w, h, build: (x, y) => [{ ...lk, id: "rc_lockup", slot: "lockup", role: "decoration", fit: "contain", x, y, w, h, locked: true } as FreeformImage] });
  } else if (sem.lockup && social) {
    drop("lockup", "Logo lockup omitted: social squares carry no logo (guidelines).", true);
  }

  if (recipe.axis === "row") {
    // Strip: the panel carries the message above the pill, centred. When the
    // strip is too short for both, the pill stays and the message goes.
    const cta = items.find((i) => i.kind === "cta");
    let msgItem: { w: number; h: number; build: (x: number, y: number) => FreeformElement[] } | null = null;
    const stripCopyOnPhoto = hasPhoto && !headlineOffPhoto;
    if (sem.message && stripCopyOnPhoto) {
      const msg = sem.message;
      const mText = msg.text.replace(/\s+/g, " ").trim();
      const mw = r(panelZone.w * 0.9);
      const mMax = Math.max(messageMin, r(dstH * 0.2));
      const mFit = fitText(mText, { w: mw, h: mMax * 1.3 }, { ...fontSpec(msg), minSize: Math.min(messageMin, 11), maxSize: mMax, lineHeight: 1.1, maxLines: 1 });
      const mh = r(mFit.height);
      const gapY = Math.max(3, r(dstH * 0.06));
      if (mFit.fits && mh + gapY + (cta?.h ?? 0) <= dstH - Math.max(6, margin)) {
        msgItem = { w: mw, h: mh, build: (x, y) => [textEl("rc_message", "message", "body", msg, { x, y, w: mw, h: mh }, mFit.fontSize, mFit.lines.join("\n"), "center", 1.1)] };
      } else {
        drop("message", "Message left out: this strip is too short to carry it above the pill.", true);
      }
    } else if (sem.message) {
      drop("message", "Message left out: the strip carries the headline and the pill only.", true);
    }
    if (msgItem) {
      const gapY = Math.max(3, r(dstH * 0.06));
      const totalH = msgItem.h + (cta ? gapY + cta.h : 0);
      let y = r((dstH - totalH) / 2);
      elements.push(...msgItem.build(panelZone.x + r((panelZone.w - msgItem.w) / 2), y));
      y += msgItem.h + gapY;
      if (cta) elements.push(...cta.build(panelZone.x + r((panelZone.w - cta.w) / 2), y));
    } else if (cta) {
      elements.push(...cta.build(stripCopyOnPhoto ? panelZone.x + r((panelZone.w - cta.w) / 2) : panelZone.x + panelZone.w - cta.w - margin, r((dstH - cta.h) / 2)));
    }
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
    // Towers: the tile sits bottom-CENTRE at one grid square (half the
    // width — guidelines p.15), under the stack, so nothing is reserved
    // sideways. Reserving a corner left a 160px column ~70px for the pill,
    // which then hung off the canvas.
    const towerTile = formatClass === "tower" && wantsTileNow() ? r(dstW / 2) : 0;
    const tileReserve = towerTile ? 0 : wantsTileNow() ? (guidelineLogoPlacement(dstW, dstH)?.tile.w ?? 0) : 0;
    if (towerTile) panelZone = { ...panelZone, h: Math.max(40, panelZone.h - towerTile) };
    const inner = panelZone.h - r(margin * 1.5);
    // Message → pill gap measured on the masters: 21px under a 29px message
    // (wide), 14px under 26px (portrait) — about 0.6 of the message size now
    // that the message box is its cap height.
    const msgItem0 = items.find((i) => i.kind === "message");
    let gap = clamp(Math.max(r(panelZone.h * 0.07), msgItem0 ? r(msgItem0.h * 0.75) : 0), 4, 48);
    const total = () => items.reduce((s, i) => s + i.h, 0) + gap * Math.max(0, items.length - 1);
    // Tighten the gaps before a part goes: on a 300×250 the message fits
    // with a closer stack, and a designer keeps the line over the air.
    if (total() > inner) gap = Math.max(4, r(gap * 0.55));
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
    // The corner tile only takes room from what sits beside it. An item that
    // ends above the tile is centred on the whole panel — centring a wide
    // message in the narrowed column pushed it off the canvas edge.
    const tileTop = tileReserve ? dstH - (guidelineLogoPlacement(dstW, dstH)?.tile.h ?? 0) : Infinity;
    const xFor = (item: { w: number; h: number }, y: number) => {
      const clearOfTile = y + item.h <= tileTop - 2;
      const room = clearOfTile ? panelZone.w : stackW;
      return panelZone.x + Math.max(2, r((room - item.w) / 2));
    };
    // Shipped OOH puts the message + pill in the upper part of the panel and
    // the lockup at the bottom. A centred stack reproduces that on a short
    // panel, but on a tall one (2160×3840) it left the lockup floating mid-
    // panel — designers: "logo placement is wrong". Anchor the lockup to the
    // bottom whenever the panel has room to spare.
    const lockupItem = items.find((i) => i.kind === "lockup");
    const spare = panelZone.h - total();
    if (lockupItem && spare >= gap) {
      const rest = items.filter((i) => i !== lockupItem);
      const restH = rest.reduce((s, i) => s + i.h, 0) + gap * Math.max(0, rest.length - 1);
      // Bottom margin measured on the masters: 20px under a 47px lockup
      // (wide), 17px (portrait) — 0.4 of the lockup's height.
      const lockupY = panelZone.y + panelZone.h - lockupItem.h - Math.max(r(margin * 0.8), r(lockupItem.h * 0.4));
      // Message + pill sit just below the middle of the room above the
      // lockup: measured 0.62 (wide) and 0.53 (portrait) of that room.
      const groupFrac = recipe.axis === "side" ? 0.6 : 0.54;
      let y = r(clamp(panelZone.y + (lockupY - panelZone.y) * groupFrac - restH / 2, panelZone.y + Math.max(4, r(margin * 0.5)), lockupY - restH - gap));
      for (const item of rest) {
        elements.push(...item.build(xFor(item, y), y));
        y += item.h + gap;
      }
      elements.push(...lockupItem.build(xFor(lockupItem, lockupY), lockupY));
    } else {
      let y = panelZone.y + r((panelZone.h - total()) / 2);
      for (const item of items) {
        const x = xFor(item, y);
        elements.push(...item.build(x, y));
        y += item.h + gap;
      }
    }
    // No lockup in the panel: the brand tile goes bottom-right per the guidelines.
    if (wantsTile && towerTile) {
      elements.push({ id: "rc_logo", type: "image", slot: "logo", role: "logo", src: opts.brand.logoUrl, fit: "contain", x: r((dstW - towerTile) / 2), y: dstH - towerTile, w: towerTile, h: towerTile, locked: true } as FreeformImage);
    } else if (wantsTile) {
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
