import { Router } from "express";
import { db } from "@workspace/db";
import { templatesTable, assetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { optionalAuth, requireAdmin } from "../middlewares/requireAuth";
import { normalizeFreeformConfig } from "../lib/freeform";
import { dissectPdfToTemplate } from "../lib/pdfDissect";
import { dissectImageToTemplate } from "../lib/imageDissect";

const router = Router();

const DEFAULT_CONFIG = {
  contentAlignment: "center",
  textAlign: "left",
  showAccentBar: true,
  showLogoBar: true,
  imageStyle: "side",
};

function validatePayload(body: any, partial: boolean): string | null {
  const required = !partial;
  if ((required || body.name !== undefined) && (typeof body.name !== "string" || !body.name.trim())) {
    return "name is required";
  }
  for (const dim of ["width", "height"] as const) {
    if (required || body[dim] !== undefined) {
      const n = Number(body[dim]);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 16 || n > 8000) {
        return `${dim} must be an integer between 16 and 8000`;
      }
    }
  }
  return null;
}

function parseConfig(raw: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (parsed && parsed.kind === "freeform") return normalizeFreeformConfig(parsed) as unknown as Record<string, unknown>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function formatTemplate(t: typeof templatesTable.$inferSelect) {
  return {
    id: t.id,
    key: `tpl_${t.id}`,
    name: t.name,
    description: t.description,
    category: t.category,
    width: t.width,
    height: t.height,
    dims: `${t.width}\u00d7${t.height}`,
    config: parseConfig(t.config),
    sourceImageUrl: t.sourceImageUrl,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

router.get("/templates", optionalAuth, async (_req, res): Promise<void> => {
  const templates = await db.select().from(templatesTable).orderBy(templatesTable.id);
  res.json(templates.map(formatTemplate));
});

router.post("/templates", requireAdmin, async (req, res): Promise<void> => {
  const body = req.body;
  const error = validatePayload(body, false);
  if (error) { res.status(400).json({ error }); return; }
  const config =
    body.config?.kind === "freeform"
      ? normalizeFreeformConfig(body.config)
      : { ...DEFAULT_CONFIG, ...(body.config ?? {}) };
  const [template] = await db
    .insert(templatesTable)
    .values({
      name: body.name,
      description: body.description ?? null,
      category: body.category ?? "custom",
      width: Number(body.width),
      height: Number(body.height),
      config: JSON.stringify(config),
      sourceImageUrl: typeof body.sourceImageUrl === "string" ? body.sourceImageUrl : null,
      createdBy: (req as any).clerkUserId ?? null,
    })
    .returning();
  res.status(201).json(formatTemplate(template));
});

router.post("/templates/dissect-pdf", requireAdmin, async (req, res): Promise<void> => {
  const objectPath = typeof req.body?.objectPath === "string" ? req.body.objectPath.trim() : "";
  if (!objectPath) { res.status(400).json({ error: "objectPath is required" }); return; }
  const page = Number.isInteger(req.body?.page) && req.body.page >= 1 ? req.body.page : 1;
  try {
    const result = await dissectPdfToTemplate(objectPath, page);
    res.json(result);
  } catch (err) {
    (req as any).log?.error({ err }, "PDF dissection failed");
    res.status(422).json({ error: "Could not read that PDF. It may be encrypted, corrupted, or unsupported." });
  }
});

router.post("/templates/dissect-image", requireAdmin, async (req, res): Promise<void> => {
  const objectPath = typeof req.body?.objectPath === "string" ? req.body.objectPath.trim() : "";
  if (!objectPath) { res.status(400).json({ error: "objectPath is required" }); return; }
  try {
    const result = await dissectImageToTemplate(objectPath);
    res.json(result);
  } catch (err) {
    (req as any).log?.error({ err }, "Image dissection failed");
    res.status(422).json({ error: "Could not learn that image. It may be corrupted or in an unsupported format." });
  }
});

router.get("/templates/:id", optionalAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [template] = await db.select().from(templatesTable).where(eq(templatesTable.id, id));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(formatTemplate(template));
});

router.patch("/templates/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const body = req.body;
  const error = validatePayload(body, true);
  if (error) { res.status(400).json({ error }); return; }
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.category !== undefined) updateData.category = body.category;
  if (body.width !== undefined) updateData.width = Number(body.width);
  if (body.height !== undefined) updateData.height = Number(body.height);
  if (body.sourceImageUrl !== undefined) updateData.sourceImageUrl = body.sourceImageUrl;
  if (body.config !== undefined)
    updateData.config =
      body.config?.kind === "freeform"
        ? JSON.stringify(normalizeFreeformConfig(body.config))
        : JSON.stringify({ ...DEFAULT_CONFIG, ...body.config });

  const [template] = await db.update(templatesTable).set(updateData).where(eq(templatesTable.id, id)).returning();
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(formatTemplate(template));
});

router.delete("/templates/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const referencing = await db
    .select({ id: assetsTable.id })
    .from(assetsTable)
    .where(eq(assetsTable.templateSize, `tpl_${id}`))
    .limit(1);
  if (referencing.length > 0) {
    res.status(409).json({ error: "This template is in use by existing assets and cannot be deleted." });
    return;
  }
  await db.delete(templatesTable).where(eq(templatesTable.id, id));
  res.status(204).end();
});

export default router;
