import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { briefsTable } from "./briefs";
import { usersTable } from "./users";

// Tracks which assets a given user has reviewed (previewed) for a brief, so
// review progress is stored on the server and is therefore device-independent
// and shareable, rather than living only in one browser's localStorage.
export const reviewProgressTable = pgTable(
  "review_progress",
  {
    id: serial("id").primaryKey(),
    briefId: integer("brief_id")
      .notNull()
      .references(() => briefsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // JSON-stringified array of asset ids the user has reviewed, matching the
    // text-encoded array convention used elsewhere in the schema.
    reviewedAssetIds: text("reviewed_asset_ids").notNull().default("[]"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    briefUserUnique: unique("review_progress_brief_user_unique").on(table.briefId, table.userId),
  }),
);

export type ReviewProgress = typeof reviewProgressTable.$inferSelect;
