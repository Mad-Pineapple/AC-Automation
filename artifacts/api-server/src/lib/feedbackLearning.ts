/**
 * Designer feedback as a learning signal for adaptation.
 *
 * Reviewers mark pieces Right or Wrong (routes/feedback.ts). Those verdicts
 * are only useful if they outlive the piece — WIP gets cleared — and if the
 * engines can see them. So:
 *
 *  - every feedback row snapshots what it was about (size, format class,
 *    adapt method, master) at insert time, and older rows are back-filled
 *    while their template still exists;
 *  - `feedbackForFormat` summarises verdicts and notes per format class so
 *    the adapt route can put "designers marked 6 right / 2 wrong, notes: …"
 *    on every new piece of that class and flag it for review when the class
 *    is more wrong than right;
 *  - the generation pipeline keeps reading recent incorrect notes into its
 *    prompts (recentIncorrectNotes).
 *
 * Recipe numbers are NOT changed automatically from feedback: a person reads
 * the notes and tunes lib/recipes.ts, so a mistaken thumbs-down can't silently
 * move the whole system.
 */
import { db } from "@workspace/db";
import { isFreeformConfig, normalizeFreeformConfig, type FreeformConfig } from "./freeform";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { classifyAspect, type FormatClass } from "./formatCatalog";

let ensured: Promise<void> | null = null;

/** Create the table and its snapshot columns; back-fill rows that predate
 * the snapshot while their template still exists. Idempotent. */
