import { Router } from "express";
import { db } from "@workspace/db";
import { briefsTable, brandsTable, assetsTable, usersTable, templatesTable } from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { generateCopy, generateProductImage, generateHtmlBanner, extractBriefFromText, suggestTemplateSizes, type ProductImageSize } from "../lib/openai";
import { extractPdfText } from "../lib/pdf";
import { extractDocxText } from "../lib/docx";
import { brandStylesTable } from "@workspace/db";
import { requireAuth, optionalAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { runInBackground } from "../lib/background";
import { ObjectStorageService } from "../lib/objectStorage";
import { imageSizeForDims, dimsForSize, collectBrandReferences, pickLibraryImage } from "../lib/assetImages";
import { fetchLogoDataUri } from "../lib/htmlBanner";
import { checkAssetCompliance, serializeIssues, type ComplianceVerdict } from "../lib/brandCompliance";

const router = Router();
const objectStorageService = new ObjectStorageService();

function baseUrl(req: any): string {
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0];
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

// Feed-driven batch variants: one row = one asset per size, sharing the
// size's artwork but carrying row-specific copy.
export interface VariantRow {
  label: string | null;
  headline: string | null;
  bodyText: string | null;
  callToAction: string | null;
}

const MAX_VARIANT_ROWS = 20;
const MAX_VARIANT_FIELD = 500;

/** Validate client-supplied variant rows; null when there are none. */
function normalizeVariantsInput(raw: unknown): VariantRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: VariantRow[] = [];
  for (const item of raw.slice(0, MAX_VARIANT_ROWS)) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const field = (v: unknown) =>
      typeof v === "string" && v.trim() ? v.trim().slice(0, MAX_VARIANT_FIELD) : null;
    const row: VariantRow = {
      label: field(r.label),
      headline: field(r.headline),
      bodyText: field(r.bodyText),
      callToAction: field(r.callToAction),
    };
    if (row.label || row.headline || row.bodyText || row.callToAction) rows.push(row);
  }
  return rows.length > 0 ? rows : null;
}

export function parseVariants(stored: string | null): VariantRow[] {
  if (!stored) return [];
  try {
    return normalizeVariantsInput(JSON.parse(stored)) ?? [];
  } catch {
    return [];
  }
}

function formatBrief(
  brief: typeof briefsTable.$inferSelect,
  brand: typeof brandsTable.$inferSelect,
  assetCount: number,
  names?: { createdByName?: string | null; approvedByName?: string | null; dispatchedByName?: string | null },
) {
  return {
    ...brief,
    templateSizes: JSON.parse(brief.templateSizes || "[]"),
    variants: brief.variants ? parseVariants(brief.variants) : null,
    scheduledAt: brief.scheduledAt ? brief.scheduledAt.toISOString() : null,
    scheduledMethods: brief.scheduledMethods ? JSON.parse(brief.scheduledMethods) : null,
    approvedAt: brief.approvedAt ? brief.approvedAt.toISOString() : null,
    dispatchedAt: brief.dispatchedAt ? brief.dispatchedAt.toISOString() : null,
    brand: {
      ...brand,
      supportedTemplateSizes: JSON.parse((brand as any).supportedTemplateSizes || '["social_square","story","banner","print_a4","animated_social"]'),
      createdAt: brand.createdAt.toISOString(),
      updatedAt: brand.updatedAt.toISOString(),
    },
    assetCount,
    createdByName: names?.createdByName ?? null,
    approvedByName: names?.approvedByName ?? null,
    dispatchedByName: names?.dispatchedByName ?? null,
    createdAt: brief.createdAt.toISOString(),
    updatedAt: brief.updatedAt.toISOString(),
  };
}

function canMutate(brief: typeof briefsTable.$inferSelect, req: any): boolean {
  return req.user?.role === "admin" || brief.createdBy === req.clerkUserId;
}

/**
 * Combine everything the brief tells us about the campaign into one context
 * string for the AI generators. When AI copy is on, user-entered copy fields
 * double as creative direction rather than being ignored.
 */
function briefContextOf(brief: typeof briefsTable.$inferSelect): string | null {
  const parts: string[] = [];
  if (brief.notes) parts.push(brief.notes);
  if (brief.useAiCopy) {
    if (brief.headline) parts.push(`Suggested headline direction: "${brief.headline}"`);
    if (brief.bodyText) parts.push(`Key message: ${brief.bodyText}`);
    if (brief.callToAction) parts.push(`Preferred call to action: "${brief.callToAction}"`);
  }
  const joined = parts.join("\n").trim();
  return joined.length > 0 ? joined : null;
}

