import { Router } from "express";
import { db } from "@workspace/db";
import { brandsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { optionalAuth, requireAdmin } from "../middlewares/requireAuth";

const router = Router();

function formatBrand(b: typeof brandsTable.$inferSelect) {
  return {
    ...b,
    supportedTemplateSizes: JSON.parse(b.supportedTemplateSizes || '["social_square","story","banner","print_a4","animated_social"]'),
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

router.get("/brands", optionalAuth, async (_req, res): Promise<void> => {
  const brands = await db.select().from(brandsTable).orderBy(brandsTable.id);
  res.json(brands.map(formatBrand));
});

router.post("/brands", requireAdmin, async (req, res): Promise<void> => {
  const body = req.body;
  const sizes = body.supportedTemplateSizes ?? ["social_square", "story", "banner", "print_a4", "animated_social"];
  const [brand] = await db
    .insert(brandsTable)
    .values({
      name: body.name,
      logoUrl: body.logoUrl ?? null,
      primaryColor: body.primaryColor,
      secondaryColor: body.secondaryColor,
      accentColor: body.accentColor,
      backgroundColor: body.backgroundColor,
      textColor: body.textColor,
      fontFamily: body.fontFamily,
      toneOfVoice: body.toneOfVoice,
      guidelines: body.guidelines ?? null,
      industry: body.industry ?? null,
      supportedTemplateSizes: JSON.stringify(sizes),
    })
    .returning();
  res.status(201).json(formatBrand(brand));
});

router.get("/brands/:id", optionalAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, id));
  if (!brand) { res.status(404).json({ error: "Brand not found" }); return; }
  res.json(formatBrand(brand));
});

router.patch("/brands/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const body = req.body;
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.logoUrl !== undefined) updateData.logoUrl = body.logoUrl;
  if (body.primaryColor !== undefined) updateData.primaryColor = body.primaryColor;
  if (body.secondaryColor !== undefined) updateData.secondaryColor = body.secondaryColor;
  if (body.accentColor !== undefined) updateData.accentColor = body.accentColor;
  if (body.backgroundColor !== undefined) updateData.backgroundColor = body.backgroundColor;
  if (body.textColor !== undefined) updateData.textColor = body.textColor;
  if (body.fontFamily !== undefined) updateData.fontFamily = body.fontFamily;
  if (body.toneOfVoice !== undefined) updateData.toneOfVoice = body.toneOfVoice;
  if (body.guidelines !== undefined) updateData.guidelines = body.guidelines;
  if (body.industry !== undefined) updateData.industry = body.industry;
  if (body.supportedTemplateSizes !== undefined) updateData.supportedTemplateSizes = JSON.stringify(body.supportedTemplateSizes);

  const [brand] = await db.update(brandsTable).set(updateData).where(eq(brandsTable.id, id)).returning();
  if (!brand) { res.status(404).json({ error: "Brand not found" }); return; }
  res.json(formatBrand(brand));
});

router.delete("/brands/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  await db.delete(brandsTable).where(eq(brandsTable.id, id));
  res.status(204).send();
});

export default router;
