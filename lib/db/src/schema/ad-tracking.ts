import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { assetsTable } from "./assets";

export const adEventTypeValues = ["impression", "click"] as const;
export type AdEventType = typeof adEventTypeValues[number];

export const adTagsTable = pgTable("ad_tags", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assetsTable.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  clickUrl: text("click_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const adEventsTable = pgTable("ad_events", {
  id: serial("id").primaryKey(),
  adTagId: integer("ad_tag_id").notNull().references(() => adTagsTable.id, { onDelete: "cascade" }),
  assetId: integer("asset_id").notNull().references(() => assetsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  referrer: text("referrer"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AdTag = typeof adTagsTable.$inferSelect;
export type AdEvent = typeof adEventsTable.$inferSelect;
