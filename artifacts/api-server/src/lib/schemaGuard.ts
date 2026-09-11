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
  // 2026-09-11 campaign layout profiles measured from supplied artwork.
  sql`CREATE TABLE IF NOT EXISTS layout_profiles (
    id serial PRIMARY KEY,
    name text NOT NULL,
    source_key text NOT NULL,
    profile text NOT NULL DEFAULT '{}',
    created_by text,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
  sql`CREATE INDEX IF NOT EXISTS layout_profiles_source_key_idx ON layout_profiles (source_key)`,
  // 2026-09-11 guideline passages by topic, for element-aware checks.
  sql`CREATE TABLE IF NOT EXISTS guideline_passages (
    id serial PRIMARY KEY,
    brand_id integer,
    source text NOT NULL,
    source_asset_id integer,
    topic text NOT NULL,
    heading text NOT NULL DEFAULT '',
    body text NOT NULL,
    ord integer NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  sql`CREATE INDEX IF NOT EXISTS guideline_passages_brand_topic_idx ON guideline_passages (brand_id, topic)`,
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