export function ensureFeedbackTable(): Promise<void> {
  ensured ??= (async () => {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS feedback (
      id serial PRIMARY KEY,
      subject_type text NOT NULL,
      subject_id integer NOT NULL,
      verdict text NOT NULL,
      element_id text,
      element_label text,
      note text,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const col of [
      "element_id text",
      "element_label text",
      "subject_name text",
      "subject_width integer",
      "subject_height integer",
      "format_class text",
      "adapt_method text",
      "source_template_id integer",
      // Structured Wrong (2026-09-08): which part, what fault, what was expected.
      "element_slot text",
      "fault text",
      "expected text",
      "severity text",
      // Remembered layout (2026-09-09): the full freeform config at verdict
      // time, so a piece marked Right keeps teaching after WIP is cleared.
      "subject_config text",
    ]) {
      await db.execute(sql.raw(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS ${col}`));
    }
    // Back-fill snapshots from templates that still exist.
    await db.execute(sql`
      UPDATE feedback f SET
        subject_name = t.name,
        subject_width = t.width,
        subject_height = t.height,
        adapt_method = COALESCE((t.config::json ->> 'adaptMethod'), CASE WHEN t.source_template_id IS NULL THEN 'import' ELSE 'adapted' END),
        source_template_id = t.source_template_id
      FROM templates t
      WHERE f.subject_type = 'template' AND f.subject_id = t.id AND f.subject_width IS NULL`);
    const rows = await db.execute(sql`SELECT id, subject_width, subject_height FROM feedback WHERE format_class IS NULL AND subject_width IS NOT NULL`);
    for (const r of rows.rows as { id: number; subject_width: number; subject_height: number }[]) {
      await db.execute(sql`UPDATE feedback SET format_class = ${classifyAspect(r.subject_width, r.subject_height)} WHERE id = ${r.id}`);
    }
  })().catch((err) => {
    ensured = null;
    throw err;
  });
  return ensured;
}

export interface FeedbackSnapshot {
  subjectName: string | null;
  width: number | null;
  height: number | null;
  formatClass: FormatClass | null;
  adaptMethod: string | null;
  sourceTemplateId: number | null;
}

/** What a feedback row should remember about a template. */
export async function snapshotTemplate(id: number): Promise<FeedbackSnapshot> {
  const rows = await db.execute(sql`SELECT name, width, height, config, source_template_id FROM templates WHERE id = ${id}`);
  const t = (rows.rows as any[])[0];
  if (!t) return { subjectName: null, width: null, height: null, formatClass: null, adaptMethod: null, sourceTemplateId: null };
  let method: string | null = null;
  try {
    method = (JSON.parse(t.config) as { adaptMethod?: string }).adaptMethod ?? null;
  } catch {
    method = null;
  }
  return {
    subjectName: t.name,
    width: t.width,
    height: t.height,
    formatClass: classifyAspect(t.width, t.height),
    adaptMethod: method ?? (t.source_template_id == null ? "import" : "adapted"),
    sourceTemplateId: t.source_template_id ?? null,
  };
}

export interface FormatFeedback {
  formatClass: FormatClass;
  correct: number;
  incorrect: number;
  /** Incorrect notes, newest first, with the size they were about. */
  notes: string[];
}

const cache = new Map<string, { at: number; value: FormatFeedback }>();
const CACHE_MS = 60_000;

/** Verdict counts and incorrect notes for adapted pieces of a format class.
 * Imports are excluded: a thumbs-down on an imported master is about the
 * import, not about how the class is rebuilt. */
export async function feedbackForFormat(formatClass: FormatClass): Promise<FormatFeedback> {
  const hit = cache.get(formatClass);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  await ensureFeedbackTable();
  const rows = await db.execute(sql`
    SELECT verdict, note, element_label, element_slot, fault, expected, subject_width, subject_height
    FROM feedback
    WHERE subject_type = 'template' AND format_class = ${formatClass}
      AND adapt_method IS NOT NULL AND adapt_method <> 'import'
    ORDER BY id DESC LIMIT 200`);
  const value: FormatFeedback = { formatClass, correct: 0, incorrect: 0, notes: [] };
  for (const r of rows.rows as any[]) {
    if (r.verdict === "correct") value.correct++;
    else if (r.verdict === "incorrect") value.incorrect++;
    if (r.verdict === "incorrect" && (r.note || r.fault) && value.notes.length < 6) {
      const size = r.subject_width && r.subject_height ? ` (${r.subject_width}×${r.subject_height})` : "";
      const part = r.element_slot ? `[${r.element_slot}] ` : r.element_label ? `[${r.element_label}] ` : "";
      const structured = r.fault ? `${String(r.fault).replace(/_/g, " ")}${r.expected ? ` — expected ${String(r.expected).trim()}` : ""}` : "";
      const free = r.note ? String(r.note).trim() : "";
      value.notes.push(`${part}${[structured, free].filter(Boolean).join("; ")}${size}`);
    }
  }
  cache.set(formatClass, { at: Date.now(), value });
  return value;
}

/** Human line for adaptNotes, or null when designers have said nothing. */
export function describeFormatFeedback(fb: FormatFeedback): string | null {
  if (fb.correct + fb.incorrect === 0) return null;
  const head = `Designer feedback on ${fb.formatClass} formats: ${fb.correct} right, ${fb.incorrect} wrong.`;
  return fb.notes.length > 0 ? `${head} Wrong because: ${fb.notes.join("; ")}` : head;
}


// ---------------------------------------------------------------------------
// Remembering a Right piece

/** Full config snapshot for the feedback row (null when not a freeform template). */
export async function snapshotTemplateConfig(id: number): Promise<string | null> {
  const rows = await db.execute(sql`SELECT config FROM templates WHERE id = ${id}`);
  const t = (rows.rows as any[])[0];
  if (!t?.config) return null;
  try {
    const raw = JSON.parse(t.config);
    return isFreeformConfig(raw) ? JSON.stringify(normalizeFreeformConfig(raw)) : null;
  } catch {
    return null;
  }
}

export interface RememberOptions {
  /** Renders the piece to a PNG for the Knowledge card; failures leave the card imageless. */
  renderPreview?: (config: FreeformConfig, width: number, height: number) => Promise<Buffer | null>;
  uploadBytes?: (buffer: Buffer, contentType: string) => Promise<string>;
  userId?: string | null;
}

/**
 * File a piece marked Right into Knowledge as a learned creative (category
 * "knowledge", config tagged with `learnedFromTemplateId`), so it is
 * remembered and selectable in briefs even after the WIP piece is deleted.
 * Idempotent: a second Right on the same piece refreshes the existing copy.
 * Returns the Knowledge template id, or null when the piece isn't freeform.
 */
export async function rememberRightPiece(templateId: number, opts: RememberOptions = {}): Promise<number | null> {
  const rows = await db.execute(sql`SELECT id, name, width, height, config, category, source_template_id FROM templates WHERE id = ${templateId}`);
  const t = (rows.rows as any[])[0];
  if (!t) return null;
  if (t.category === "knowledge") return Number(t.id); // already a learned creative
  let config: FreeformConfig;
  try {
    const raw = JSON.parse(t.config || "{}");
    if (!isFreeformConfig(raw)) return null;
    config = normalizeFreeformConfig(raw);
  } catch {
    return null;
  }
  const tagged = { ...config, learnedFromTemplateId: Number(t.id), learnedAt: new Date().toISOString() };
  const width = Number(t.width);
  const height = Number(t.height);

  let sourceImageUrl: string | null = null;
  if (opts.renderPreview && opts.uploadBytes) {
    try {
      const png = await opts.renderPreview(config, width, height);
      if (png && png.length > 0) {
        const objectPath = await opts.uploadBytes(png, "image/png");
        sourceImageUrl = `/api/storage${objectPath}`;
      }
    } catch (err) {
      logger.warn({ err, templateId }, "Right piece: preview render failed; Knowledge card will have no image");
    }
  }

  const name = String(t.name).slice(0, 120);
  const description = `Marked Right on ${new Date().toISOString().slice(0, 10)} · remembered from Work in progress`;
  const existing = await db.execute(sql`SELECT id FROM templates
    WHERE category = 'knowledge' AND (config::json ->> 'learnedFromTemplateId')::int = ${Number(t.id)} LIMIT 1`);
  const found = (existing.rows as any[])[0];
  if (found) {
    await db.execute(sql`UPDATE templates SET name = ${name}, description = ${description}, width = ${width}, height = ${height},
      config = ${JSON.stringify(tagged)}, source_image_url = COALESCE(${sourceImageUrl}, source_image_url), updated_at = now()
      WHERE id = ${Number(found.id)}`);
    return Number(found.id);
  }
  const inserted = await db.execute(sql`INSERT INTO templates (name, description, category, width, height, config, source_image_url, created_by)
    VALUES (${name}, ${description}, 'knowledge', ${width}, ${height}, ${JSON.stringify(tagged)}, ${sourceImageUrl}, ${opts.userId ?? null})
    RETURNING id`);
  const id = Number((inserted.rows as any[])[0]?.id);
  logger.info({ templateId, knowledgeId: id }, "Right piece remembered in Knowledge");
  return id;
}

/** A later Wrong retracts the Knowledge copy made by rememberRightPiece. */
export async function forgetRightPiece(templateId: number): Promise<number> {
  const res = await db.execute(sql`DELETE FROM templates
    WHERE category = 'knowledge' AND (config::json ->> 'learnedFromTemplateId')::int = ${templateId}`);
  return Number((res as any).rowCount ?? 0);
}

/**
 * One-off catch-up for verdicts given before layouts were remembered: every
 * piece whose latest whole-piece verdict is Right and which still exists gets
 * its layout snapshotted into the feedback row and a Knowledge copy filed.
 * Idempotent; pieces already deleted can't be recovered (their size/method
 * lessons remain).
 */
export async function backfillRememberedRights(opts: RememberOptions = {}): Promise<{ candidates: number; snapshotted: number; remembered: number }> {
  await ensureFeedbackTable();
  const rows = await db.execute(sql`
    SELECT latest.id AS feedback_id, latest.subject_id, latest.subject_config IS NULL AS needs_snapshot
    FROM (
      SELECT DISTINCT ON (subject_id) id, subject_id, verdict, subject_config
      FROM feedback WHERE subject_type = 'template' AND element_id IS NULL
      ORDER BY subject_id, id DESC
    ) latest
    JOIN templates t ON t.id = latest.subject_id AND t.category <> 'knowledge'
    WHERE latest.verdict = 'correct'`);
  const out = { candidates: 0, snapshotted: 0, remembered: 0 };
  for (const r of rows.rows as any[]) {
    out.candidates += 1;
    const templateId = Number(r.subject_id);
    try {
      if (r.needs_snapshot) {
        const cfg = await snapshotTemplateConfig(templateId);
        if (cfg) {
          await db.execute(sql`UPDATE feedback SET subject_config = ${cfg} WHERE id = ${Number(r.feedback_id)}`);
          out.snapshotted += 1;
        }
      }
      const existing = await db.execute(sql`SELECT 1 FROM templates
        WHERE category = 'knowledge' AND (config::json ->> 'learnedFromTemplateId')::int = ${templateId} LIMIT 1`);
      if ((existing.rows as any[]).length === 0) {
        const id = await rememberRightPiece(templateId, opts);
        if (id) out.remembered += 1;
      }
    } catch (err) {
      logger.warn({ err, templateId }, "backfill: could not remember Right piece");
    }
  }
  if (out.snapshotted || out.remembered) logger.info(out, "Right verdicts backfilled into Knowledge");
  return out;
}
