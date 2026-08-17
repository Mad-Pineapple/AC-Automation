import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { brandsTable } from "./brands";

export const briefStatusValues = ["draft", "generating", "pending_approval", "approved", "scheduled", "dispatched"] as const;
export type BriefStatus = typeof briefStatusValues[number];

export const briefsTable = pgTable("briefs", {
  id: serial("id").primaryKey(),
  campaignName: text("campaign_name").notNull(),
  headline: text("headline"),
  bodyText: text("body_text"),
  callToAction: text("call_to_action"),
  // Free-text campaign context distilled from the uploaded brief document
  // (objective, audience, key messages, mandatories). Threaded into every AI
  // generation prompt so copy/artwork reflect the actual brief, not just its name.
  notes: text("notes"),
  // JSON array of variant rows ({label, headline, bodyText, callToAction});
  // generation renders artwork once per size, then one asset per row with
  // row-specific copy (feed-driven batch variants).
  variants: text("variants"),
  productImageUrl: text("product_image_url"),
  templateSizes: text("template_sizes").notNull().default("[]"),
  useAiCopy: boolean("use_ai_copy").notNull().default(false),
  brandId: integer("brand_id").notNull().references(() => brandsTable.id),
  campaignId: integer("campaign_id"),
  status: text("status").notNull().default("draft"),
  dispatchLog: text("dispatch_log"),
  scheduledAt: timestamp("scheduled_at"),
  scheduledMethods: text("scheduled_methods"),
  createdBy: text("created_by"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  dispatchedBy: text("dispatched_by"),
  dispatchedAt: timestamp("dispatched_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBriefSchema = createInsertSchema(briefsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  dispatchLog: true,
});

export const updateBriefSchema = insertBriefSchema.partial();

export type Brief = typeof briefsTable.$inferSelect;
export type InsertBrief = z.infer<typeof insertBriefSchema>;
