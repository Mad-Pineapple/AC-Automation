import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Campaign layout profiles measured from supplied artwork (lib/layoutProfile
 * in the API server). `source_key` is the sorted, comma-joined list of the
 * master template ids the profile was measured from; `profile` is the JSON
 * LayoutProfile. Created on boot by the schema guard (CREATE TABLE IF NOT
 * EXISTS) so older databases pick it up without a migration.
 */
export const layoutProfilesTable = pgTable("layout_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sourceKey: text("source_key").notNull(),
  profile: text("profile").notNull().default("{}"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type LayoutProfileRow = typeof layoutProfilesTable.$inferSelect;
