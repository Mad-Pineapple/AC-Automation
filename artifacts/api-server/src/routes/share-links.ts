import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { shareLinksTable, briefsTable, assetsTable, brandsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

const DEFAULT_EXPIRY_DAYS = 30;
const MAX_EXPIRY_DAYS = 365;

function formatShareLink(l: typeof shareLinksTable.$inferSelect) {
  const now = Date.now();
  const status = l.revokedAt
    ? "revoked"
    : l.expiresAt && l.expiresAt.getTime() < now
      ? "expired"
      : "active";
  return {
    id: l.id,
    token: l.token,
    briefId: l.briefId,
    createdBy: l.createdBy,
    createdAt: l.createdAt.toISOString(),
    expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null,
    status,
  };
}

router.post("/briefs/:id/share-links", requireAuth, async (req: any, res): Promise<void> => {
  const briefId = Number(req.params.id);
  if (!Number.isInteger(briefId) || briefId <= 0) {
    res.status(400).json({ error: "Invalid brief id" });
    return;
  }
  const [brief] = await db.select({ id: briefsTable.id }).from(briefsTable).where(eq(briefsTable.id, briefId));
  if (!brief) {
    res.status(404).json({ error: "Brief not found" });
    return;
  }
  const rawDays = req.body?.expiresInDays;
  const days =
    rawDays === undefined || rawDays === null
      ? DEFAULT_EXPIRY_DAYS
      : Math.min(MAX_EXPIRY_DAYS, Math.max(1, Math.round(Number(rawDays)) || DEFAULT_EXPIRY_DAYS));
  const [link] = await db
    .insert(shareLinksTable)
    .values({
      token: randomUUID(),
      briefId,
      createdBy: req.user?.name ?? null,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    })
    .returning();
  res.status(201).json(formatShareLink(link));
});

router.get("/briefs/:id/share-links", requireAuth, async (req, res): Promise<void> => {
  const briefId = Number(req.params.id);
  if (!Number.isInteger(briefId) || briefId <= 0) {
    res.status(400).json({ error: "Invalid brief id" });
    return;
  }
  const links = await db
    .select()
    .from(shareLinksTable)
    .where(eq(shareLinksTable.briefId, briefId))
    .orderBy(shareLinksTable.createdAt);
  res.json(links.map(formatShareLink));
});

router.delete("/share-links/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid share link id" });
    return;
  }
  const [link] = await db
    .update(shareLinksTable)
    .set({ revokedAt: new Date() })
    .where(eq(shareLinksTable.id, id))
    .returning();
  if (!link) {
    res.status(404).json({ error: "Share link not found" });
    return;
  }
  res.status(204).end();
});

/**
 * Asset image URLs were historically persisted absolute against whatever
 * host generated them (e.g. http://localhost:8080/api/storage/...). The
 * share page can be served from any origin, so strip the origin off our own
 * storage URLs and let the browser resolve them against the current host.
 */
function relativizeStorageUrl(url: string | null): string | null {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/api/storage/") || parsed.pathname.startsWith("/objects/")) {
      return parsed.pathname + parsed.search;
    }
    return url;
  } catch {
    return url; // already relative (or not a URL) — leave untouched
  }
}

/**
 * Public, token-authorized view of a brief's generated assets. No login:
 * possession of the token is the authorization (like /track), with expiry
 * and revocation checked on every request.
 */
router.get("/share/:token", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const token = String(req.params.token ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    res.status(404).json({ error: "Share link not found" });
    return;
  }
  const [link] = await db.select().from(shareLinksTable).where(eq(shareLinksTable.token, token));
  if (!link || link.revokedAt) {
    res.status(404).json({ error: "Share link not found" });
    return;
  }
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    res.status(410).json({ error: "This share link has expired" });
    return;
  }
  const [brief] = await db.select().from(briefsTable).where(eq(briefsTable.id, link.briefId));
  if (!brief) {
    res.status(404).json({ error: "Share link not found" });
    return;
  }
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brief.brandId));
  const assets = await db.select().from(assetsTable).where(eq(assetsTable.briefId, brief.id));
  res.json({
    campaignName: brief.campaignName,
    brandName: brand?.name ?? null,
    brandLogoUrl: relativizeStorageUrl(brand?.logoUrl ?? null),
    expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
    assets: assets
      .filter((a) => a.status !== "generating")
      .map((a) => ({
        id: a.id,
        templateSize: a.templateSize,
        variantLabel: a.variantLabel,
        headline: a.headline,
        imageUrl: relativizeStorageUrl(a.imageUrl),
        isAnimated: a.isAnimated,
        status: a.status,
        complianceScore: a.complianceScore,
      })),
  });
});

export default router;
