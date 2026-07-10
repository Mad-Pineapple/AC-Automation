import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { brandsTable } from "./brands";

export const brandAssetKindValues = ["logo", "image", "file"] as const;
export type BrandAssetKind = typeof brandAssetKindValues[number];

export const brandAssetsTable = pgTable("brand_assets", {
  id: serial("id").primaryKey(),
  brandId: integer("brand_id")
    .notNull()
    .references(() => brandsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("image"),
  folder: text("folder"),
  objectPath: text("object_path").notNull(),
  contentType: text("content_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBrandAssetSchema = createInsertSchema(brandAssetsTable).omit({
  id: true,
  createdAt: true,
});

export type BrandAsset = typeof brandAssetsTable.$inferSelect;
export type InsertBrandAsset = z.infer<typeof insertBrandAssetSchema>;
