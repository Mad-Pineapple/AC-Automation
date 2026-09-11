import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Brand guideline passages indexed by topic (logo, pattern, photography,
 * typography, colour, voice, social …) so a check can read exactly the rules
 * that apply to the elements on a piece. Filled by lib/guidelines.ts from the
 * bundled distilled guidelines, the brand's summary and the guideline PDFs in
 * the library. Created on boot by the schema guard.
 */
export const guidelinePassagesTable = pgTable("guideline_passages", {
  id: serial("id").primaryKey(),
  brandId: integer("brand_id"),
  source: text("source").notNull(),
  sourceAssetId: integer("source_asset_id"),
  topic: text("topic").notNull(),
  heading: text("heading").notNull().default(""),
  body: text("body").notNull(),
  ord: integer("ord").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type GuidelinePassageRow = typeof guidelinePassagesTable.$inferSelect;
