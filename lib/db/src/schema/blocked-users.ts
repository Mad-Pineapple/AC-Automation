import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const blockedUsersTable = pgTable("blocked_users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email"),
  name: text("name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type BlockedUser = typeof blockedUsersTable.$inferSelect;
