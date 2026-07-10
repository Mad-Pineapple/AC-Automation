import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { assetsTable, briefsTable, brandsTable, adTagsTable, adEventsTable, brandStylesTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { generateCopy, generateProductImage, generateHtmlBanner } from "../lib/openai";
import { requireAuth, optionalAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { runInBackground } from "../lib/background";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  loadTemplateMap,
  dimsForSize,
  imageSizeForDims,
  collectBrandReferences,
  pickLibraryImage,
} from "../lib/assetImages";
import { checkAssetCompliance, checkHtmlCompliance, isHtmlAsset, serializeIssues, type ComplianceVerdict } from "../lib/brandCompliance";

const router = Router();
const objectStorageService = new ObjectStorageService();

/** Shape a brand row into the input the compliance checkers expect. */
function brandComplianceInput(brand: typeof brandsTable.$inferSelect) {
  return {
    name: brand.name,
    primaryColor: brand.primaryColor,
    secondaryColor: brand.secondaryColor,
    accentColor: brand.accentColor,
    backgroundColor: brand.backgroundColor,
    textColor: brand.textColor,
    fontFamily: brand.fontFamily,
    guidelines: brand.guidelines,
    toneOfVoice: brand.toneOfVoice,
    industry: brand.industry,
  };
}

function baseUrl(req: any): string {
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0];
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

function buildSnippet(
  serveUrl: string,
  pixelUrl: string,
  dims: { width: number; height: number },
): string {
  return [
    `<!-- Brand Creative Studio ad tag (${dims.width}x${dims.height}) -->`,
    `<iframe src="${serveUrl}" width="${dims.width}" height="${dims.height}" frameborder="0" scrolling="no" sandbox="allow-scripts allow-top-navigation-by-user-activation" style="border:0;overflow:hidden" allowtransparency="true"></iframe>`,
    `<noscript><img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" /></noscript>`,
  ].join("\n");
}

async function formatAdTag(tag: typeof adTagsTable.$inferSelect, req: any) {
  const base = baseUrl(req);
  const serveUrl = `${base}/track/serve/${tag.token}`;
  const pixelUrl = `${base}/track/pixel/${tag.token}.gif`;
  // Size the embed to the actual creative so the iframe matches the ad slot.
  const [tagAsset] = await db
    .select({ templateSize: assetsTable.templateSize })
    .from(assetsTable)
    .where(eq(assetsTable.id, tag.assetId));
  const dims = tagAsset
    ? dimsForSize(tagAsset.templateSize, await loadTemplateMap())
    : { width: 300, height: 250 };
  const [counts] = await db
    .select({
      impressions: sql<number>`cast(count(*) filter (where ${adEventsTable.type} = 'impression') as int)`,
      clicks: sql<number>`cast(count(*) filter (where ${adEventsTable.type} = 'click') as int)`,
    })
    .from(adEventsTable)
    .where(eq(adEventsTable.adTagId, tag.id));
  return {
    ...tag,
    serveUrl,
    snippet: buildSnippet(serveUrl, pixelUrl, dims),
    impressions: counts?.impressions ?? 0,
    clicks: counts?.clicks ?? 0,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString(),
  };
}

async function formatAsset(
  asset: typeof assetsTable.$inferSelect,
  rejectedByName?: string | null,
) {
  // Resolve the rejecter's display name so the review summary can show who
  // rejected each asset. Callers that already joined the users table can pass
  // the name in to avoid an extra query.
  let name = rejectedByName ?? null;
  if (name === null && asset.rejectedBy) {
    const [user] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.clerkId, asset.rejectedBy));
    name = user?.name ?? null;
  }
  return {
    ...asset,
    rejectedByName: name,
    rejectedAt: asset.rejectedAt ? asset.rejectedAt.toISOString() : null,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

async function canMutateAsset(assetId: number, req: any): Promise<boolean> {
  if (req.user?.role === "admin") return true;
  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, assetId));
  if (!asset) return false;
  const [brief] = await db.select().from(briefsTable).where(eq(briefsTable.id, asset.briefId));
  return brief?.createdBy === req.clerkUserId;
}

router.get("/assets", optionalAuth, async (req, res): Promise<void> => {
  const { briefId } = req.query;
  // Join the users table once so the rejecter's name comes back with each asset
  // without an extra query per row.
  const rejecter = alias(usersTable, "rejecter");
  const base = db
    .select()
    .from(assetsTable)
    .leftJoin(rejecter, eq(assetsTable.rejectedBy, rejecter.clerkId));
  const rows = briefId
    ? await base.where(eq(assetsTable.briefId, Number(briefId))).orderBy(assetsTable.id)
    : await base.orderBy(assetsTable.id);
  res.json(await Promise.all(rows.map(r => formatAsset(r.assets, r.rejecter?.name ?? null))));
});

