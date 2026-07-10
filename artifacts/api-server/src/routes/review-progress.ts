import { Router } from "express";
import { db } from "@workspace/db";
import { reviewProgressTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

function parseIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(parsed.filter((n): n is number => Number.isInteger(n) && n > 0)),
    );
  } catch {
    return [];
  }
}

function sanitizeIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((n): n is number => Number.isInteger(n) && n > 0)),
  );
}

// Review progress is per (brief, user): which assets that user has previewed.
router.get("/briefs/:id/review-progress", requireAuth, async (req: any, res): Promise<void> => {
  const briefId = Number(req.params.id);
  if (!Number.isInteger(briefId) || briefId <= 0) {
    res.status(400).json({ error: "Invalid brief id" });
    return;
  }
  const [row] = await db
    .select()
    .from(reviewProgressTable)
    .where(
      and(
        eq(reviewProgressTable.briefId, briefId),
        eq(reviewProgressTable.userId, req.user.id),
      ),
    );
  res.json({
    briefId,
    reviewedAssetIds: parseIds(row?.reviewedAssetIds),
  });
});

router.put("/briefs/:id/review-progress", requireAuth, async (req: any, res): Promise<void> => {
  const briefId = Number(req.params.id);
  if (!Number.isInteger(briefId) || briefId <= 0) {
    res.status(400).json({ error: "Invalid brief id" });
    return;
  }
  const ids = sanitizeIds(req.body?.reviewedAssetIds);
  const encoded = JSON.stringify(ids);
  const now = new Date();
  await db
    .insert(reviewProgressTable)
    .values({
      briefId,
      userId: req.user.id,
      reviewedAssetIds: encoded,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [reviewProgressTable.briefId, reviewProgressTable.userId],
      set: { reviewedAssetIds: encoded, updatedAt: now },
    });
  res.json({ briefId, reviewedAssetIds: ids });
});

export default router;
