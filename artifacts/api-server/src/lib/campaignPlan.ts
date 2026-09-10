/**
 * Campaign build planning: brief sizes × example masters → a work list.
 *
 * A real campaign arrives as a handful of designed examples (often several
 * shapes — a portrait billboard, a wide billboard — each carrying the same
 * set of message variants) plus a collateral brief listing every size to
 * produce. Producing it by hand means deciding, for every size in the brief,
 * WHICH example to build it from — and repeating that for every variant.
 *
 * This module makes that decision the way a designer does:
 *  1. prefer an example of the SAME FORMAT CLASS (a portrait billboard for a
 *     tower, a wide billboard for a leaderboard) — its layout already runs
 *     along the right axis and only needs scaling;
 *  2. otherwise take the closest-shaped example and REBUILD it with the
 *     class recipe (lib/recompose.ts), flagging the job for designer review.
 * Variants (Storms / Quakes / Tsunami …) are honoured as parallel sets:
 * every variant gets every size, always built from an example of its own
 * variant. The brief's own deliverable names travel with each job.
 */
import { aspectDistance, ASPECT_REBUILD_THRESHOLD, classifyAspect, describeFormat, type FormatClass } from "./formatCatalog";

export interface MasterInput {
  id: number;
  name: string;
  width: number;
  height: number;
  /** Flat artwork (copy baked into the pixels): can only be scaled to
   * near-identical shapes, never rebuilt. Designers rejected re-cropped flat
   * art outright ("just the image, no brand collateral"). */
  flat?: boolean;
}

/** Shapes closer than this are "the same" for a flat master. */
export const FLAT_SCALE_TOLERANCE = 0.08;

export interface SizeInput {
  width: number;
  height: number;
  unit?: string;
  names?: string[];
}

export type BuildMethod = "scale" | "recompose";

export interface BuildJob {
  masterId: number;
  masterName: string;
  /** Target size in template px (mm converted at print dpi). */
  width: number;
  height: number;
  name: string;
  variant: string | null;
  /** Source size label, for the review table (e.g. "190×274mm"). */
  sourceLabel: string;
  /** How far the target's shape is from the master's, 0 = identical. */
  aspectDistance: number;
  /** True when the layout is rebuilt for a different shape. */
  recomposed: boolean;
  /** Format class of the target (tower, portrait, square, landscape, wide, strip). */
  formatClass: FormatClass;
  /** Catalog or brief name for the size ("Leaderboard", "Britomart Towers"). */
  formatLabel: string;
  /** "scale" when a same-class example exists, else "recompose". */
  method: BuildMethod;
  /** True when no example shares the target's class: rebuilt from the
   * recipe alone, so a designer should sign it off before dispatch. */
  needsReview: boolean;
}

export interface CampaignBuildPlan {
  jobs: BuildJob[];
  variants: string[];
  /** Sizes that could not be built (no usable master). */
  skipped: { width: number; height: number; reason: string }[];
  warnings: string[];
}

export const PRINT_DPI = 300;

export function mmToPx(mm: number, dpi = PRINT_DPI): number {
  return Math.round((mm / 25.4) * dpi);
}

/** The variant a master carries, by convention "<package> — <Variant>" from
 * multi-spread import. Masters with no suffix belong to a single unnamed set. */
export function variantOf(name: string): string | null {
  const idx = name.lastIndexOf(" — ");
  if (idx < 0) return null;
  // Strip a size token ("STORMS 300x600" → "STORMS") so the same hazard at two
  // sizes forms ONE variant group with two shapes, not two variants.
  const tail = name.slice(idx + 3).replace(/\b\d{2,4}\s*[x×]\s*\d{2,4}(px)?\b/gi, "").replace(/\s{2,}/g, " ").trim();
  // Guard against a dash used for something long-winded rather than a label.
  return tail.length > 0 && tail.length <= 40 ? tail : null;
}

export { aspectDistance };

/** Above this the adapter rebuilds the layout instead of scaling — the same
 * constant the adapt route uses (lib/formatCatalog.ts). */
export const RECOMPOSE_THRESHOLD = ASPECT_REBUILD_THRESHOLD;

/** Pick the example to build a size from: the closest-shaped one in the
 * target's own class when there is one, else the closest overall. */
export function chooseMaster(
  masters: MasterInput[],
  width: number,
  height: number,
): { master: MasterInput; distance: number; sameClass: boolean } | null {
  const cls = classifyAspect(width, height);
  const scored = masters
    .filter((m) => !m.flat || aspectDistance(width, height, m.width, m.height) <= FLAT_SCALE_TOLERANCE)
    .map((m) => ({
    master: m,
    distance: aspectDistance(width, height, m.width, m.height),
    sameClass: classifyAspect(m.width, m.height) === cls,
  }));
  const same = scored.filter((s) => s.sameClass).sort((a, b) => a.distance - b.distance)[0];
  if (same) return same;
  return scored.sort((a, b) => a.distance - b.distance)[0] ?? null;
}

