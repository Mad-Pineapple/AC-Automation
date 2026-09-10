/**
 * Meta (Facebook / Instagram) ad results — read-only.
 *
 * Pulls per-ad, per-day insights from the Marketing API into
 * `meta_ad_insights` (created lazily, like feedback) so the Performance page
 * can show what the council's Meta campaigns did with creative from this
 * studio. Ads are matched back to studio templates and briefs by name: the
 * Meta tracking sheet names every exported piece `campaign_variant_format_WxH`
 * (lib/trackingSheet.ts), so an ad named that way lines up with the template it
 * came from; failing that, the campaign slug matches the brief.
 *
 * Nothing here writes to Meta. Configuration is entirely by env:
 *   META_ACCESS_TOKEN    system-user token with `ads_read` on the ad account
 *   META_AD_ACCOUNT_ID   "act_1234567890" (bare id accepted)
 *   META_API_VERSION     Graph API version, default v21.0
 *   META_GRAPH_BASE_URL  override for tests (default https://graph.facebook.com)
 * With the first two unset the feature is dormant: the page shows "not
 * connected" and the cron is a no-op.
 */
import { db, templatesTable, briefsTable } from "@workspace/db";
import { sql, notInArray } from "drizzle-orm";
import { logger } from "./logger";
import { slug, campaignFromName } from "./trackingSheet";

export interface MetaConfig {
  token: string;
  accountId: string;
  version: string;
  baseUrl: string;
}

export function metaConfig(): MetaConfig | null {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  const raw = process.env.META_AD_ACCOUNT_ID?.trim();
  if (!token || !raw) return null;
  return {
    token,
    accountId: raw.startsWith("act_") ? raw : `act_${raw}`,
    version: process.env.META_API_VERSION?.trim() || "v21.0",
    baseUrl: (process.env.META_GRAPH_BASE_URL?.trim() || "https://graph.facebook.com").replace(/\/+$/, ""),
  };
}

export function isMetaConfigured(): boolean {
  return metaConfig() !== null;
}