router.get("/assets/:id", optionalAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }
  res.json(await formatAsset(asset));
});

router.patch("/assets/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!await canMutateAsset(id, req)) {
    res.status(403).json({ error: "Forbidden: you do not own this asset's brief" });
    return;
  }

  const body = req.body;
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.headline !== undefined) updateData.headline = body.headline;
  if (body.bodyText !== undefined) updateData.bodyText = body.bodyText;
  if (body.callToAction !== undefined) updateData.callToAction = body.callToAction;
  if (body.imageUrl !== undefined) updateData.imageUrl = body.imageUrl;
  if (body.htmlContent !== undefined) updateData.htmlContent = body.htmlContent;

  // A manual edit to the artwork itself (HTML source or the AI image) can
  // reintroduce off-brand colors, so re-run the relevant compliance check and
  // refresh the stored verdict. Without this a stale "passed" verdict would let
  // an edited-off-brand asset ship, and a stale "failed" would block a fixed one.
  if (body.htmlContent !== undefined || body.imageUrl !== undefined) {
    const [current] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
    if (current) {
      const [briefRow] = await db
        .select()
        .from(briefsTable)
        .leftJoin(brandsTable, eq(briefsTable.brandId, brandsTable.id))
        .where(eq(briefsTable.id, current.briefId));
      if (briefRow?.brands) {
        const brand = brandComplianceInput(briefRow.brands);
        let verdict: ComplianceVerdict | null = null;
        if (isHtmlAsset(current.templateSize)) {
          if (body.htmlContent !== undefined) {
            verdict = checkHtmlCompliance(String(body.htmlContent ?? ""), brand);
          }
        } else if (body.imageUrl !== undefined) {
          verdict = await checkAssetCompliance(
            { templateSize: current.templateSize, imageUrl: String(body.imageUrl ?? "") },
            brand,
          );
        }
        if (verdict) {
          updateData.complianceStatus = verdict.status;
          updateData.complianceScore = verdict.status === "skipped" ? null : verdict.score;
          updateData.complianceIssues = serializeIssues(verdict.issues);
          updateData.complianceCheckedAt = new Date();
        }
      }
    }
  }

  const [asset] = await db.update(assetsTable).set(updateData).where(eq(assetsTable.id, id)).returning();
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }
  res.json(await formatAsset(asset));
});

router.delete("/assets/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!await canMutateAsset(id, req)) {
    res.status(403).json({ error: "Forbidden: you do not own this asset's brief" });
    return;
  }
  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }
  // ad_tags / ad_events referencing this asset are removed via ON DELETE CASCADE.
  await db.delete(assetsTable).where(eq(assetsTable.id, id));
  res.status(204).send();
});

