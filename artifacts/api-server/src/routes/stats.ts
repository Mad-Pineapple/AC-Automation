import { Router } from "express";
import { db } from "@workspace/db";
import { briefsTable, assetsTable, brandsTable, adEventsTable, adTagsTable } from "@workspace/db";
import { sql, desc, eq, and } from "drizzle-orm";
import { optionalAuth } from "../middlewares/requireAuth";

const router = Router();

router.get("/stats/dashboard", optionalAuth, async (req, res) => {
  const clerkUserId: string = (req as any).clerkUserId;
  const mine = req.query.mine === "true" && !!clerkUserId;
  const baseCondition = mine ? eq(briefsTable.createdBy, clerkUserId) : undefined;

  const [totals] = await db
    .select({
      totalBriefs: sql<number>`cast(count(*) as int)`,
      pendingApproval: sql<number>`cast(sum(case when ${briefsTable.status} = 'pending_approval' then 1 else 0 end) as int)`,
      dispatched: sql<number>`cast(sum(case when ${briefsTable.status} = 'dispatched' then 1 else 0 end) as int)`,
    })
    .from(briefsTable)
    .where(baseCondition);

  const [assetTotal] = mine
    ? await db
        .select({ total: sql<number>`cast(count(*) as int)` })
        .from(assetsTable)
        .innerJoin(briefsTable, and(eq(assetsTable.briefId, briefsTable.id), eq(briefsTable.createdBy, clerkUserId)))
    : await db.select({ total: sql<number>`cast(count(*) as int)` }).from(assetsTable);

  const [brandTotal] = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(brandsTable);

  const briefsByStatus = await db
    .select({
      status: briefsTable.status,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(briefsTable)
    .where(baseCondition)
    .groupBy(briefsTable.status);

  res.json({
    totalBriefs: totals?.totalBriefs ?? 0,
    pendingApproval: totals?.pendingApproval ?? 0,
    dispatched: totals?.dispatched ?? 0,
    totalAssets: assetTotal?.total ?? 0,
    totalBrands: brandTotal?.total ?? 0,
    briefsByStatus: briefsByStatus.map((b) => ({ status: b.status, count: b.count })),
  });
});

router.get("/stats/recent-activity", optionalAuth, async (req, res) => {
  const limit = Number(req.query.limit) || 10;
  const clerkUserId: string = (req as any).clerkUserId;
  const mine = req.query.mine === "true" && !!clerkUserId;
  const baseCondition = mine ? eq(briefsTable.createdBy, clerkUserId) : undefined;

  const recent = await db
    .select({
      id: briefsTable.id,
      status: briefsTable.status,
      campaignName: briefsTable.campaignName,
      brandName: brandsTable.name,
      updatedAt: briefsTable.updatedAt,
    })
    .from(briefsTable)
    .leftJoin(brandsTable, sql`${briefsTable.brandId} = ${brandsTable.id}`)
    .where(baseCondition)
    .orderBy(desc(briefsTable.updatedAt))
    .limit(limit);

  const statusTypeMap: Record<string, string> = {
    dispatched: "dispatched",
    approved: "approved",
    pending_approval: "generated",
    generating: "generating",
    draft: "created",
  };

  const result = recent.map((r, i) => ({
    id: i + 1,
    type: statusTypeMap[r.status] ?? r.status,
    briefId: r.id,
    briefName: r.campaignName,
    brandName: r.brandName ?? "Unknown",
    timestamp: r.updatedAt.toISOString(),
  }));

  res.json(result);
});

router.get("/stats/performance", optionalAuth, async (_req, res) => {
  const [totals] = await db
    .select({
      impressions: sql<number>`cast(sum(case when ${adEventsTable.type} = 'impression' then 1 else 0 end) as int)`,
      clicks: sql<number>`cast(sum(case when ${adEventsTable.type} = 'click' then 1 else 0 end) as int)`,
    })
    .from(adEventsTable);

  const [tagCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(adTagsTable);

  // Per-asset breakdown joined to brief campaign name for readable labels.
  const perAssetRows = await db
    .select({
      assetId: adEventsTable.assetId,
      templateSize: assetsTable.templateSize,
      campaignName: briefsTable.campaignName,
      impressions: sql<number>`cast(sum(case when ${adEventsTable.type} = 'impression' then 1 else 0 end) as int)`,
      clicks: sql<number>`cast(sum(case when ${adEventsTable.type} = 'click' then 1 else 0 end) as int)`,
    })
    .from(adEventsTable)
    .leftJoin(assetsTable, eq(adEventsTable.assetId, assetsTable.id))
    .leftJoin(briefsTable, eq(assetsTable.briefId, briefsTable.id))
    .groupBy(adEventsTable.assetId, assetsTable.templateSize, briefsTable.campaignName)
    .orderBy(desc(sql`sum(case when ${adEventsTable.type} = 'impression' then 1 else 0 end)`))
    .limit(20);

  // Daily time series for the last 14 days.
  const timeseriesRows = await db
    .select({
      day: sql<string>`to_char(${adEventsTable.createdAt}, 'YYYY-MM-DD')`,
      impressions: sql<number>`cast(sum(case when ${adEventsTable.type} = 'impression' then 1 else 0 end) as int)`,
      clicks: sql<number>`cast(sum(case when ${adEventsTable.type} = 'click' then 1 else 0 end) as int)`,
    })
    .from(adEventsTable)
    .where(sql`${adEventsTable.createdAt} >= now() - interval '14 days'`)
    .groupBy(sql`to_char(${adEventsTable.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${adEventsTable.createdAt}, 'YYYY-MM-DD')`);

  const impressions = totals?.impressions ?? 0;
  const clicks = totals?.clicks ?? 0;
  const ctr = impressions > 0 ? clicks / impressions : 0;

  res.json({
    impressions,
    clicks,
    ctr,
    totalTags: tagCount?.count ?? 0,
    topAssets: perAssetRows.map((r) => ({
      assetId: r.assetId,
      templateSize: r.templateSize ?? "unknown",
      campaignName: r.campaignName ?? "Unknown",
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.impressions > 0 ? r.clicks / r.impressions : 0,
    })),
    timeseries: timeseriesRows.map((r) => ({
      day: r.day,
      impressions: r.impressions,
      clicks: r.clicks,
    })),
  });
});

export default router;