let ensured: Promise<void> | null = null;
export function ensureMetaTable(): Promise<void> {
  ensured ??= (async () => {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS meta_ad_insights (
      id serial PRIMARY KEY,
      day date NOT NULL,
      ad_id text NOT NULL,
      ad_name text NOT NULL,
      adset_name text,
      campaign_id text,
      campaign_name text,
      impressions integer NOT NULL DEFAULT 0,
      reach integer NOT NULL DEFAULT 0,
      clicks integer NOT NULL DEFAULT 0,
      link_clicks integer NOT NULL DEFAULT 0,
      spend numeric(12,2) NOT NULL DEFAULT 0,
      currency text,
      synced_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (day, ad_id)
    )`);
  })().catch((err) => {
    ensured = null;
    throw err;
  });
  return ensured;
}

/** One row of the Graph API insights response at level=ad, time_increment=1. */
interface InsightRow {
  date_start: string;
  ad_id: string;
  ad_name?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  spend?: string;
  account_currency?: string;
}

const INSIGHT_FIELDS = [
  "date_start",
  "ad_id",
  "ad_name",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "impressions",
  "reach",
  "clicks",
  "inline_link_clicks",
  "spend",
  "account_currency",
].join(",");

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function fetchInsights(cfg: MetaConfig, days: number): Promise<InsightRow[]> {
  const until = new Date();
  const since = new Date(until.getTime() - Math.max(1, days) * 86_400_000);
  const params = new URLSearchParams({
    level: "ad",
    fields: INSIGHT_FIELDS,
    time_increment: "1",
    time_range: JSON.stringify({ since: isoDay(since), until: isoDay(until) }),
    limit: "500",
  });
  let url: string | null = `${cfg.baseUrl}/${cfg.version}/${cfg.accountId}/insights?${params.toString()}`;
  const rows: InsightRow[] = [];
  let pages = 0;
  while (url && pages < 50) {
    // Token goes in the header so it never lands in logs; Meta's `paging.next`
    // links carry their own token so they work unchanged.
    const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" } });
    const body = (await res.json().catch(() => ({}))) as {
      data?: InsightRow[];
      paging?: { next?: string };
      error?: { message?: string; code?: number; type?: string };
    };
    if (!res.ok || body.error) {
      const e = body.error;
      throw new Error(e?.message ? `Graph API: ${e.message} (code ${e.code ?? "?"})` : `Graph API HTTP ${res.status}`);
    }
    rows.push(...(body.data ?? []));
    url = body.paging?.next ?? null;
    pages += 1;
  }
  return rows;
}

const int = (v: string | undefined) => Math.max(0, Math.round(Number(v ?? 0)) || 0);
const money = (v: string | undefined) => Math.max(0, Number(v ?? 0) || 0).toFixed(2);

export interface MetaSyncResult {
  ok: boolean;
  configured: boolean;
  days: number;
  fetched: number;
  upserted: number;
  errors: string[];
}

/** Pull the last `days` days of ad insights and upsert them. Idempotent. */
export async function runMetaSync(days = 30): Promise<MetaSyncResult> {
  const cfg = metaConfig();
  const result: MetaSyncResult = { ok: true, configured: !!cfg, days, fetched: 0, upserted: 0, errors: [] };
  if (!cfg) {
    result.errors.push("META_ACCESS_TOKEN / META_AD_ACCOUNT_ID not set");
    return result;
  }
  await ensureMetaTable();
  let rows: InsightRow[];
  try {
    rows = await fetchInsights(cfg, days);
  } catch (err) {
    result.ok = false;
    result.errors.push(err instanceof Error ? err.message : String(err));
    logger.warn({ err }, "Meta insights fetch failed");
    return result;
  }
  result.fetched = rows.length;
  for (const r of rows) {
    if (!r.ad_id || !r.date_start) continue;
    try {
      await db.execute(sql`INSERT INTO meta_ad_insights
        (day, ad_id, ad_name, adset_name, campaign_id, campaign_name, impressions, reach, clicks, link_clicks, spend, currency, synced_at)
        VALUES (${r.date_start}, ${r.ad_id}, ${r.ad_name ?? ""}, ${r.adset_name ?? null}, ${r.campaign_id ?? null}, ${r.campaign_name ?? null},
                ${int(r.impressions)}, ${int(r.reach)}, ${int(r.clicks)}, ${int(r.inline_link_clicks)}, ${money(r.spend)}, ${r.account_currency ?? null}, now())
        ON CONFLICT (day, ad_id) DO UPDATE SET
          ad_name = EXCLUDED.ad_name, adset_name = EXCLUDED.adset_name, campaign_id = EXCLUDED.campaign_id,
          campaign_name = EXCLUDED.campaign_name, impressions = EXCLUDED.impressions, reach = EXCLUDED.reach,
          clicks = EXCLUDED.clicks, link_clicks = EXCLUDED.link_clicks, spend = EXCLUDED.spend,
          currency = EXCLUDED.currency, synced_at = now()`);
      result.upserted += 1;
    } catch (err) {
      result.errors.push(`${r.date_start} ${r.ad_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  logger.info({ fetched: result.fetched, upserted: result.upserted, errors: result.errors.length }, "Meta insights sync finished");
  return result;
}

// ---------------------------------------------------------------------------
// Read side

export interface MetaAdRow {
  adId: string;
  adName: string;
  campaignName: string | null;
  adsetName: string | null;
  impressions: number;
  reach: number;
  linkClicks: number;
  spend: number;
  ctr: number;
  cpm: number;
  templateId: number | null;
  templateName: string | null;
  briefId: number | null;
  briefCampaignName: string | null;
}

export interface MetaSummary {
  configured: boolean;
  lastSyncedAt: string | null;
  days: number;
  currency: string | null;
  totals: {
    impressions: number;
    reach: number;
    clicks: number;
    linkClicks: number;
    spend: number;
    ctr: number;
    cpm: number;
    cpc: number;
  };
  timeseries: Array<{ day: string; impressions: number; linkClicks: number; spend: number }>;
  ads: MetaAdRow[];
}

interface TemplateRef { id: number; name: string; width: number; height: number }
interface BriefRef { id: number; campaignName: string }

/**
 * Match a Meta ad to the studio piece it was exported from. Exact tracking-sheet
 * name first; then campaign slug + canvas size against a template; then the
 * campaign slug against a brief. Longest campaign slug wins so "get-ready-phase-2"
 * beats "get-ready".
 */
export function matchAd(
  adName: string,
  metaCampaign: string | null,
  templates: TemplateRef[],
  briefs: BriefRef[],
): { template: TemplateRef | null; brief: BriefRef | null } {
  const a = slug(adName);
  const dims = adName.match(/(\d{2,4})x(\d{2,4})/i);
  let template: TemplateRef | null = null;
  let bestLen = 0;
  for (const t of templates) {
    if (slug(t.name) === a) return { template: t, brief: null };
    if (dims && t.width === Number(dims[1]) && t.height === Number(dims[2])) {
      const c = slug(campaignFromName(t.name));
      if (c && c !== "piece" && a.startsWith(c) && c.length > bestLen) {
        template = t;
        bestLen = c.length;
      }
    }
  }
  let brief: BriefRef | null = null;
  bestLen = 0;
  const mc = metaCampaign ? slug(metaCampaign) : "";
  for (const b of briefs) {
    const bs = slug(b.campaignName);
    if (!bs || bs === "piece") continue;
    if ((a.startsWith(bs) || (mc && (mc === bs || mc.startsWith(bs)))) && bs.length > bestLen) {
      brief = b;
      bestLen = bs.length;
    }
  }
  return { template, brief };
}

export async function getMetaSummary(days = 30): Promise<MetaSummary> {
  const configured = isMetaConfigured();
  const window = Math.min(365, Math.max(1, Math.round(days) || 30));
  const empty: MetaSummary = {
    configured,
    lastSyncedAt: null,
    days: window,
    currency: null,
    totals: { impressions: 0, reach: 0, clicks: 0, linkClicks: 0, spend: 0, ctr: 0, cpm: 0, cpc: 0 },
    timeseries: [],
    ads: [],
  };
  if (!configured) return empty;
  await ensureMetaTable();

  const totalsRes = await db.execute(sql`SELECT
      coalesce(sum(impressions),0)::int AS impressions,
      coalesce(sum(reach),0)::int AS reach,
      coalesce(sum(clicks),0)::int AS clicks,
      coalesce(sum(link_clicks),0)::int AS link_clicks,
      coalesce(sum(spend),0)::float AS spend,
      max(synced_at) AS last_synced_at,
      (array_agg(currency) FILTER (WHERE currency IS NOT NULL))[1] AS currency
    FROM meta_ad_insights WHERE day >= current_date - ${window}::int`);
  const t = (totalsRes.rows?.[0] ?? {}) as Record<string, unknown>;
  const impressions = Number(t.impressions ?? 0);
  const linkClicks = Number(t.link_clicks ?? 0);
  const spend = Number(t.spend ?? 0);

  const seriesRes = await db.execute(sql`SELECT to_char(day,'YYYY-MM-DD') AS day,
      sum(impressions)::int AS impressions, sum(link_clicks)::int AS link_clicks, sum(spend)::float AS spend
    FROM meta_ad_insights WHERE day >= current_date - ${window}::int
    GROUP BY day ORDER BY day`);

  const adsRes = await db.execute(sql`SELECT ad_id,
      (array_agg(ad_name ORDER BY day DESC))[1] AS ad_name,
      (array_agg(campaign_name ORDER BY day DESC))[1] AS campaign_name,
      (array_agg(adset_name ORDER BY day DESC))[1] AS adset_name,
      sum(impressions)::int AS impressions, max(reach)::int AS reach,
      sum(link_clicks)::int AS link_clicks, sum(spend)::float AS spend
    FROM meta_ad_insights WHERE day >= current_date - ${window}::int
    GROUP BY ad_id ORDER BY sum(impressions) DESC LIMIT 100`);

  const templates = (await db
    .select({ id: templatesTable.id, name: templatesTable.name, width: templatesTable.width, height: templatesTable.height })
    .from(templatesTable)
    .where(notInArray(templatesTable.category, ["knowledge", "wip"]))) as TemplateRef[];
  const briefs = (await db
    .select({ id: briefsTable.id, campaignName: briefsTable.campaignName })
    .from(briefsTable)) as BriefRef[];

  const ads: MetaAdRow[] = (adsRes.rows as Array<Record<string, unknown>>).map((r) => {
    const adName = String(r.ad_name ?? "");
    const campaignName = r.campaign_name == null ? null : String(r.campaign_name);
    const imp = Number(r.impressions ?? 0);
    const lc = Number(r.link_clicks ?? 0);
    const sp = Number(r.spend ?? 0);
    const m = matchAd(adName, campaignName, templates, briefs);
    return {
      adId: String(r.ad_id),
      adName,
      campaignName,
      adsetName: r.adset_name == null ? null : String(r.adset_name),
      impressions: imp,
      reach: Number(r.reach ?? 0),
      linkClicks: lc,
      spend: sp,
      ctr: imp > 0 ? lc / imp : 0,
      cpm: imp > 0 ? (sp / imp) * 1000 : 0,
      templateId: m.template?.id ?? null,
      templateName: m.template?.name ?? null,
      briefId: m.brief?.id ?? null,
      briefCampaignName: m.brief?.campaignName ?? null,
    };
  });

  return {
    configured,
    lastSyncedAt: t.last_synced_at ? new Date(t.last_synced_at as string).toISOString() : null,
    days: window,
    currency: t.currency == null ? null : String(t.currency),
    totals: {
      impressions,
      reach: Number(t.reach ?? 0),
      clicks: Number(t.clicks ?? 0),
      linkClicks,
      spend,
      ctr: impressions > 0 ? linkClicks / impressions : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      cpc: linkClicks > 0 ? spend / linkClicks : 0,
    },
    timeseries: (seriesRes.rows as Array<Record<string, unknown>>).map((r) => ({
      day: String(r.day),
      impressions: Number(r.impressions ?? 0),
      linkClicks: Number(r.link_clicks ?? 0),
      spend: Number(r.spend ?? 0),
    })),
    ads,
  };
}
