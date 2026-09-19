/**
 * Recipes: the numbers behind each format class.
 *
 * A recipe is data, not code — the fractions and floors a class of canvas
 * uses when a master is rebuilt for it. The initial values are measured off
 * the shipped AEM Get Ready Burst 2 creative (docs/complex-size-layouts.md
 * and the imported InDesign masters): 384×592 and 960×256 digital OOH,
 * 300×600 and 970×250 DV360. Reference-set import (phase 3) re-measures
 * these from delivered campaigns; nothing else should hard-code them.
 */
import type { FormatClass, PixelBudget } from "./formatCatalog";
import type { Slot } from "./slots";

export type RecipeAxis = "stacked" | "side" | "row";

export interface Recipe {
  axis: RecipeAxis;
  /** Photo zone as a fraction of the canvas along the split axis. */
  photoFrac: number;
  /** Band thickness as a fraction of the canvas height. */
  bandFrac: number;
  bandAt: "seam" | "panelTop" | "none";
  /** Headline fits this fraction of the photo zone's width on one line… */
  headlineWidthFrac: number;
  /** …capped at this fraction of the zone's height. */
  headlineMaxHeightFrac: number;
  /** Where the headline block's centre sits in the photo zone (0..1 of height)
   *  when a cut-out foreground object fills the lower photo zone… */
  headlineCentreFrac: number;
  /** …and when the master has no cut-out. Measured off shipped DV360 pairs:
   *  Storms (car cut-out) 47% / 36%, Quakes (none) 56% / 49% on 300×600 /
   *  970×250 — the designers drop the headline onto the subject so the photo
   *  zone never reads as empty. */
  headlineCentreFracBare: number;
  /** Tower formats set the headline one word per line. */
  headlineWordPerLine: boolean;
  /** Sub-headline size relative to the headline. */
  subheadRatio: number;
  /** Message size cap relative to the headline. */
  messageMaxRatio: number;
  /** CTA height: max(floorPx, short axis × frac), capped by the panel. */
  ctaFloorPx: number;
  ctaHeightFrac: number;
  ctaMaxWidthFrac: number;
  /** Lockup height as a fraction of the short axis, width-capped in the panel. */
  lockupHeightFrac: number;
  lockupMaxWidthFrac: number;
  /** Cut-out width as a fraction of the photo zone width. */
  cutoutWidthFrac: number;
  /** Photo oversize factor over a plain cover crop (subject panning room). */
  photoOversize: number;
  /** Page margin as a fraction of the short axis. */
  marginFrac: number;
  /** Slots this class carries, in priority order (last dropped first). */
  keep: Slot[];
}

const ALL: Slot[] = ["photo", "headline", "cta", "lockup", "band", "message", "subheadline", "cutout"];

