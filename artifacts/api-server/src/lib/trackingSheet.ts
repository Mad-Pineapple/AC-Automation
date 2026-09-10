/**
 * Meta (and other upload-to-platform) tracking sheet for a rollout family.
 *
 * Meta does not take tags inside the creative: statics and videos go into
 * Ads Manager and tracking lives on the ad — the URL parameters on the
 * destination link and the Pixel on the website. What the studio CAN hand
 * over is consistency: one file name per piece that carries campaign,
 * variant, format and size into Meta's reporting, and one URL-parameter
 * string per piece that lines up with the UTM scheme the HTML5 banners
 * already append (lib/htmlExport.ts), so Google and Meta traffic land in the
 * same analytics buckets.
 *
 *   utm_source   meta                      (display banners: brand-studio)
 *   utm_medium   paid_social               (display banners: display)
 *   utm_campaign <campaign slug>           (same slug rules as the banners)
 *   utm_content  <piece slug>              campaign_variant_format_WxH
 *   utm_term     <WxH>
 *
 * The sheet also carries Ads Manager's dynamic form ({{ad.name}} etc.) so a
 * traffic team can paste one string per campaign instead of one per ad.
 */
import { describeFormat, type FormatClass } from "./formatCatalog";
import { variantOf } from "./campaignPlan";

export interface SheetTemplate {
  id: number;
  name: string;
  width: number;
  height: number;
  sourceTemplateId?: number | null;
}

export interface TrackingOptions {
  /** Campaign name; defaults to the master's name without its variant suffix. */
  campaign?: string | null;
  /** Landing page. Parameters are appended when given. */
  clickUrl?: string | null;
  /** utm_source value; "meta" by default. */
  source?: string | null;
}

export interface TrackingRow {
  templateId: number;
  fileName: string;
  adName: string;
  width: number;
  height: number;
  ratio: string;
  formatLabel: string;
  formatClass: FormatClass;
  variant: string | null;
  placement: string;
  utmParameters: string;
  destination: string;
  dynamicParameters: string;
}

export function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "piece";
}

/** Strip the " — Variant" suffix and any trailing "WxH" the adapt route adds. */
export function campaignFromName(name: string): string {
  const idx = name.lastIndexOf(" — ");
  const base = idx >= 0 && variantOf(name) ? name.slice(0, idx) : name;
  return base.replace(/\s+\d{2,4}×\d{2,4}\s*$/, "").trim();
}

/** Which Meta placement a canvas fits, by ratio. */
export function metaPlacement(width: number, height: number): string {
  const r = width / height;
  const near = (target: number, tol = 0.04) => Math.abs(r - target) <= tol;
  if (near(1)) return "Feed (1:1)";
  if (near(4 / 5)) return "Feed (4:5)";
  if (near(9 / 16, 0.03)) return "Stories / Reels (9:16)";
  if (near(1.91, 0.06)) return "Feed link / carousel (1.91:1)";
  if (near(16 / 9, 0.05)) return "In-stream video (16:9)";
  if (near(2 / 3, 0.03)) return "Pinterest (2:3)";
  return "Not a Meta placement";
}

function ratioLabel(w: number, h: number): string {
  const g = (a: number, b: number): number => (b === 0 ? a : g(b, a % b));
  const d = g(w, h);
  const rw = w / d, rh = h / d;
  return rw > 50 || rh > 50 ? (w / h).toFixed(2) + ":1" : `${rw}:${rh}`;
}

export function buildTrackingRows(master: SheetTemplate, family: SheetTemplate[], opts: TrackingOptions = {}): TrackingRow[] {
  const campaign = (opts.campaign ?? "").trim() || campaignFromName(master.name);
  const campaignSlug = slug(campaign);
  const source = (opts.source ?? "").trim() || "meta";
  const clickUrl = (opts.clickUrl ?? "").trim();
  const rows: TrackingRow[] = [];
  const seen = new Set<string>();
  for (const t of family) {
    const spec = describeFormat(t.width, t.height);
    let variant = variantOf(t.name) ?? variantOf(master.name);
    // A suffix that just names the format ("— Skyscraper", "— Story") is not
    // a message variant; don't repeat it in the name.
    if (variant && (slug(variant) === slug(spec.label) || slug(spec.label).includes(slug(variant)))) variant = null;
    const pieces = [campaignSlug, variant ? slug(variant) : null, slug(spec.label), `${t.width}x${t.height}`].filter(Boolean) as string[];
    let adName = pieces.join("_");
    let n = 2;
    while (seen.has(adName)) adName = `${pieces.join("_")}_${n++}`;
    seen.add(adName);
    const params = new URLSearchParams({
      utm_source: source,
      utm_medium: "paid_social",
      utm_campaign: campaignSlug,
      utm_content: adName,
      utm_term: `${t.width}x${t.height}`,
    }).toString();
    rows.push({
      templateId: t.id,
      fileName: `${adName}.png`,
      adName,
      width: t.width,
      height: t.height,
      ratio: ratioLabel(t.width, t.height),
      formatLabel: spec.label,
      formatClass: spec.formatClass,
      variant: variant ?? null,
      placement: metaPlacement(t.width, t.height),
      utmParameters: params,
      destination: clickUrl ? `${clickUrl}${clickUrl.includes("?") ? "&" : "?"}${params}` : "",
      dynamicParameters: `utm_source=${encodeURIComponent(source)}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{placement}}`,
    });
  }
  return rows;
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function trackingRowsToCsv(rows: TrackingRow[]): string {
  const header = [
    "Ad name",
    "File name",
    "Size",
    "Ratio",
    "Format",
    "Variant",
    "Meta placement",
    "Destination URL with parameters",
    "URL parameters",
    "Ads Manager dynamic parameters",
    "Template id",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [r.adName, r.fileName, `${r.width}x${r.height}`, r.ratio, r.formatLabel, r.variant ?? "", r.placement, r.destination, r.utmParameters, r.dynamicParameters, r.templateId]
        .map(csvCell)
        .join(","),
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