export function planCampaignBuild(
  masters: MasterInput[],
  sizes: SizeInput[],
  opts: { campaignName?: string; dpi?: number } = {},
): CampaignBuildPlan {
  const warnings: string[] = [];
  const skipped: CampaignBuildPlan["skipped"] = [];
  const usable = masters.filter((m) => m.width > 0 && m.height > 0);
  if (usable.length === 0) {
    return { jobs: [], variants: [], skipped: [], warnings: ["No usable example artwork was supplied."] };
  }

  // Group the examples by variant: each group is a complete parallel set.
  const groups = new Map<string, MasterInput[]>();
  const keyed = usable.map((m) => ({ m, key: variantOf(m.name) ?? "" }));
  const namedKeys = [...new Set(keyed.map((k) => k.key).filter((k) => k.length > 0))];
  for (const { m, key } of keyed) {
    // A master whose suffix is only its size ("WORKING-STORMS-970x250px — 970×250")
    // joins the named variant its title mentions, so one hazard at two sizes is
    // one variant with two shapes rather than a variant plus an unnamed set.
    const resolved =
      key.length > 0
        ? key
        : namedKeys.find((v) => new RegExp(`(^|[^a-z0-9])${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(m.name)) ?? "";
    const list = groups.get(resolved) ?? [];
    list.push(m);
    groups.set(resolved, list);
  }
  const variants = [...groups.keys()].filter((v) => v.length > 0).sort();

  const prefix = (opts.campaignName ?? "").trim();
  const jobs: BuildJob[] = [];
  const reviewLabels = new Set<string>();

  for (const size of sizes) {
    const isMm = size.unit === "mm";
    const width = isMm ? mmToPx(size.width, opts.dpi) : Math.round(size.width);
    const height = isMm ? mmToPx(size.height, opts.dpi) : Math.round(size.height);
    const sourceLabel = `${size.width}×${size.height}${isMm ? "mm" : ""}`;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16 || width > 8000 || height > 8000) {
      skipped.push({ width: size.width, height: size.height, reason: "size outside the supported range (16–8000px)" });
      continue;
    }
    const briefName = (size.names ?? []).find((n) => n && n.trim().length > 0) ?? null;
    const spec = describeFormat(width, height, briefName);
    const hasName = !!(spec.entry || briefName);

    for (const [variantKey, groupMasters] of groups) {
      const pick = chooseMaster(groupMasters, width, height);
      if (!pick) {
        skipped.push({ width: size.width, height: size.height, reason: `${spec.label}: only flat artwork available (copy baked in) — import the InDesign package or working files to build this shape` });
        continue;
      }
      const recomposed = !pick.sameClass || pick.distance > RECOMPOSE_THRESHOLD;
      const needsReview = !pick.sameClass;
      if (needsReview) reviewLabels.add(spec.label);
      const variant = variantKey || null;
      const namePieces = [prefix, hasName ? spec.label : null, `${width}×${height}`].filter(Boolean).join(" ");
      jobs.push({
        masterId: pick.master.id,
        masterName: pick.master.name,
        width,
        height,
        name: variant ? `${namePieces} — ${variant}` : namePieces,
        variant,
        sourceLabel,
        aspectDistance: Math.round(pick.distance * 1000) / 1000,
        recomposed,
        formatClass: spec.formatClass,
        formatLabel: spec.label,
        method: recomposed ? "recompose" : "scale",
        needsReview,
      });
    }
  }

  const recomposedCount = jobs.filter((j) => j.recomposed).length;
  if (recomposedCount > 0) {
    warnings.push(
      `${recomposedCount} size(s) differ in shape from their example — their layout is rebuilt with the format's recipe rather than scaled.`,
    );
  }
  if (reviewLabels.size > 0) {
    warnings.push(
      `No example matches the shape of: ${[...reviewLabels].join(", ")}. These are rebuilt from the recipe alone and need designer sign-off before dispatch.`,
    );
  }
  if (variants.length > 1) {
    warnings.push(`${variants.length} message variants detected (${variants.join(", ")}) — every size is produced for each.`);
  }
  if (skipped.length > 0) {
    warnings.push(`${skipped.length} size(s) from the brief could not be produced: ${[...new Set(skipped.map((s) => s.reason))].join(" · ")}`);
  }

  return { jobs, variants, skipped, warnings };
}
