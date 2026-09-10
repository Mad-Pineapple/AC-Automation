/**
 * Additive schema guard: columns the code relies on that may not exist yet
 * on an older database. Every statement is idempotent (IF NOT EXISTS) and
 * additive, so running it on every boot is safe; `drizzle-kit push` is not
 * used because it also wants to drop legacy tables it does not know about.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const STATEMENTS = [
  // 2026-09-02 recomposer: the master an adapted template was derived from.
  sql`ALTER TABLE templates ADD COLUMN IF NOT EXISTS source_template_id integer`,
];

let done: Promise<void> | null = null;

export function ensureSchemaAdditions(): Promise<void> {
  if (!done) {
    done = (async () => {
      for (const stmt of STATEMENTS) {
        try {
          await db.execute(stmt);
        } catch (err) {
          // A missing column only breaks the adapt route; never block boot.
          console.warn("schema guard statement failed", err instanceof Error ? err.message : err);
        }
      }
    })();
  }
  return done;
}