export const RECIPES: Record<FormatClass, Recipe> = {
  // 384×592 / 300×600: photo 57% top, band 5.4% at the seam, panel below.
  portrait: {
    axis: "stacked",
    photoFrac: 0.57,
    bandFrac: 0.054,
    bandAt: "seam",
    headlineWidthFrac: 0.88,
    headlineMaxHeightFrac: 0.32,
    headlineCentreFrac: 0.47,
    headlineCentreFracBare: 0.56,
    headlineWordPerLine: false,
    subheadRatio: 0.3,
    messageMaxRatio: 0.3,
    ctaFloorPx: 43,
    ctaHeightFrac: 0.075,
    ctaMaxWidthFrac: 0.7,
    lockupHeightFrac: 0.12,
    lockupMaxWidthFrac: 0.6,
    cutoutWidthFrac: 0.78,
    photoOversize: 1.15,
    marginFrac: 0.06,
    keep: ALL,
  },
  // 120×600 / 160×600: same stack, headline one word per line, no room for
  // the message or a cut-out, logo tile instead of the wide lockup.
  tower: {
    axis: "stacked",
    photoFrac: 0.5,
    bandFrac: 0.03,
    bandAt: "seam",
    headlineWidthFrac: 0.92,
    headlineMaxHeightFrac: 0.7,
    headlineCentreFrac: 0.5,
    headlineCentreFracBare: 0.5,
    headlineWordPerLine: true,
    subheadRatio: 0.32,
    messageMaxRatio: 0.3,
    ctaFloorPx: 28,
    ctaHeightFrac: 0.09,
    ctaMaxWidthFrac: 0.9,
    lockupHeightFrac: 0.14,
    lockupMaxWidthFrac: 0.85,
    cutoutWidthFrac: 0.7,
    photoOversize: 1.2,
    marginFrac: 0.07,
    keep: ["photo", "headline", "cta", "lockup", "band", "subheadline"],
  },
  // 1080×1080 and near-squares: stack, generous photo, social squares carry
  // no logo lockup (guidelines).
  square: {
    axis: "stacked",
    photoFrac: 0.62,
    bandFrac: 0.045,
    bandAt: "seam",
    headlineWidthFrac: 0.84,
    headlineMaxHeightFrac: 0.3,
    headlineCentreFrac: 0.45,
    headlineCentreFracBare: 0.54,
    headlineWordPerLine: false,
    subheadRatio: 0.3,
    messageMaxRatio: 0.3,
    ctaFloorPx: 34,
    ctaHeightFrac: 0.07,
    ctaMaxWidthFrac: 0.6,
    lockupHeightFrac: 0.11,
    lockupMaxWidthFrac: 0.5,
    cutoutWidthFrac: 0.7,
    photoOversize: 1.12,
    marginFrac: 0.06,
    keep: ALL,
  },
  // 1920×1080 / 960×528: columns, photo a little wider than half.
  landscape: {
    axis: "side",
    photoFrac: 0.58,
    bandFrac: 0.12,
    bandAt: "panelTop",
    headlineWidthFrac: 0.82,
    headlineMaxHeightFrac: 0.4,
    headlineCentreFrac: 0.40,
    headlineCentreFracBare: 0.48,
    headlineWordPerLine: false,
    subheadRatio: 0.3,
    messageMaxRatio: 0.28,
    ctaFloorPx: 43,
    ctaHeightFrac: 0.09,
    ctaMaxWidthFrac: 0.6,
    lockupHeightFrac: 0.16,
    lockupMaxWidthFrac: 0.5,
    cutoutWidthFrac: 0.4,
    photoOversize: 1.08,
    marginFrac: 0.05,
    keep: ALL,
  },
  // 960×256 / 970×250: photo left half, band along the top of the panel,
  // message + pill + lockup stacked in the panel.
  wide: {
    axis: "side",
    photoFrac: 0.5,
    bandFrac: 0.155,
    bandAt: "panelTop",
    headlineWidthFrac: 0.8,
    headlineMaxHeightFrac: 0.45,
    headlineCentreFrac: 0.36,
    headlineCentreFracBare: 0.49,
    headlineWordPerLine: false,
    subheadRatio: 0.29,
    messageMaxRatio: 0.27,
    // Shipped 960×256 OOH: pill 32px = 12.5% of the short axis. Designers
    // marked a 44px pill on 768×256 as wrong (feedback 2026-09-06).
    ctaFloorPx: 32,
    ctaHeightFrac: 0.125,
    ctaMaxWidthFrac: 0.6,
    lockupHeightFrac: 0.185,
    lockupMaxWidthFrac: 0.42,
    cutoutWidthFrac: 0.36,
    photoOversize: 1.06,
    marginFrac: 0.05,
    keep: ALL,
  },
  // 728×90 / 320×50: one row — photo, headline, CTA, full-height logo tile.
  strip: {
    axis: "row",
    // Designers, 19 Sep: the hazard word sits ON the photo; the blue panel
    // carries the message and the pill. The photo zone is wide enough for it.
    photoFrac: 0.4,
    bandFrac: 0,
    bandAt: "none",
    headlineWidthFrac: 1,
    headlineMaxHeightFrac: 0.6,
    headlineCentreFrac: 0.5,
    headlineCentreFracBare: 0.5,
    headlineWordPerLine: false,
    subheadRatio: 0.3,
    messageMaxRatio: 0.3,
    ctaFloorPx: 26,
    ctaHeightFrac: 0.36,
    ctaMaxWidthFrac: 0.45,
    lockupHeightFrac: 1,
    lockupMaxWidthFrac: 1,
    cutoutWidthFrac: 0,
    photoOversize: 1.1,
    marginFrac: 0.12,
    keep: ["photo", "headline", "cta", "lockup"],
  },
};

/** The recipe for a class, adjusted for how many pixels the canvas has. */
export function recipeFor(formatClass: FormatClass, budget: PixelBudget): Recipe {
  const base = RECIPES[formatClass];
  if (budget === "micro") {
    return { ...base, keep: base.keep.filter((s) => s === "photo" || s === "headline" || s === "cta" || s === "lockup") };
  }
  if (budget === "small") {
    return {
      ...base,
      // The 43px display floor is for standard canvases; on a short axis
      // under 300px it swallows the panel (designers: "pill size is wrong"
      // on 768×256 and 300×250). Cap the floor and the pill's width.
      ctaFloorPx: Math.min(base.ctaFloorPx, formatClass === "square" ? 28 : 32),
      ctaMaxWidthFrac: Math.min(base.ctaMaxWidthFrac, 0.62),
      // Small squares (MREC) need a taller panel than a social tile does.
      ...(formatClass === "square" ? { photoFrac: 0.55 } : {}),
      keep: base.keep.filter((s) => s !== "cutout" && (formatClass !== "tower" || s !== "subheadline")),
    };
  }
  if (budget === "large") {
    // Viewed from a distance: nothing hides in a corner, floors are moot.
    return { ...base, marginFrac: Math.max(base.marginFrac, 0.05) };
  }
  return base;
}
