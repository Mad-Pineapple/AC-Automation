import { Router } from "express";
import { db } from "@workspace/db";
import { campaignsTable, brandsTable, briefsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth, optionalAuth } from "../middlewares/requireAuth";

const router = Router();

function toIso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function formatCampaign(
  c: typeof campaignsTable.$inferSelect,
  brand: typeof brandsTable.$inferSelect | null,
  briefCount: number,
) {
  return {
    ...c,
    startDate: toIso(c.startDate),
    endDate: toIso(c.endDate),
    brand: brand
      ? {
          ...brand,
          supportedTemplateSizes: JSON.parse(
            (brand as any).supportedTemplateSizes || '["social_square","story","banner","print_a4","animated_social"]',
          ),
          createdAt: brand.createdAt.toISOString(),
          updatedAt: brand.updatedAt.toISOString(),
        }
      : null,
    briefCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function canMutate(campaign: typeof campaignsTable.$inferSelect, req: any): boolean {
  return req.user?.role === "admin" || campaign.createdBy === req.clerkUserId;
}

function parseDate(v: unknown): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

router.get("/campaigns", optionalAuth, async (req, res): Promise<void> => {
  const { mine } = req.query;
  const conditions = mine === "true" && req.clerkUserId ? eq(campaignsTable.createdBy, req.clerkUserId) : undefined;

  const campaigns = await db
    .select()
    .from(campaignsTable)
    .leftJoin(brandsTable, eq(campaignsTable.brandId, brandsTable.id))
    .where(conditions)
    .orderBy(campaignsTable.id);

  const counts = await db
    .select({ campaignId: briefsTable.campaignId, count: sql<number>`cast(count(*) as int)` })
    .from(briefsTable)
    .groupBy(briefsTable.campaignId);
  const countMap = Object.fromEntries(counts.map((c) => [c.campaignId, c.count]));

  res.json(campaigns.map((row) => formatCampaign(row.campaigns, row.brands, countMap[row.campaigns.id] ?? 0)));
});

router.post("/campaigns", requireAuth, async (req, res): Promise<void> => {
  const body = req.body;
  const [campaign] = await db
    .insert(campaignsTable)
    .values({
      name: body.name,
      description: body.description ?? null,
      brandId: body.brandId ?? null,
      startDate: parseDate(body.startDate),
      endDate: parseDate(body.endDate),
      status: body.status ?? "planning",
      createdBy: req.clerkUserId,
    })
    .returning();
  const [brand] = campaign.brandId
    ? await db.select().from(brandsTable).where(eq(brandsTable.id, campaign.brandId))
    : [null];
  res.status(201).json(formatCampaign(campaign, brand ?? null, 0));
});

router.get("/campaigns/:id", optionalAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db
    .select()
    .from(campaignsTable)
    .leftJoin(brandsTable, eq(campaignsTable.brandId, brandsTable.id))
    .where(eq(campaignsTable.id, id));
  if (!row) { res.status(404).json({ error: "Campaign not found" }); return; }
  const [countRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(briefsTable)
    .where(eq(briefsTable.campaignId, id));
  res.json(formatCampaign(row.campaigns, row.brands, countRow?.count ?? 0));
});

router.patch("/campaigns/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Campaign not found" }); return; }
  if (!canMutate(existing, req)) { res.status(403).json({ error: "Forbidden: you do not own this campaign" }); return; }

  const body = req.body;
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.brandId !== undefined) updateData.brandId = body.brandId;
  if (body.startDate !== undefined) updateData.startDate = parseDate(body.startDate);
  if (body.endDate !== undefined) updateData.endDate = parseDate(body.endDate);
  if (body.status !== undefined) updateData.status = body.status;

  const [campaign] = await db.update(campaignsTable).set(updateData).where(eq(campaignsTable.id, id)).returning();
  const [brand] = campaign.brandId
    ? await db.select().from(brandsTable).where(eq(brandsTable.id, campaign.brandId))
    : [null];
  const [countRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(briefsTable)
    .where(eq(briefsTable.campaignId, id));
  res.json(formatCampaign(campaign, brand ?? null, countRow?.count ?? 0));
});

router.delete("/campaigns/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Campaign not found" }); return; }
  if (!canMutate(existing, req)) { res.status(403).json({ error: "Forbidden: you do not own this campaign" }); return; }

  // Detach briefs from this campaign before removing it.
  await db.update(briefsTable).set({ campaignId: null, updatedAt: new Date() }).where(eq(briefsTable.campaignId, id));
  await db.delete(campaignsTable).where(eq(campaignsTable.id, id));
  res.status(204).send();
});

export default router;