// Validate that every requested template size is one the chosen brand actually
// supports. A size is allowed when it is in the brand's supportedTemplateSizes
// OR it is a "learned creative" (knowledge) template — those are brand-agnostic
// by design and intentionally live outside any brand's supported list (mirrors
// the brief create/edit forms' knowledgeKeys escape hatch).
async function validateTemplateSizes(
  brandId: number,
  templateSizes: string[],
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
  if (!brand) return { ok: false, status: 400, error: "Brand not found" };

  const supported: string[] = JSON.parse(
    (brand as any).supportedTemplateSizes || '["social_square","story","banner","print_a4","animated_social"]',
  );
  const knowledgeRows = await db
    .select({ id: templatesTable.id })
    .from(templatesTable)
    .where(eq(templatesTable.category, "knowledge"));
  const knowledgeKeys = new Set(knowledgeRows.map((t) => `tpl_${t.id}`));

  const invalid = templateSizes.filter((s) => !supported.includes(s) && !knowledgeKeys.has(s));
  if (invalid.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Brand "${brand.name}" does not support the requested template size(s): ${invalid.join(", ")}`,
    };
  }
  return { ok: true };
}

router.get("/briefs", optionalAuth, async (req, res): Promise<void> => {
  const { status, brandId, mine } = req.query;

  const conditions = [];
  if (status && typeof status === "string") conditions.push(eq(briefsTable.status, status));
  if (brandId) conditions.push(eq(briefsTable.brandId, Number(brandId)));
  if (mine === "true" && req.clerkUserId) conditions.push(eq(briefsTable.createdBy, req.clerkUserId));

  const creator = alias(usersTable, "creator");
  const approver = alias(usersTable, "approver");
  const dispatcher = alias(usersTable, "dispatcher");

  const briefs = await db
    .select()
    .from(briefsTable)
    .leftJoin(brandsTable, eq(briefsTable.brandId, brandsTable.id))
    .leftJoin(creator, eq(briefsTable.createdBy, creator.clerkId))
    .leftJoin(approver, eq(briefsTable.approvedBy, approver.clerkId))
    .leftJoin(dispatcher, eq(briefsTable.dispatchedBy, dispatcher.clerkId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(briefsTable.id);

  const briefIds = briefs.map((b) => b.briefs.id);
  let assetCounts: Record<number, number> = {};
  if (briefIds.length > 0) {
    const counts = await db
      .select({ briefId: assetsTable.briefId, count: sql<number>`cast(count(*) as int)` })
      .from(assetsTable)
      .groupBy(assetsTable.briefId);
    assetCounts = Object.fromEntries(counts.map((c) => [c.briefId, c.count]));
  }

  const result = briefs
    .filter((b) => b.brands !== null)
    .map((b) => formatBrief(b.briefs, b.brands!, assetCounts[b.briefs.id] ?? 0, {
      createdByName: b.creator?.name,
      approvedByName: b.approver?.name,
      dispatchedByName: b.dispatcher?.name,
    }));

  res.json(result);
});

router.post("/briefs", requireAuth, async (req, res): Promise<void> => {
  const body = req.body;
  const requestedSizes: string[] = body.templateSizes ?? [];
  const sizeCheck = await validateTemplateSizes(body.brandId, requestedSizes);
  if (!sizeCheck.ok) { res.status(sizeCheck.status).json({ error: sizeCheck.error }); return; }
  const [brief] = await db
    .insert(briefsTable)
    .values({
      campaignName: body.campaignName,
      headline: body.headline ?? null,
      bodyText: body.bodyText ?? null,
      callToAction: body.callToAction ?? null,
      notes: body.notes ?? null,
      variants: (() => {
        const rows = normalizeVariantsInput(body.variants);
        return rows ? JSON.stringify(rows) : null;
      })(),
      productImageUrl: body.productImageUrl ?? null,
      templateSizes: JSON.stringify(body.templateSizes ?? []),
      useAiCopy: body.useAiCopy ?? true,
      brandId: body.brandId,
      campaignId: body.campaignId ?? null,
      status: "draft",
      createdBy: req.clerkUserId,
    })
    .returning();
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brief.brandId));
  res.status(201).json(formatBrief(brief, brand, 0));
});

router.post("/briefs/bulk", requireAuth, async (req, res): Promise<void> => {
  const body = req.body;
  const rows: Array<Record<string, unknown>> = body.rows ?? [];
  const brandId: number = body.brandId;

  const created = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowBrandId = Number(row.brandId ?? brandId);
    const rowSizes: string[] = (row.templateSizes as string[]) ?? [];
    const sizeCheck = await validateTemplateSizes(rowBrandId, rowSizes);
    if (!sizeCheck.ok) {
      res.status(sizeCheck.status).json({ error: `Row ${i + 1}: ${sizeCheck.error}` });
      return;
    }
    const [brief] = await db
      .insert(briefsTable)
      .values({
        campaignName: String(row.campaignName),
        headline: (row.headline as string) ?? null,
        bodyText: (row.bodyText as string) ?? null,
        callToAction: (row.callToAction as string) ?? null,
        notes: (row.notes as string) ?? null,
        productImageUrl: (row.productImageUrl as string) ?? null,
        templateSizes: JSON.stringify(row.templateSizes ?? []),
        useAiCopy: Boolean(row.useAiCopy ?? true),
        brandId: Number(row.brandId ?? brandId),
        status: "draft",
        createdBy: req.clerkUserId,
      })
      .returning();
    const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brief.brandId));
    created.push(formatBrief(brief, brand, 0));
  }
  res.status(201).json(created);
});

// Parse an uploaded Word (.docx) or PDF brief document into draft brief fields
// so the New Brief form can be pre-filled. Extracts text server-side, then asks
// the LLM to structure it. 400 for unsupported types, 422 when no text is found.
router.post("/briefs/parse-document", requireAuth, async (req, res): Promise<void> => {
  const objectPath = typeof req.body?.objectPath === "string" ? req.body.objectPath : "";
  const fileName = typeof req.body?.fileName === "string" ? req.body.fileName : "";
  if (!objectPath.startsWith("/objects/")) {
    res.status(400).json({ error: "A valid objectPath is required" });
    return;
  }

  const lower = fileName.toLowerCase();
  const isPdf = lower.endsWith(".pdf");
  const isDocx = lower.endsWith(".docx");
  if (!isPdf && !isDocx) {
    res.status(400).json({ error: "Unsupported file type. Upload a Word (.docx) or PDF document." });
    return;
  }

  let text = "";
  try {
    text = isPdf ? await extractPdfText(objectPath) : await extractDocxText(objectPath);
  } catch (err) {
    logger.error({ err }, "brief document extraction failed");
    res.status(422).json({ error: "Could not read that document" });
    return;
  }

  if (!text || text.length < 10) {
    res.status(422).json({
      error: isPdf
        ? "No text found. If this is a scanned PDF, it can't be read automatically."
        : "No text found in that document.",
    });
    return;
  }

  const fields = await extractBriefFromText({ text, fileName });
  res.json(fields);
});

/** Built-in creative formats, mirroring the frontend's SIZE_CONFIGS. */
const BUILTIN_SIZE_OPTIONS = [
  { key: "social_square", label: "Social Square 1080×1080 — Instagram/Facebook feed post" },
  { key: "story", label: "Story 1080×1920 — Instagram/Facebook story, Reels, TikTok" },
  { key: "banner", label: "Banner 728×90 — static leaderboard display ad" },
  { key: "html_banner", label: "HTML5 Banner 970×250 — programmatic display (CM360/DV360/GDN)" },
  { key: "print_a4", label: "Print A4 — posters, flyers, print material" },
  { key: "animated_social", label: "Animated Social 1080×1080 — animated/motion social post" },
];

// Registered before /briefs/:id so "suggest-sizes" isn't captured as an id.
router.post("/briefs/suggest-sizes", requireAuth, async (req, res): Promise<void> => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (text.length < 15) {
    res.status(400).json({ error: "Provide at least a sentence of brief text" });
    return;
  }
  const custom = await db.select().from(templatesTable);
  const options = [
    ...BUILTIN_SIZE_OPTIONS,
    ...custom.map((t) => ({
      key: `tpl_${t.id}`,
      label: `${t.name} ${t.width}×${t.height}${t.category === "knowledge" ? " — learned creative layout" : ""}`,
    })),
  ];
  try {
    const suggestion = await suggestTemplateSizes({ text, options });
    res.json(suggestion);
  } catch (err) {
    logger.error({ err }, "suggest-sizes failed");
    res.status(502).json({ error: "Could not suggest sizes" });
  }
});

router.get("/briefs/:id", optionalAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const creator = alias(usersTable, "creator");
  const approver = alias(usersTable, "approver");
  const dispatcher = alias(usersTable, "dispatcher");
  const [row] = await db
    .select()
    .from(briefsTable)
    .leftJoin(brandsTable, eq(briefsTable.brandId, brandsTable.id))
    .leftJoin(creator, eq(briefsTable.createdBy, creator.clerkId))
    .leftJoin(approver, eq(briefsTable.approvedBy, approver.clerkId))
    .leftJoin(dispatcher, eq(briefsTable.dispatchedBy, dispatcher.clerkId))
    .where(eq(briefsTable.id, id));
  if (!row || !row.brands) { res.status(404).json({ error: "Brief not found" }); return; }

  const [countRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(assetsTable)
    .where(eq(assetsTable.briefId, id));

  res.json(formatBrief(row.briefs, row.brands, countRow?.count ?? 0, {
    createdByName: row.creator?.name,
    approvedByName: row.approver?.name,
    dispatchedByName: row.dispatcher?.name,
  }));
});

router.patch("/briefs/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(briefsTable).where(eq(briefsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Brief not found" }); return; }
  if (!canMutate(existing, req)) { res.status(403).json({ error: "Forbidden: you do not own this brief" }); return; }

  const body = req.body;

  // If the brief's sizes or brand are changing, enforce that every size is one
  // the (possibly new) brand supports — using the effective post-update values.
  if (body.templateSizes !== undefined || body.brandId !== undefined) {
    const effectiveBrandId = body.brandId !== undefined ? body.brandId : existing.brandId;
    const effectiveSizes: string[] =
      body.templateSizes !== undefined ? body.templateSizes : JSON.parse(existing.templateSizes || "[]");
    const sizeCheck = await validateTemplateSizes(effectiveBrandId, effectiveSizes);
    if (!sizeCheck.ok) { res.status(sizeCheck.status).json({ error: sizeCheck.error }); return; }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.campaignName !== undefined) updateData.campaignName = body.campaignName;
  if (body.headline !== undefined) updateData.headline = body.headline;
  if (body.bodyText !== undefined) updateData.bodyText = body.bodyText;
  if (body.callToAction !== undefined) updateData.callToAction = body.callToAction;
  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.variants !== undefined) {
    const rows = normalizeVariantsInput(body.variants);
    updateData.variants = rows ? JSON.stringify(rows) : null;
  }
  if (body.productImageUrl !== undefined) updateData.productImageUrl = body.productImageUrl;
  if (body.templateSizes !== undefined) updateData.templateSizes = JSON.stringify(body.templateSizes);
  if (body.useAiCopy !== undefined) updateData.useAiCopy = body.useAiCopy;
  if (body.brandId !== undefined) updateData.brandId = body.brandId;
  if (body.campaignId !== undefined) updateData.campaignId = body.campaignId;
  if (body.status !== undefined) updateData.status = body.status;

  const [brief] = await db.update(briefsTable).set(updateData).where(eq(briefsTable.id, id)).returning();
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brief.brandId));
  const [countRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(assetsTable)
    .where(eq(assetsTable.briefId, id));

  res.json(formatBrief(brief, brand, countRow?.count ?? 0));
});

router.delete("/briefs/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(briefsTable).where(eq(briefsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Brief not found" }); return; }
  if (!canMutate(existing, req)) { res.status(403).json({ error: "Forbidden: you do not own this brief" }); return; }

  await db.delete(briefsTable).where(eq(briefsTable.id, id));
  res.status(204).send();
});

router.post("/briefs/:id/generate", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db
    .select()
    .from(briefsTable)
    .leftJoin(brandsTable, eq(briefsTable.brandId, brandsTable.id))
    .where(eq(briefsTable.id, id));
  if (!row || !row.brands) { res.status(404).json({ error: "Brief not found" }); return; }
  if (!canMutate(row.briefs, req)) { res.status(403).json({ error: "Forbidden: you do not own this brief" }); return; }

  const brief = row.briefs;
  const brand = row.brands;
  const sizes: string[] = JSON.parse(brief.templateSizes || "[]");

  // Atomically claim the brief for generation: only transition when it is NOT already
  // generating. This guards against concurrent generate calls (e.g. two tabs) racing,
  // which would otherwise spawn overlapping background jobs that clobber each other's assets.
  const claimed = await db
    .update(briefsTable)
    .set({ status: "generating", updatedAt: new Date() })
    .where(and(eq(briefsTable.id, id), sql`${briefsTable.status} <> 'generating'`))
    .returning({ id: briefsTable.id });
  if (claimed.length === 0) {
    res.status(409).json({ error: "Generation already in progress for this brief" });
    return;
  }
  await db.delete(assetsTable).where(eq(assetsTable.briefId, id));

  res.json(formatBrief({ ...brief, status: "generating" }, brand, 0));

  runInBackground(async () => {
    try {
      const brandStylesPromise = db
        .select()
        .from(brandStylesTable)
        .where(eq(brandStylesTable.brandId, brand.id))
        .orderBy(brandStylesTable.id);

      // Build descriptions for any custom templates referenced by this brief so the
      // copywriter prompt knows their dimensions/format (built-in sizes are handled in openai.ts).
      const customTemplates = await db.select().from(templatesTable);
      const tplById = new Map<string, typeof templatesTable.$inferSelect>(
        customTemplates.map((t) => [`tpl_${t.id}`, t] as const),
      );
      const templateDescriptions = new Map<string, string>();
      for (const t of customTemplates) {
        const orientation = t.width > t.height ? "horizontal" : t.height > t.width ? "vertical" : "square";
        templateDescriptions.set(`tpl_${t.id}`, `${t.width}x${t.height} ${orientation} "${t.name}" creative format`);
      }

      // Resolve each requested size to the gpt-image-1 orientation that fills it.
      const sizeToImageSize = new Map<string, ProductImageSize>();
      for (const size of sizes) {
        const { width, height } = dimsForSize(size, tplById);
        sizeToImageSize.set(size, imageSizeForDims(width, height));
      }

      const useAiImage = !brief.productImageUrl && brief.useAiCopy;
      const briefContext = briefContextOf(brief);
      // Set when imagery is reused from the brand library instead of generated;
      // library artwork is pre-approved brand material, so the AI-image vision
      // gate (calibrated for generated backgrounds) doesn't apply to it.
      let usedLibraryImage = false;

      // Generate ONE on-brand image per distinct orientation so every canvas is
      // fully covered (not cropped from a square), reusing the brand's images +
      // the template's image as references. Bounded at 3 image calls per brief.
      const generateImagesByOrientation = async (): Promise<Map<ProductImageSize, string | null>> => {
        const out = new Map<ProductImageSize, string | null>();
        if (!useAiImage) return out;

        // Library first: a real approved image whose subject matches the brief
        // beats generated artwork (free, instant, guaranteed on-brand). Only
        // generate when nothing in the library fits.
        const libraryPick = await pickLibraryImage(
          brand.id,
          [brief.campaignName, briefContext].filter(Boolean).join("\n"),
        );
        if (libraryPick) {
          usedLibraryImage = true;
          const url = `${baseUrl(req)}/api/storage${libraryPick.objectPath}`;
          for (const imgSize of new Set(sizeToImageSize.values())) out.set(imgSize, url);
          return out;
        }

        const references = await collectBrandReferences(brand.id, sizes, tplById);
        const distinct = [...new Set(sizeToImageSize.values())];
        const results = await Promise.all(
          distinct.map(async (imgSize) => {
            const raw = await generateProductImage({
              campaignName: brief.campaignName,
              brandName: brand.name,
              industry: brand.industry,
              toneOfVoice: brand.toneOfVoice,
              guidelines: brand.guidelines,
              briefContext,
              size: imgSize,
              references,
              palette: {
                primaryColor: brand.primaryColor,
                secondaryColor: brand.secondaryColor,
                accentColor: brand.accentColor,
                backgroundColor: brand.backgroundColor,
              },
            });
            // base64 data URLs must never be injected into a prompt (context
            // overflow) or stored in the DB — persist to object storage and keep
            // the short serving URL.
            let url: string | null = raw;
            if (raw && raw.startsWith("data:")) {
              try {
                const objectPath = await objectStorageService.uploadDataUrl(raw);
                url = `${baseUrl(req)}/api/storage${objectPath}`;
              } catch (err) {
                logger.error({ err, briefId: id }, "Product image upload failed");
                url = null;
              }
            }
            return [imgSize, url] as const;
          }),
        );
        for (const [k, v] of results) out.set(k, v);
        return out;
      };

      // Kick off copy generation for every size in parallel (only when AI copy is on).
      const copyPromises = sizes.map((size) =>
        brief.useAiCopy
          ? generateCopy({
              campaignName: brief.campaignName,
              brandName: brand.name,
              toneOfVoice: brand.toneOfVoice,
              industry: brand.industry,
              guidelines: brand.guidelines,
              briefContext,
              templateSize: size,
              sizeDescription: templateDescriptions.get(size),
            })
          : Promise.resolve({
              headline: brief.headline ?? "",
              bodyText: brief.bodyText ?? "",
              callToAction: brief.callToAction ?? "Find out more",
            }),
      );

      const [brandStyles, copies, generatedImages] = await Promise.all([
        brandStylesPromise,
        Promise.all(copyPromises),
        generateImagesByOrientation(),
      ]);

      // A user-supplied product image is reused as-is; AI images are chosen by the
      // size's orientation so every asset's canvas is fully covered.
      const imageForSize = (size: string): string | null => {
        if (brief.productImageUrl) return brief.productImageUrl;
        const imgSize = sizeToImageSize.get(size) ?? "1024x1024";
        return generatedImages.get(imgSize) ?? null;
      };

      const styleHints = brandStyles.length > 0
        ? brandStyles.map(s => `/* ${s.name} */\n${s.cssSnippet}`).join("\n\n")
        : undefined;

      // Master logo tile for HTML banners, embedded as a data URI (ad servers
      // reject external requests). Fetched once per generation run.
      const logoDataUri = await fetchLogoDataUri(brand.logoUrl, baseUrl(req));

      const skippedVerdict: ComplianceVerdict = { status: "skipped", score: 0, issues: [] };
      const brandForCompliance = {
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
      const complianceFields = (v: ComplianceVerdict) => ({
        complianceStatus: v.status,
        complianceScore: v.status === "skipped" ? null : v.score,
        complianceIssues: serializeIssues(v.issues),
        complianceCheckedAt: new Date(),
      });

      // AFTER-generation compliance gate for AI images. Validate each distinct
      // orientation image ONCE (it is shared across every asset of that
      // orientation), retry a single time with the failure fed back into the
      // prompt, and keep whichever result is more on-brand.
      const imageVerdicts = new Map<ProductImageSize, ComplianceVerdict>();
      if (useAiImage && usedLibraryImage) {
        // Brand-library artwork is already approved brand material — it passes
        // by definition, and must never trigger the regenerate-on-failure retry.
        for (const [imgSize, url] of generatedImages) {
          if (url) imageVerdicts.set(imgSize, { status: "passed", score: 100, issues: [] });
        }
      } else if (useAiImage) {
        const retryReferences = await collectBrandReferences(brand.id, sizes, tplById);
        for (const [imgSize, url] of generatedImages) {
          if (!url) continue;
          let verdict = await checkAssetCompliance({ templateSize: "image", imageUrl: url }, brandForCompliance);
          if (verdict.status === "failed") {
            try {
              const retryRaw = await generateProductImage({
                campaignName: brief.campaignName,
                brandName: brand.name,
                industry: brand.industry,
                toneOfVoice: brand.toneOfVoice,
                guidelines: brand.guidelines,
                briefContext,
                size: imgSize,
                references: retryReferences,
                palette: {
                  primaryColor: brand.primaryColor,
                  secondaryColor: brand.secondaryColor,
                  accentColor: brand.accentColor,
                  backgroundColor: brand.backgroundColor,
                },
                complianceFeedback: verdict.issues.join("; "),
              });
              if (retryRaw) {
                let retryUrl: string | null = retryRaw;
                if (retryRaw.startsWith("data:")) {
                  try {
                    const objectPath = await objectStorageService.uploadDataUrl(retryRaw);
                    retryUrl = `${baseUrl(req)}/api/storage${objectPath}`;
                  } catch (err) {
                    logger.error({ err, briefId: id }, "Compliance retry image upload failed");
                    retryUrl = null;
                  }
                }
                if (retryUrl) {
                  const retryVerdict = await checkAssetCompliance({ templateSize: "image", imageUrl: retryUrl }, brandForCompliance);
                  if (retryVerdict.status === "passed" || retryVerdict.score > verdict.score) {
                    generatedImages.set(imgSize, retryUrl);
                    verdict = retryVerdict;
                  }
                }
              }
            } catch (err) {
              logger.warn({ err, briefId: id }, "Image compliance retry failed");
            }
          }
          imageVerdicts.set(imgSize, verdict);
        }
      }

      // Feed-driven variants: artwork is rendered once per size (above); each
      // variant row yields its own asset with row-specific copy. Missing row
      // fields fall back to the size's base copy. No rows = one base take.
      const variantRows = parseVariants(brief.variants);
      const takes: (VariantRow | null)[] = variantRows.length > 0 ? variantRows : [null];

      for (let i = 0; i < sizes.length; i++) {
        const size = sizes[i];
        const copy = copies[i];
        const sizeImageUrl = imageForSize(size);
        const baseHeadline = brief.useAiCopy ? copy.headline : (brief.headline ?? null);
        const baseBodyText = brief.useAiCopy ? copy.bodyText : (brief.bodyText ?? null);
        const baseCallToAction = (brief.useAiCopy ? copy.callToAction : brief.callToAction) ?? "Find out more";

        for (const take of takes) {
          const headline = take?.headline ?? baseHeadline;
          const bodyText = take?.bodyText ?? baseBodyText;
          const callToAction = take?.callToAction ?? baseCallToAction;
          const variantLabel = take?.label ?? null;

          // Both the static HTML banner and the animated social size are produced
          // as self-contained HTML; the animated size renders larger (1080×1080)
          // and requires prominent looping motion. Each variant needs its own
          // document (the copy is baked into the markup).
          if (size === "html_banner" || size === "animated_social") {
            const isAnimatedSize = size === "animated_social";
            const htmlParams = {
              campaignName: brief.campaignName,
              brandName: brand.name,
              toneOfVoice: brand.toneOfVoice,
              industry: brand.industry,
              guidelines: brand.guidelines,
              briefContext,
              primaryColor: brand.primaryColor,
              secondaryColor: brand.secondaryColor,
              accentColor: brand.accentColor,
              backgroundColor: brand.backgroundColor,
              textColor: brand.textColor,
              fontFamily: brand.fontFamily,
              headline,
              bodyText,
              callToAction,
              imageUrl: sizeImageUrl ?? null,
              styleHints,
              // Always pass the real canvas dims so the generated document and its
              // ad.size meta match the size being dispatched.
              dimensions: dimsForSize(size, tplById),
              animated: isAnimatedSize,
              logoDataUri,
            };
            let htmlContent = await generateHtmlBanner(htmlParams);
            // AFTER-generation compliance gate (deterministic color/font parse);
            // retry once with the failure fed back into the prompt.
            let verdict = await checkAssetCompliance({ templateSize: size, htmlContent }, brandForCompliance);
            if (verdict.status === "failed") {
              try {
                const retryHtml = await generateHtmlBanner({ ...htmlParams, complianceFeedback: verdict.issues.join("; ") });
                const retryVerdict = await checkAssetCompliance({ templateSize: size, htmlContent: retryHtml }, brandForCompliance);
                if (retryVerdict.status === "passed" || retryVerdict.score > verdict.score) {
                  htmlContent = retryHtml;
                  verdict = retryVerdict;
                }
              } catch (err) {
                logger.warn({ err, briefId: id }, "HTML compliance retry failed");
              }
            }
            await db.insert(assetsTable).values({
              briefId: id,
              templateSize: size,
              variantLabel,
              headline,
              bodyText,
              callToAction,
              imageUrl: sizeImageUrl ?? null,
              isAnimated: isAnimatedSize,
              htmlContent,
              status: "ready",
              ...complianceFields(verdict),
            });
            continue;
          }

          const imgSizeForAsset = sizeToImageSize.get(size) ?? "1024x1024";
          const imageVerdict = brief.productImageUrl
            ? skippedVerdict
            : (imageVerdicts.get(imgSizeForAsset) ?? skippedVerdict);
          await db.insert(assetsTable).values({
            briefId: id,
            templateSize: size,
            variantLabel,
            headline,
            bodyText,
            callToAction,
            imageUrl: sizeImageUrl ?? null,
            isAnimated: false,
            status: "ready",
            ...complianceFields(imageVerdict),
          });
        }
      }

      await db.update(briefsTable).set({ status: "pending_approval", updatedAt: new Date() }).where(eq(briefsTable.id, id));
    } catch (err) {
      logger.error({ err, briefId: id }, "Asset generation failed");
      await db.update(briefsTable).set({ status: "draft", updatedAt: new Date() }).where(eq(briefsTable.id, id));
    }
  });
});

router.post("/briefs/:id/approve", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(briefsTable).where(eq(briefsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Brief not found" }); return; }
  if (!canMutate(existing, req)) { res.status(403).json({ error: "Forbidden: you do not own this brief" }); return; }

  await db.update(assetsTable).set({ status: "approved", updatedAt: new Date() }).where(and(eq(assetsTable.briefId, id), ne(assetsTable.status, "rejected"), sql`${assetsTable.complianceStatus} is distinct from 'failed'`));
  const [brief] = await db.update(briefsTable).set({ status: "approved", approvedBy: req.clerkUserId, approvedAt: new Date(), updatedAt: new Date() }).where(eq(briefsTable.id, id)).returning();

  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brief.brandId));
  const [countRow] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(assetsTable).where(eq(assetsTable.briefId, id));
  const [approverRow] = brief.approvedBy
    ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.clerkId, brief.approvedBy))
    : [];
  res.json(formatBrief(brief, brand, countRow?.count ?? 0, { approvedByName: approverRow?.name }));
});

router.post("/briefs/:id/duplicate", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [original] = await db.select().from(briefsTable).where(eq(briefsTable.id, id));
  if (!original) { res.status(404).json({ error: "Brief not found" }); return; }

  const [newBrief] = await db
    .insert(briefsTable)
    .values({
      campaignName: `${original.campaignName} (Copy)`,
      headline: original.headline,
      bodyText: original.bodyText,
      callToAction: original.callToAction,
      productImageUrl: original.productImageUrl,
      templateSizes: original.templateSizes,
      useAiCopy: original.useAiCopy,
      brandId: original.brandId,
      status: "draft",
      createdBy: req.clerkUserId,
    })
    .returning();

  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, newBrief.brandId));
  res.status(201).json(formatBrief(newBrief, brand, 0));
});

router.post("/briefs/:id/dispatch", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(briefsTable).where(eq(briefsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Brief not found" }); return; }
  if (!canMutate(existing, req)) { res.status(403).json({ error: "Forbidden: you do not own this brief" }); return; }

  const body = req.body;
  const methods: string[] = body.methods ?? [];

  const scheduledAtRaw = body.scheduledAt;
  if (scheduledAtRaw) {
    const scheduledAt = new Date(scheduledAtRaw);
    if (Number.isNaN(scheduledAt.getTime())) {
      res.status(400).json({ error: "Invalid scheduledAt" });
      return;
    }
    await db.update(briefsTable).set({
      status: "scheduled",
      scheduledAt,
      scheduledMethods: JSON.stringify(methods),
      dispatchedBy: req.clerkUserId,
      updatedAt: new Date(),
    }).where(eq(briefsTable.id, id));
    res.json({
      success: true,
      methods,
      scheduled: true,
      scheduledAt: scheduledAt.toISOString(),
      message: `Dispatch scheduled for ${scheduledAt.toISOString()}`,
      briefId: id,
    });
    return;
  }

  // Non-compliant assets are blocked from dispatch alongside rejected ones.
  const [shippableRow] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(assetsTable).where(and(eq(assetsTable.briefId, id), ne(assetsTable.status, "rejected"), sql`${assetsTable.complianceStatus} is distinct from 'failed'`));
  const [rejectedRow] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(assetsTable).where(and(eq(assetsTable.briefId, id), eq(assetsTable.status, "rejected")));
  const [blockedRow] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(assetsTable).where(and(eq(assetsTable.briefId, id), ne(assetsTable.status, "rejected"), eq(assetsTable.complianceStatus, "failed")));
  const shippableCount = shippableRow?.count ?? 0;
  const rejectedCount = rejectedRow?.count ?? 0;
  const blockedCount = blockedRow?.count ?? 0;

  const exclusions: string[] = [];
  if (rejectedCount > 0) exclusions.push(`${rejectedCount} rejected`);
  if (blockedCount > 0) exclusions.push(`${blockedCount} non-compliant`);
  const exclusionNote = exclusions.length > 0 ? ` (${exclusions.join(", ")} asset${rejectedCount + blockedCount !== 1 ? "s" : ""} excluded)` : "";
  const log = `Dispatched ${shippableCount} asset${shippableCount !== 1 ? "s" : ""} via ${methods.join(", ")} on ${new Date().toISOString()}${exclusionNote}`;
  await db.update(briefsTable).set({ status: "dispatched", dispatchLog: log, dispatchedBy: req.clerkUserId, dispatchedAt: new Date(), scheduledAt: null, scheduledMethods: null, updatedAt: new Date() }).where(eq(briefsTable.id, id));

  res.json({
    success: true,
    methods,
    scheduled: false,
    dispatchedCount: shippableCount,
    excludedCount: rejectedCount + blockedCount,
    blockedCount,
    message: `Assets dispatched via: ${methods.join(", ")}`,
    briefId: id,
  });
});

export default router;
