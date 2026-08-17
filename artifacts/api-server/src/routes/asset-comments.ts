import { Router } from "express";
import { db } from "@workspace/db";
import { assetCommentsTable, assetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { optionalAuth, requireAuth } from "../middlewares/requireAuth";

const router = Router();

const MAX_BODY = 1000;

function formatComment(c: typeof assetCommentsTable.$inferSelect) {
  return {
    id: c.id,
    assetId: c.assetId,
    authorId: c.authorId,
    authorName: c.authorName,
    body: c.body,
    pinX: c.pinX,
    pinY: c.pinY,
    resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
    resolvedBy: c.resolvedBy,
    createdAt: c.createdAt.toISOString(),
  };
}

/** A pin coordinate must be a 0..1 fraction of the artwork, or absent. */
function normalizePin(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

router.get("/assets/:id/comments", optionalAuth, async (req, res): Promise<void> => {
  const assetId = Number(req.params.id);
  if (!Number.isInteger(assetId) || assetId <= 0) {
    res.status(400).json({ error: "Invalid asset id" });
    return;
  }
  const comments = await db
    .select()
    .from(assetCommentsTable)
    .where(eq(assetCommentsTable.assetId, assetId))
    .orderBy(assetCommentsTable.createdAt);
  res.json(comments.map(formatComment));
});

router.post("/assets/:id/comments", requireAuth, async (req: any, res): Promise<void> => {
  const assetId = Number(req.params.id);
  if (!Number.isInteger(assetId) || assetId <= 0) {
    res.status(400).json({ error: "Invalid asset id" });
    return;
  }
  const body = req.body ?? {};
  if (typeof body.body !== "string" || !body.body.trim()) {
    res.status(400).json({ error: "body is required" });
    return;
  }
  const [asset] = await db.select({ id: assetsTable.id }).from(assetsTable).where(eq(assetsTable.id, assetId));
  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }
  // A pin needs both coordinates; a lone coordinate is treated as unpinned.
  const pinX = normalizePin(body.pinX);
  const pinY = normalizePin(body.pinY);
  const pinned = pinX !== null && pinY !== null;
  const [comment] = await db
    .insert(assetCommentsTable)
    .values({
      assetId,
      authorId: req.user?.id ?? null,
      authorName: req.user?.name ?? null,
      body: body.body.trim().slice(0, MAX_BODY),
      pinX: pinned ? pinX : null,
      pinY: pinned ? pinY : null,
    })
    .returning();
  res.status(201).json(formatComment(comment));
});

router.patch("/asset-comments/:id", requireAuth, async (req: any, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid comment id" });
    return;
  }
  const resolved = req.body?.resolved;
  if (typeof resolved !== "boolean") {
    res.status(400).json({ error: "resolved must be a boolean" });
    return;
  }
  const [comment] = await db
    .update(assetCommentsTable)
    .set(
      resolved
        ? { resolvedAt: new Date(), resolvedBy: req.user?.name ?? null }
        : { resolvedAt: null, resolvedBy: null },
    )
    .where(eq(assetCommentsTable.id, id))
    .returning();
  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  res.json(formatComment(comment));
});

router.delete("/asset-comments/:id", requireAuth, async (req: any, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid comment id" });
    return;
  }
  const [existing] = await db.select().from(assetCommentsTable).where(eq(assetCommentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  // Authors can delete their own comments; admins can delete any.
  const isAuthor = existing.authorId !== null && existing.authorId === req.user?.id;
  if (!isAuthor && req.user?.role !== "admin") {
    res.status(403).json({ error: "Only the author or an admin can delete a comment" });
    return;
  }
  await db.delete(assetCommentsTable).where(eq(assetCommentsTable.id, id));
  res.status(204).end();
});

export default router;
