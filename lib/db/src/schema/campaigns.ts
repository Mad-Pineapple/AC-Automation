import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { brandsTable } from "./brands";

export const campaignStatusValues = ["planning", "active", "completed", "archived"] as const;
export type CampaignStatus = typeof campaignStatusValues[number];

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  brandId: integer("brand_id").references(() => brandsTable.id, { onDelete: "set null" }),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  status: text("status").notNull().default("planning"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
});

export const updateCampaignSchema = insertCampaignSchema.partial();

export type Campaign = typeof campaignsTable.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