router.post("/assets/:id/regenerate", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!await canMutateAsset(id, req)) {
    res.status(403).json({ error: "Forbidden: you do not own this asset's brief" });
    return;
  }

  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

  // Regenerating discards the prior rejection so a fresh take starts clean.
  await db.update(assetsTable).set({
    status: "generating",
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    updatedAt: new Date(),
  }).where(eq(assetsTable.id, id));
  res.json(await formatAsset({ ...asset, status: "generating", rejectedBy: null, rejectedAt: null, rejectionReason: null }));

  runInBackground(async () => {
    try {
      const [briefRow] = await db
        .select()
        .from(briefsTable)
        .leftJoin(brandsTable, eq(briefsTable.brandId, brandsTable.id))
        .where(eq(briefsTable.id, asset.briefId));
      if (!briefRow || !briefRow.brands) return;

      const brief = briefRow.briefs;
      const brand = briefRow.brands;

      // Mirror the brief-generate pipeline: user copy fields + notes act as
      // creative direction for the regenerated take too.
      const contextParts: string[] = [];
      if (brief.notes) contextParts.push(brief.notes);
      if (brief.useAiCopy) {
        if (brief.headline) contextParts.push(`Suggested headline direction: "${brief.headline}"`);
        if (brief.bodyText) contextParts.push(`Key message: ${brief.bodyText}`);
        if (brief.callToAction) contextParts.push(`Preferred call to action: "${brief.callToAction}"`);
      }
      const briefContext = contextParts.length > 0 ? contextParts.join("\n") : null;

      const copy = await generateCopy({
        campaignName: brief.campaignName,
        brandName: brand.name,
        toneOfVoice: brand.toneOfVoice,
        industry: brand.industry,
        templateSize: asset.templateSize,
        guidelines: brand.guidelines,
        briefContext,
      });

      let imageUrl = asset.imageUrl;
      let usedLibraryImage = false;
      if (!imageUrl) {
        // Library first (matches the brief generate pipeline): reuse a real
        // approved image whose subject fits the brief; only generate new
        // artwork when nothing in the library matches.
        const libraryPick = await pickLibraryImage(
          brand.id,
          [brief.campaignName, briefContext].filter(Boolean).join("\n"),
        );
        if (libraryPick) {
          usedLibraryImage = true;
          imageUrl = `${baseUrl(req)}/api/storage${libraryPick.objectPath}`;
        }
      }
      if (!imageUrl) {
        // Size the image to the asset's canvas orientation (full coverage) and
        // steer it with the brand's own images + the template's product image,
        // then persist to object storage (never store a raw base64 data URL in
        // the DB).
        const tplById = await loadTemplateMap();
        const { width, height } = dimsForSize(asset.templateSize, tplById);
        const size = imageSizeForDims(width, height);
        const references = await collectBrandReferences(brand.id, [asset.templateSize], tplById);
        const raw = await generateProductImage({
          campaignName: brief.campaignName,
          brandName: brand.name,
          industry: brand.industry,
          toneOfVoice: brand.toneOfVoice,
          guidelines: brand.guidelines,
          briefContext,
          size,
          references,
          palette: {
            primaryColor: brand.primaryColor,
            secondaryColor: brand.secondaryColor,
            accentColor: brand.accentColor,
            backgroundColor: brand.backgroundColor,
          },
        });
        imageUrl = raw;
        if (raw && raw.startsWith("data:")) {
          try {
            const objectPath = await objectStorageService.uploadDataUrl(raw);
            imageUrl = `${baseUrl(req)}/api/storage${objectPath}`;
          } catch (err) {
            logger.error({ err, assetId: id }, "Regenerated product image upload failed");
            imageUrl = null;
          }
        }
      }

      // HTML assets (the static banner and the animated social size) keep their
      // htmlContent in sync with the fresh copy/image; otherwise regenerate would
      // change the copy fields while leaving the rendered HTML stale.
      let htmlContent = asset.htmlContent;
      if (asset.templateSize === "html_banner" || asset.templateSize === "animated_social") {
        const brandStyles = await db
          .select()
          .from(brandStylesTable)
          .where(eq(brandStylesTable.brandId, brand.id))
          .orderBy(brandStylesTable.id);
        const styleHints = brandStyles.length > 0
          ? brandStyles.map(s => `/* ${s.name} */\n${s.cssSnippet}`).join("\n\n")
          : undefined;
        const isAnimatedSize = asset.templateSize === "animated_social";
        const tplByIdForDims = await loadTemplateMap();
        htmlContent = await generateHtmlBanner({
          campaignName: brief.campaignName,
          brandName: brand.name,
          toneOfVoice: brand.toneOfVoice,
          industry: brand.industry,
          primaryColor: brand.primaryColor,
          secondaryColor: brand.secondaryColor,
          accentColor: brand.accentColor,
          backgroundColor: brand.backgroundColor,
          textColor: brand.textColor,
          fontFamily: brand.fontFamily,
          guidelines: brand.guidelines,
          briefContext,
          headline: copy.headline,
          bodyText: copy.bodyText,
          callToAction: copy.callToAction,
          imageUrl,
          styleHints,
          dimensions: dimsForSize(asset.templateSize, tplByIdForDims),
          animated: isAnimatedSize,
        });
      }

      // Re-run the AFTER-generation compliance gate so a manual regenerate can't
      // bypass the brand check (its verdict is what blocks approval/dispatch).
      // Exception: brand-library artwork on a pure image asset is pre-approved
      // brand material — the AI-image vision gate doesn't apply to it.
      const verdict: ComplianceVerdict =
        usedLibraryImage && !isHtmlAsset(asset.templateSize)
          ? { status: "passed", score: 100, issues: [] }
          : await checkAssetCompliance(
              { templateSize: asset.templateSize, htmlContent, imageUrl },
              brandComplianceInput(brand),
            );
      await db.update(assetsTable).set({
        headline: copy.headline,
        bodyText: copy.bodyText,
        callToAction: copy.callToAction,
        imageUrl,
        htmlContent,
        status: "ready",
        complianceStatus: verdict.status,
        complianceScore: verdict.status === "skipped" ? null : verdict.score,
        complianceIssues: serializeIssues(verdict.issues),
        complianceCheckedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(assetsTable.id, id));
    } catch {
      await db.update(assetsTable).set({ status: "ready", updatedAt: new Date() }).where(eq(assetsTable.id, id));
    }
  });
});

