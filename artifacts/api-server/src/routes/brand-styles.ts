import { Router } from "express";
import { db } from "@workspace/db";
import { brandStylesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { extractBrandStyle } from "../lib/openai";
import { requireAuth, optionalAuth } from "../middlewares/requireAuth";

const router = Router();

function formatStyle(s: typeof brandStylesTable.$inferSelect) {
  return {
    ...s,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

router.get("/brands/:id/styles", optionalAuth, async (req, res): Promise<void> => {
  const brandId = Number(req.params.id);
  const styles = await db
    .select()
    .from(brandStylesTable)
    .where(eq(brandStylesTable.brandId, brandId))
    .orderBy(brandStylesTable.id);
  res.json(styles.map(formatStyle));
});

router.post("/brands/:id/styles", requireAuth, async (req, res): Promise<void> => {
  const brandId = Number(req.params.id);
  const body = req.body;

  let name = body.name;
  let description = body.description ?? "";
  let cssSnippet = body.cssSnippet ?? "";

  if (body.html && body.brandName && body.campaignName) {
    try {
      const extracted = await extractBrandStyle({
        html: body.html,
        brandName: body.brandName,
        campaignName: body.campaignName,
      });
      name = name || extracted.name;
      description = description || extracted.description;
      cssSnippet = cssSnippet || extracted.cssSnippet;
    } catch {
    }
  }

  const [style] = await db
    .insert(brandStylesTable)
    .values({
      brandId,
      name: name ?? "Custom Style",
      description,
      cssSnippet,
      sampleHtml: body.html ?? null,
    })
    .returning();

  res.status(201).json(formatStyle(style));
});

router.delete("/brands/:brandId/styles/:styleId", requireAuth, async (req, res): Promise<void> => {
  await db
    .delete(brandStylesTable)
    .where(eq(brandStylesTable.id, Number(req.params.styleId)));
  res.status(204).send();
});

export default router;
