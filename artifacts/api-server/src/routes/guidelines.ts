/**
 * Element-aware guideline index.
 *
 *   POST /guidelines/index                 { brandId }  rebuild the passage index (admin)
 *   GET  /guidelines/status?brandId=       counts by source and topic
 *   GET  /guidelines/for-template/:id      the passages a piece's elements call for
 */
import { Router } from "express";
import { db, brandsTable, templatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin, optionalAuth } from "../middlewares/requireAuth";
import { indexGuidelines, guidelineStatus, guidelinesForConfig } from "../lib/guidelines";
import { isFreeformConfig, normalizeFreeformConfig } from "../lib/freeform";

const router = Router();

async function brandIdFrom(raw: unknown): Promise<number | null> {
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  const [b] = await db.select({ id: brandsTable.id }).from(brandsTable).orderBy(brandsTable.id).limit(1);
  return b?.id ?? null;
}

router.post("/guidelines/index", requireAdmin, async (req, res): Promise<void> => {
  const brandId = await brandIdFrom(req.body?.brandId);
  if (!brandId) { res.status(400).json({ error: "No brand to index" }); return; }
  try {
    const result = await indexGuidelines(brandId);
    res.json({ brandId, ...result });
  } catch (err) {
    (req as any).log?.warn?.({ err }, "guideline index failed");
    res.status(500).json({ error: err instanceof Error ? err.message.slice(0, 200) : "Index failed" });
  }
});

// Counts only — nothing sensitive, and useful for a health check.
router.get("/guidelines/status", optionalAuth, async (req, res): Promise<void> => {
  const brandId = await brandIdFrom(req.query.brandId);
  if (!brandId) { res.json({ brandId: null, total: 0, bySource: [], byTopic: [] }); return; }
  res.json({ brandId, ...(await guidelineStatus(brandId)) });
});

router.get("/guidelines/for-template/:id", requireAuth, async (req, res): Promise<void> => {
  const [t] = await db.select().from(templatesTable).where(eq(templatesTable.id, Number(req.params.id)));
  if (!t) { res.status(404).json({ error: "Template not found" }); return; }
  let parsed: unknown;
  try { parsed = JSON.parse(t.config || "{}"); } catch { parsed = {}; }
  if (!isFreeformConfig(parsed)) { res.json({ items: [] }); return; }
  const brandId = await brandIdFrom(req.query.brandId);
  const items = await guidelinesForConfig(brandId, normalizeFreeformConfig(parsed), t.width, t.height);
  res.json({ items });
});

export default router;