router.post("/assets/:id/approve", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!await canMutateAsset(id, req)) {
    res.status(403).json({ error: "Forbidden: you do not own this asset's brief" });
    return;
  }
  // Assets that failed the brand-compliance check are blocked from approval.
  const [existing] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Asset not found" }); return; }
  if (existing.complianceStatus === "failed") {
    res.status(409).json({
      error: "This asset failed the brand-compliance check and can't be approved. Regenerate it to produce an on-brand version.",
    });
    return;
  }
  // Approving clears any prior rejection metadata so a re-approved asset no
  // longer shows up as rejected on the review summary.
  const [asset] = await db
    .update(assetsTable)
    .set({
      status: "approved",
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(assetsTable.id, id))
    .returning();
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }
  res.json(await formatAsset(asset));
});

router.post("/assets/:id/reject", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!await canMutateAsset(id, req)) {
    res.status(403).json({ error: "Forbidden: you do not own this asset's brief" });
    return;
  }
  const rawReason = req.body?.reason;
  const reason = typeof rawReason === "string" && rawReason.trim() ? rawReason.trim() : null;
  const [asset] = await db
    .update(assetsTable)
    .set({
      status: "rejected",
      rejectedBy: req.clerkUserId ?? null,
      rejectedAt: new Date(),
      rejectionReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(assetsTable.id, id))
    .returning();
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }
  res.json(await formatAsset(asset));
});

// Returns the existing ad tag for an asset (if any).
router.get("/assets/:id/ad-tag", optionalAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [tag] = await db.select().from(adTagsTable).where(eq(adTagsTable.assetId, id));
  if (!tag) { res.status(404).json({ error: "No ad tag for this asset" }); return; }
  res.json(await formatAdTag(tag, req));
});

// Creates an ad tag for an asset, or updates the landing URL of the existing one.
router.post("/assets/:id/ad-tag", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!await canMutateAsset(id, req)) {
    res.status(403).json({ error: "Forbidden: you do not own this asset's brief" });
    return;
  }
  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

  const clickUrl: string | null = req.body?.clickUrl ?? null;
  const [existing] = await db.select().from(adTagsTable).where(eq(adTagsTable.assetId, id));
  if (existing) {
    const [updated] = await db
      .update(adTagsTable)
      .set({ clickUrl, updatedAt: new Date() })
      .where(eq(adTagsTable.id, existing.id))
      .returning();
    res.json(await formatAdTag(updated, req));
    return;
  }
  const [created] = await db
    .insert(adTagsTable)
    .values({ assetId: id, token: randomUUID(), clickUrl })
    .returning();
  res.status(201).json(await formatAdTag(created, req));
});

// Bulk: create ad tags for every asset in a brief in one action. Idempotent —
// assets that already have a tag keep it (and their token), so previously
// embedded tags keep working. When a shared clickUrl is provided it is applied
// to all of them; when omitted, existing landing URLs are left untouched.
router.post("/briefs/:id/ad-tags", requireAuth, async (req, res): Promise<void> => {
  const briefId = Number(req.params.id);
  const [brief] = await db.select().from(briefsTable).where(eq(briefsTable.id, briefId));
  if (!brief) { res.status(404).json({ error: "Brief not found" }); return; }
  if (req.user?.role !== "admin" && brief.createdBy !== req.clerkUserId) {
    res.status(403).json({ error: "Forbidden: you do not own this brief" });
    return;
  }

  const raw = req.body?.clickUrl;
  const clickUrl: string | null =
    typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;

  const assets = await db
    .select()
    .from(assetsTable)
    .where(eq(assetsTable.briefId, briefId))
    .orderBy(assetsTable.id);

  let created = 0;
  let updated = 0;
  const tags: Awaited<ReturnType<typeof formatAdTag>>[] = [];
  for (const asset of assets) {
    const [existing] = await db
      .select()
      .from(adTagsTable)
      .where(eq(adTagsTable.assetId, asset.id));
    if (existing) {
      if (clickUrl !== null && clickUrl !== existing.clickUrl) {
        const [row] = await db
          .update(adTagsTable)
          .set({ clickUrl, updatedAt: new Date() })
          .where(eq(adTagsTable.id, existing.id))
          .returning();
        tags.push(await formatAdTag(row, req));
        updated++;
      } else {
        tags.push(await formatAdTag(existing, req));
      }
    } else {
      const [row] = await db
        .insert(adTagsTable)
        .values({ assetId: asset.id, token: randomUUID(), clickUrl })
        .returning();
      tags.push(await formatAdTag(row, req));
      created++;
    }
  }

  res.json({ total: assets.length, created, updated, tags });
});

export default router;
