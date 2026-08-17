import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { briefsTable } from "./briefs";

// External share links: a possession-is-authorization token (same model as
// ad_tags.token) that exposes a read-only gallery of one brief's assets to
// stakeholders without an account, plus expiry and revocation on top.
export const shareLinksTable = pgTable("share_links", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  briefId: integer("brief_id")
    .notNull()
    .references(() => briefsTable.id, { onDelete: "cascade" }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
});

export type ShareLink = typeof shareLinksTable.$inferSelect;
