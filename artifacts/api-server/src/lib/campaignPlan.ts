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
import { aspectDistance, ASPECT_REBUILD_THRESHOLD, classifyAspect, classifyFormat, describeFormat, FORMAT_CATALOG, type FormatClass, type FormatHints } from "./formatCatalog";

export interface MasterInput {
  id: number;
  name: string;
  width: number;
  height: number;
  /** Flat artwork (copy baked into the pixels): can only be scaled to
   * near-identical shapes, never rebuilt. Designers rejected re-cropped flat
   * art outright ("just the image, no brand collateral"). */
  flat?: boolean;
  /** Message type the example carries (campaign phase / message line), from
   * `messageTypeOf`. Sizes are matched to examples of their own message. */
  messageType?: string | null;
}

/**
 * The message type a piece carries, read from its name and any copy on it:
 * a campaign phase ("Phase 2"), a countdown, or a known message line. Two
 * pieces with the same message type are interchangeable examples; a size
 * whose brief row names a message is built from an example of that message.
 */
export function messageTypeOf(name: string, copy: string[] = []): string | null {
  const text = [name, ...copy].join(" \n ");
  const phase = /(?<![a-z])phase\s*([1-9])(?![0-9])/i.exec(text);
  if (phase) return `phase ${phase[1]}`;
  if (/\b\d{1,2}:\d{2}:\d{2}\b/.test(text) || /\bcountdown\b/i.test(text)) return "countdown";
  const lines: [RegExp, string][] = [
    [/time to talk/i, "phase 1"],
    [/running out/i, "phase 2"],
    [/strike suddenly|make a plan today/i, "phase 3"],
  ];
  for (const [re, type] of lines) if (re.test(text)) return type;
  const v = /\bV(\d{1,2})\b/.exec(name);
  if (v) return `v${v[1]}`;
  return null;
}

/** Shapes closer than this are "the same" for a flat master. */
export const FLAT_SCALE_TOLERANCE = 0.08;

export interface SizeInput {
  width: number;
  height: number;
  unit?: string;
  names?: string[];
  /** Channel section the size sits under in the brief (DISPLAY, OOH …). */
  channel?: string | null;
  /** Message type the brief row asks for, when it names one. */
  messageType?: string | null;
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
  /** Brief channel section and message type the job was matched on. */
  channel: string | null;
  messageType: string | null;
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
const FORMAT_WORDS = new RegExp(
  `\\b(${[...new Set(FORMAT_CATALOG.map((f) => f.label))].map((l) => l.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")).join("|")}|tower|portrait|square|landscape|wide|strip|skyscraper|banner|billboard|mrec|half page|leaderboard)\\b`,
  "gi",
);

export function variantOf(name: string): string | null {
  const idx = name.lastIndexOf(" — ");
  if (idx < 0) return null;
  // Strip a size token ("STORMS 300x600" → "STORMS") so the same hazard at two
  // sizes forms ONE variant group with two shapes, not two variants.
  // Also strip format labels and class words ("Billboard", "MREC", "strip")
  // so a piece built from a master doesn't read as a variant of its own.
  const tail = name
    .slice(idx + 3)
    .replace(/\b\d{2,4}\s*[x×]\s*\d{2,4}(px)?\b/gi, "")
    .replace(FORMAT_WORDS, "")
    .replace(/\s{2,}/g, " ")
    .trim();
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
  hints: FormatHints & { messageType?: string | null } = {},
): { master: MasterInput; distance: number; sameClass: boolean; sameMessage: boolean } | null {
  const cls = classifyFormat(width, height, hints);
  // Message type first: when the brief row names a message and an example
  // of that message exists, only those examples are candidates.
  const wanted = hints.messageType ?? null;
  const pool = wanted && masters.some((m) => m.messageType === wanted) ? masters.filter((m) => m.messageType === wanted) : masters;
  const scored = pool
    .filter((m) => !m.flat || aspectDistance(width, height, m.width, m.height) <= FLAT_SCALE_TOLERANCE)
    .map((m) => ({
      master: m,
      distance: aspectDistance(width, height, m.width, m.height),
      sameClass: classifyFormat(m.width, m.height, { name: m.name }) === cls,
      sameMessage: !wanted || m.messageType === wanted,
    }));
  // Same shape class wins; within it the closest ratio. Only when no example
  // shares the class does the closest of any shape stand in (and the job is
  // flagged for a rebuild).
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
    const spec = describeFormat(width, height, briefName, size.channel ?? null);
    const hasName = !!(spec.entry || briefName);

    for (const [variantKey, groupMasters] of groups) {
      const pick = chooseMaster(groupMasters, width, height, { name: briefName, channel: size.channel ?? null, messageType: size.messageType ?? null });
      if (!pick) {
        skipped.push({ width: size.width, height: size.height, reason: `${spec.label}: only flat artwork available (copy baked in) — import the InDesign package or working files to build this shape` });
        continue;
      }
      // Recompose only when no example of this shape exists; a same-class
      // example is scaled even when its ratio differs somewhat.
      const recomposed = !pick.sameClass || pick.distance > RECOMPOSE_THRESHOLD;
      const needsReview = !pick.sameClass || !pick.sameMessage;
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
        channel: size.channel ?? null,
        messageType: size.messageType ?? pick.master.messageType ?? null,
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
