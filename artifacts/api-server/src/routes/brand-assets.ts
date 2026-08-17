import { Router } from "express";
import { db } from "@workspace/db";
import { brandAssetsTable, brandAssetKindValues, brandsTable, templatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { optionalAuth, requireAuth, requireAdmin } from "../middlewares/requireAuth";
import { importInDesignPackage } from "../lib/indesignPackage";
import { normalizeFreeformConfig } from "../lib/freeform";
import { snapConfigToPalette } from "../lib/pdfDissect";
import { collectBrandPaletteHexes } from "../lib/colorAdapter";

const router = Router();

function formatBrandAsset(a: typeof brandAssetsTable.$inferSelect) {
  return {
    id: a.id,
    brandId: a.brandId,
    name: a.name,
    kind: a.kind,
    folder: a.folder,
    objectPath: a.objectPath,
    url: `/api/storage${a.objectPath}`,
    contentType: a.contentType,
    createdAt: a.createdAt.toISOString(),
  };
}

router.get("/brands/:brandId/assets", optionalAuth, async (req, res): Promise<void> => {
  const brandId = Number(req.params.brandId);
  if (!Number.isInteger(brandId)) {
    res.status(400).json({ error: "Invalid brand id" });
    return;
  }
  const assets = await db
    .select()
    .from(brandAssetsTable)
    .where(eq(brandAssetsTable.brandId, brandId))
    .orderBy(brandAssetsTable.id);
  res.json(assets.map(formatBrandAsset));
});

router.post("/brands/:brandId/assets", requireAuth, async (req, res): Promise<void> => {
  const brandId = Number(req.params.brandId);
  if (!Number.isInteger(brandId)) {
    res.status(400).json({ error: "Invalid brand id" });
    return;
  }
  const body = req.body ?? {};
  if (typeof body.name !== "string" || !body.name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (typeof body.objectPath !== "string" || !body.objectPath.startsWith("/objects/")) {
    res.status(400).json({ error: "objectPath is required" });
    return;
  }
  const kind = brandAssetKindValues.includes(body.kind) ? body.kind : "image";
  const [asset] = await db
    .insert(brandAssetsTable)
    .values({
      brandId,
      name: body.name.trim(),
      kind,
      folder: typeof body.folder === "string" && body.folder.trim() ? body.folder.trim() : null,
      objectPath: body.objectPath,
      contentType: body.contentType ?? null,
    })
    .returning();
  res.status(201).json(formatBrandAsset(asset));
});

/**
 * POST /brands/:brandId/assets/import-package  { objectPath, packageName? }
 *
 * Ingest a zipped InDesign package: every usable Links asset lands in the
 * brand library (converted where needed), the document PDF is stored and
 * returned so the client can feed it straight into Recreate-artwork.
 */
router.post("/brands/:brandId/assets/import-package", requireAdmin, async (req, res): Promise<void> => {
  const brandId = Number(req.params.brandId);
  if (!Number.isInteger(brandId)) {
    res.status(400).json({ error: "Invalid brand id" });
    return;
  }
  const objectPath = typeof req.body?.objectPath === "string" ? req.body.objectPath.trim() : "";
  if (!objectPath.startsWith("/objects/")) {
    res.status(400).json({ error: "objectPath is required" });
    return;
  }
  const packageName =
    typeof req.body?.packageName === "string" && req.body.packageName.trim()
      ? req.body.packageName.trim().replace(/\.zip$/i, "").slice(0, 80)
      : "InDesign package";
  try {
    const [brandRow] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
    const result = await importInDesignPackage(objectPath, brandRow?.logoUrl ?? null);
    const folder = `Package — ${packageName}`;
    for (const asset of result.imported) {
      await db.insert(brandAssetsTable).values({
        brandId,
        name: asset.name,
        kind: asset.kind,
        folder,
        objectPath: asset.objectPath,
        contentType: asset.contentType,
      });
    }
    // Stage 2: the IDML layout becomes a fully editable template — the
    // designer's exact text, colours, frames and stacking order.
    let idmlTemplateId: number | null = null;
    let idmlWarnings: string[] = [];
    if (result.idmlLayout) {
      const config = normalizeFreeformConfig({ kind: "freeform", elements: result.idmlLayout.elements });
      const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
      const snapped = brand ? snapConfigToPalette(config, collectBrandPaletteHexes(brand)) : 0;
      idmlWarnings = [...result.idmlLayout.warnings];
      if (snapped > 0) idmlWarnings.push(`${snapped} colour(s) snapped to exact brand values.`);
      const [template] = await db
        .insert(templatesTable)
        .values({
          name: packageName,
          description: `Imported from InDesign package (IDML layout)`,
          category: "custom",
          width: result.idmlLayout.width,
          height: result.idmlLayout.height,
          config: JSON.stringify(config),
          createdBy: (req as any).clerkUserId ?? null,
        })
        .returning();
      idmlTemplateId = template.id;
    } else if (result.idmlError) {
      idmlWarnings = [`IDML could not be parsed: ${result.idmlError}`];
    }

    res.json({
      importedCount: result.imported.length,
      skipped: result.skipped,
      folder,
      documentPdfPath: result.documentPdfPath,
      idmlFound: result.idmlFound,
      fontsSkipped: result.fontsSkipped,
      idmlTemplateId,
      idmlWarnings,
    });
  } catch (err) {
    (req as any).log?.error({ err }, "InDesign package import failed");
    res.status(422).json({ error: "Could not read that package. Is it a zipped InDesign package folder?" });
  }
});

router.delete("/brand-assets/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid asset id" });
    return;
  }
  await db.delete(brandAssetsTable).where(eq(brandAssetsTable.id, id));
  res.status(204).end();
});

export default router;
