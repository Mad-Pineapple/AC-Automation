import { Router } from "express";
import { db } from "@workspace/db";
import {
  brandsTable,
  briefsTable,
  brandAssetsTable,
  assetsTable,
  adEventsTable,
  templatesTable,
} from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { generateCampaignIdeas } from "../lib/openai";
import { logger } from "../lib/logger";

const router = Router();

/** Mirrors the frontend's built-in SIZE_CONFIGS (same list as suggest-sizes). */
const BUILTIN_SIZE_OPTIONS = [
  { key: "social_square", label: "Social Square 1080×1080 — Instagram/Facebook feed post" },
  { key: "story", label: "Story 1080×1920 — Instagram/Facebook story, Reels, TikTok" },
  { key: "banner", label: "Banner 728×90 — static leaderboard display ad" },
  { key: "html_banner", label: "HTML5 Banner 970×250 — programmatic display" },
  { key: "print_a4", label: "Print A4 — posters, flyers" },
  { key: "animated_social", label: "Animated Social 1080×1080 — animated social post" },
];

/**
 * Proactive campaign ideation ("what should we run right now?"). Grounded in
 * the brand, the NZ season + AC civic calendar, the imagery the library
 * actually holds, recent campaigns, and live ad-tag performance.
 */
router.post("/campaign-ideas", requireAuth, async (req, res): Promise<void> => {
  const brandId = Number(req.body?.brandId);
  if (!Number.isInteger(brandId) || brandId <= 0) {
    res.status(400).json({ error: "brandId is required" });
    return;
  }
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
  if (!brand) {
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  // Recent campaign names — the generator must not repeat them.
  const briefs = await db
    .select({ campaignName: briefsTable.campaignName })
    .from(briefsTable)
    .where(eq(briefsTable.brandId, brandId))
    .orderBy(desc(briefsTable.id))
    .limit(20);

  // What imagery exists, by folder, with sample names so ideas can lean on it.
  const assets = await db
    .select({ name: brandAssetsTable.name, folder: brandAssetsTable.folder, kind: brandAssetsTable.kind })
    .from(brandAssetsTable)
    .where(eq(brandAssetsTable.brandId, brandId));
  const byFolder = new Map<string, string[]>();
  for (const a of assets) {
    if (a.kind !== "image" || !a.folder || /template|logo|pattern/i.test(a.folder)) continue;
    const list = byFolder.get(a.folder) ?? [];
    list.push(a.name.replace(/\.[a-z0-9]+$/i, ""));
    byFolder.set(a.folder, list);
  }
  const libraryFolders = [...byFolder.entries()].map(([folder, names]) => ({
    folder,
    count: names.length,
    // spread samples across the folder rather than taking the first N twins
    sampleNames: names.filter((_, i) => i % Math.max(1, Math.floor(names.length / 4)) === 0).slice(0, 4),
  }));

  // Live performance per campaign (impressions/clicks via hosted ad tags).
  const perf = await db
    .select({
      campaignName: briefsTable.campaignName,
      impressions: sql<number>`count(*) filter (where ${adEventsTable.type} = 'impression')`,
      clicks: sql<number>`count(*) filter (where ${adEventsTable.type} = 'click')`,
    })
    .from(adEventsTable)
    .innerJoin(assetsTable, eq(adEventsTable.assetId, assetsTable.id))
    .innerJoin(briefsTable, eq(assetsTable.briefId, briefsTable.id))
    .where(eq(briefsTable.brandId, brandId))
    .groupBy(briefsTable.campaignName);
  const performanceSummary = perf
    .filter((p) => Number(p.impressions) > 0)
    .map((p) => {
      const imps = Number(p.impressions);
      const clicks = Number(p.clicks);
      const ctr = imps > 0 ? ((clicks / imps) * 100).toFixed(1) : "0.0";
      return `"${p.campaignName}": ${imps} impressions, ${clicks} clicks (CTR ${ctr}%)`;
    });

  // WIP imports are unfinished artwork — never offered as sizes.
  const custom = (await db.select().from(templatesTable)).filter((t) => t.category !== "wip");
  const sizeOptions = [
    ...BUILTIN_SIZE_OPTIONS,
    ...custom.map((t) => ({ key: `tpl_${t.id}`, label: `${t.name} ${t.width}×${t.height}` })),
  ];

  const now = new Date();
  try {
    const ideas = await generateCampaignIdeas({
      brandName: brand.name,
      guidelines: brand.guidelines,
      month: now.getMonth() + 1,
      monthName: now.toLocaleString("en-NZ", { month: "long" }),
      existingCampaigns: briefs.map((b) => b.campaignName),
      libraryFolders,
      performanceSummary,
      sizeOptions,
    });
    res.json({ ideas });
  } catch (err) {
    logger.error({ err }, "campaign ideas generation failed");
    res.status(502).json({ error: "Could not generate campaign ideas right now." });
  }
});

export default router;
