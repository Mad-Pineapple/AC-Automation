import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { assetsTable } from "./assets";
import { usersTable } from "./users";

// Notes attached to a comparison of two assets. The pair is stored normalized
// (low/high) so a note added on the A,B comparison is also visible on B,A.
export const comparisonNotesTable = pgTable("comparison_notes", {
  id: serial("id").primaryKey(),
  assetIdLow: integer("asset_id_low")
    .notNull()
    .references(() => assetsTable.id, { onDelete: "cascade" }),
  assetIdHigh: integer("asset_id_high")
    .notNull()
    .references(() => assetsTable.id, { onDelete: "cascade" }),
  authorId: integer("author_id").references(() => usersTable.id, { onDelete: "set null" }),
  authorName: text("author_name"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ComparisonNote = typeof comparisonNotesTable.$inferSelect;
