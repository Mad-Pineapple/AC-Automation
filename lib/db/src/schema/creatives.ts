import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { templatesTable } from "./templates";

/**
 * Exported HTML5 creatives: every package the exporter produces is registered
 * here with a unique token, so the banner can report events back and the
 * Performance view can break results down by campaign / format / variant /
 * layout option.
 */
export const creativesTable = pgTable("creatives", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").references(() => templatesTable.id, { onDelete: "set null" }),
  token: text("token").notNull().unique(),
  name: text("name").notNull(),
  campaign: text("campaign"),
  format: text("format").notNull(), // "728x90"
  variant: text("variant"),
  layoutLabel: text("layout_label"),
  clickUrl: text("click_url"),
  fluid: boolean("fluid").notNull().default(false),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const creativeEventTypeValues = ["impression", "viewable", "interaction", "click"] as const;
export type CreativeEventType = (typeof creativeEventTypeValues)[number];

export const creativeEventsTable = pgTable("creative_events", {
  id: serial("id").primaryKey(),
  creativeId: integer("creative_id").notNull().references(() => creativesTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  /** Milliseconds the creative was ≥50% in view (viewable events). */
  viewMs: integer("view_ms"),
  /** Which dynamic variant rendered (from URL params), if any. */
  dynamicKey: text("dynamic_key"),
  referrer: text("referrer"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Creative = typeof creativesTable.$inferSelect;
export type CreativeEvent = typeof creativeEventsTable.$inferSelect;
