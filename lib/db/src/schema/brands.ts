import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const brandsTable = pgTable("brands", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color").notNull().default("#FF0046"),
  secondaryColor: text("secondary_color").notNull().default("#005EA7"),
  accentColor: text("accent_color").notNull().default("#FF0046"),
  backgroundColor: text("background_color").notNull().default("#FFFFFF"),
  textColor: text("text_color").notNull().default("#111827"),
  fontFamily: text("font_family").notNull().default("Plus Jakarta Sans"),
  toneOfVoice: text("tone_of_voice").notNull().default("professional"),
  guidelines: text("guidelines"),
  industry: text("industry"),
  supportedTemplateSizes: text("supported_template_sizes").notNull().default('["social_square","story","banner","print_a4","animated_social"]'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBrandSchema = createInsertSchema(brandsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateBrandSchema = insertBrandSchema.partial();

export type Brand = typeof brandsTable.$inferSelect;
export type InsertBrand = z.infer<typeof insertBrandSchema>;
