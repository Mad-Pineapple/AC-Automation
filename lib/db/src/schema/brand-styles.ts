import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";

export const brandStylesTable = pgTable("brand_styles", {
  id: serial("id").primaryKey(),
  brandId: integer("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  cssSnippet: text("css_snippet").notNull(),
  sampleHtml: text("sample_html"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BrandStyle = typeof brandStylesTable.$inferSelect;
export type InsertBrandStyle = typeof brandStylesTable.$inferInsert;
