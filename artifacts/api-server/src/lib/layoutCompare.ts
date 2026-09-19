/**
 * Check a build against a real file.
 *
 * The one method that has reliably improved accuracy: take a size the studio
 * actually made, build the same size from another master, and measure both
 * the same way. Every number is a SHARE (of the canvas, of a zone, or of the
 * heading), so a 384×592 and a 1080×1920 compare like for like, and each gap
 * is in percentage points a designer can picture ("the pill sits 4 points
 * lower in the panel than in your file").
 *
 * Measuring only — nothing here changes a layout.
 */
import type { FreeformConfig } from "./freeform";
import { normalizeFreeformConfig } from "./freeform";
import { inferSlots } from "./slots";

export interface LayoutMetric {
  key: string;
  /** What is measured, in a designer's words. */
  label: string;
  group: "Zones" | "Heading" | "Panel copy" | "Pill" | "Logo";
  real: number | null;
  built: number | null;
  /** built − real, in percentage points; null when either side lacks the part. */
  gap: number | null;
}

type Shares = Record<string, number | null>;

const LABELS: Array<[string, string, LayoutMetric["group"]]> = [
  ["photoShare", "Photo's share of the canvas", "Zones"],
  ["bandH", "Pattern band height (of canvas height)", "Zones"],
  ["hlFont", "Heading type size (of the short side)", "Heading"],
  ["hlW", "Heading width (of the photo area)", "Heading"],
  ["hlCy", "Heading height in the photo area", "Heading"],
  ["subRatio", "Sub-line size (of the heading)", "Heading"],
  ["subCy", "Sub-line height in the photo area", "Heading"],
  ["msgRatio", "Message size (of the heading)", "Panel copy"],
  ["msgCy", "Message height in the panel", "Panel copy"],
  ["pillOfHeading", "Pill height (of the heading)", "Pill"],
  ["labelRatio", "Pill label size (of the pill)", "Pill"],
  ["pillW", "Pill width (of the panel)", "Pill"],
  ["pillCy", "Pill height in the panel", "Pill"],
  ["lockH", "Logo lockup height (of the short side)", "Logo"],
  ["lockW", "Logo lockup width (of the panel)", "Logo"],
  ["lockCy", "Logo lockup height in the panel", "Logo"],
];

export function measureShares(raw: FreeformConfig, W: number, H: number): Shares {
  const cfg = normalizeFreeformConfig(raw);
  const sem = inferSlots(cfg, W, H);
  const short = Math.min(W, H);
  const stacked = sem.axis === "stacked" ? true : sem.axis === "side" ? false : H > W;
  const zone = cfg.elements.find((e) => e.type === "rect" && e.slot === "panel" && !(e.w >= W * 0.98 && e.h >= H * 0.98));
  const seam = stacked
    ? (sem.band ? sem.band.y : zone ? zone.y : sem.panelBox ? sem.panelBox.y : H)
    : (zone ? zone.x : sem.panelBox ? sem.panelBox.x : sem.band ? sem.band.x : W);
  const photoZone = stacked ? { x: 0, y: 0, w: W, h: Math.max(1, seam) } : { x: 0, y: 0, w: Math.max(1, seam), h: H };
  const panel = stacked ? { x: 0, y: seam, w: W, h: Math.max(1, H - seam) } : { x: seam, y: 0, w: Math.max(1, W - seam), h: H };
  type B = { x: number; y: number; w: number; h: number } | null | undefined;
  const cy = (e: B, z: { y: number; h: number }) => (e ? (e.y + e.h / 2 - z.y) / z.h : null);
  const hl = sem.headline, sub = sem.subheadline, msg = sem.message, cta = sem.cta, label = sem.ctaLabel, lock = sem.lockup, band = sem.band;
  return {
    photoShare: stacked ? seam / H : seam / W,
    bandH: band ? band.h / H : null,
    hlFont: hl ? hl.fontSize / short : null,
    hlW: hl ? hl.w / photoZone.w : null,
    hlCy: cy(hl, photoZone),
    subRatio: hl && sub ? sub.fontSize / hl.fontSize : null,
    subCy: cy(sub, photoZone),
    msgRatio: hl && msg ? msg.fontSize / hl.fontSize : null,
    msgCy: cy(msg, panel),
    pillOfHeading: hl && cta ? cta.h / hl.fontSize : null,
    labelRatio: cta && label ? label.fontSize / cta.h : null,
    pillW: cta ? cta.w / panel.w : null,
    pillCy: cy(cta, panel),
    lockH: lock ? lock.h / short : null,
    lockW: lock ? lock.w / panel.w : null,
    lockCy: cy(lock, panel),
  };
}

export interface LayoutComparison {
  metrics: LayoutMetric[];
  /** Mean absolute gap over the metrics both sides carry, in points. */
  averageGap: number | null;
  /** Largest single gap. */
  worst: LayoutMetric | null;
  /** Parts one side has and the other does not. */
  missingInBuilt: string[];
  extraInBuilt: string[];
  /** One sentence a designer can act on. */
  verdict: string;
}

export function compareLayouts(real: FreeformConfig, built: FreeformConfig, W: number, H: number): LayoutComparison {
  const a = measureShares(real, W, H), b = measureShares(built, W, H);
  const round = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 10);
  const metrics: LayoutMetric[] = LABELS.map(([key, label, group]) => {
    const r = round(a[key]), u = round(b[key]);
    return { key, label, group, real: r, built: u, gap: r == null || u == null ? null : Math.round((u - r) * 10) / 10 };
  }).filter((m) => m.real != null || m.built != null);
  const both = metrics.filter((m) => m.gap != null);
  const averageGap = both.length ? Math.round((both.reduce((s, m) => s + Math.abs(m.gap as number), 0) / both.length) * 10) / 10 : null;
  const worst = both.length ? [...both].sort((x, y) => Math.abs(y.gap as number) - Math.abs(x.gap as number))[0] : null;
  const semA = inferSlots(normalizeFreeformConfig(real), W, H), semB = inferSlots(normalizeFreeformConfig(built), W, H);
  const parts: Array<[string, unknown, unknown]> = [
    ["photo", semA.photo, semB.photo], ["pattern band", semA.band, semB.band], ["heading", semA.headline, semB.headline],
    ["sub-line", semA.subheadline, semB.subheadline], ["message", semA.message, semB.message], ["pill", semA.cta, semB.cta],
    ["pill icon", semA.ctaIcon, semB.ctaIcon], ["logo lockup", semA.lockup, semB.lockup],
  ];
  const missingInBuilt = parts.filter(([, x, y]) => x && !y).map(([n]) => n);
  const extraInBuilt = parts.filter(([, x, y]) => !x && y).map(([n]) => n);
  const verdict =
    averageGap == null ? "Nothing comparable was recognised on one of the two pieces."
    : missingInBuilt.length ? `The build leaves out ${missingInBuilt.join(", ")}, which your file carries.`
    : averageGap <= 2 ? `Very close: the build is within ${averageGap} points of your file on average.`
    : averageGap <= 5 ? `Close, with a few visible differences: ${averageGap} points off on average; the largest is ${worst?.label.toLowerCase()} (${(worst?.gap as number) > 0 ? "+" : ""}${worst?.gap}).`
    : `Noticeably different: ${averageGap} points off on average; the largest is ${worst?.label.toLowerCase()} (${(worst?.gap as number) > 0 ? "+" : ""}${worst?.gap}).`;
  return { metrics, averageGap, worst, missingInBuilt, extraInBuilt, verdict };
}
