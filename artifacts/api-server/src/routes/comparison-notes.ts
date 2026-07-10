import { Router } from "express";
import { db } from "@workspace/db";
import { comparisonNotesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { optionalAuth, requireAuth } from "../middlewares/requireAuth";

const router = Router();

function formatNote(n: typeof comparisonNotesTable.$inferSelect) {
  return {
    id: n.id,
    assetIdLow: n.assetIdLow,
    assetIdHigh: n.assetIdHigh,
    authorId: n.authorId,
    authorName: n.authorName,
    body: n.body,
    createdAt: n.createdAt.toISOString(),
  };
}

// Normalize an unordered asset pair so the same comparison always maps to the
// same (low, high) regardless of which side each asset is shown on.
function normalizePair(a: number, b: number): { low: number; high: number } | null {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a <= 0 || b <= 0 || a === b) {
    return null;
  }
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

router.get("/comparison-notes", optionalAuth, async (req, res): Promise<void> => {
  const pair = normalizePair(Number(req.query.assetA), Number(req.query.assetB));
  if (!pair) {
    res.status(400).json({ error: "assetA and assetB must be two distinct asset ids" });
    return;
  }
  const notes = await db
    .select()
    .from(comparisonNotesTable)
    .where(
      and(
        eq(comparisonNotesTable.assetIdLow, pair.low),
        eq(comparisonNotesTable.assetIdHigh, pair.high),
      ),
    )
    .orderBy(comparisonNotesTable.createdAt);
  res.json(notes.map(formatNote));
});

router.post("/comparison-notes", requireAuth, async (req: any, res): Promise<void> => {
  const body = req.body ?? {};
  const pair = normalizePair(Number(body.assetA), Number(body.assetB));
  if (!pair) {
    res.status(400).json({ error: "assetA and assetB must be two distinct asset ids" });
    return;
  }
  if (typeof body.body !== "string" || !body.body.trim()) {
    res.status(400).json({ error: "body is required" });
    return;
  }
  const text = body.body.trim().slice(0, 1000);
  const [note] = await db
    .insert(comparisonNotesTable)
    .values({
      assetIdLow: pair.low,
      assetIdHigh: pair.high,
      authorId: req.user?.id ?? null,
      authorName: req.user?.name ?? null,
      body: text,
    })
    .returning();
  res.status(201).json(formatNote(note));
});

export default router;
