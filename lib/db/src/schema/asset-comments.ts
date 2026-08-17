import { pgTable, serial, integer, text, timestamp, real } from "drizzle-orm/pg-core";
import { assetsTable } from "./assets";
import { usersTable } from "./users";

// Review comments pinned to a single asset. pinX/pinY are fractions (0..1)
// of the rendered artwork so pins land in the same spot at any display size;
// both null means a general (unpinned) comment.
export const assetCommentsTable = pgTable("asset_comments", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id")
    .notNull()
    .references(() => assetsTable.id, { onDelete: "cascade" }),
  authorId: integer("author_id").references(() => usersTable.id, { onDelete: "set null" }),
  authorName: text("author_name"),
  body: text("body").notNull(),
  pinX: real("pin_x"),
  pinY: real("pin_y"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AssetComment = typeof assetCommentsTable.$inferSelect;
