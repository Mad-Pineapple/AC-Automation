/**
 * Approved pieces as the reference for a family.
 *
 * The rule the studio works by: once a designer has corrected one size and
 * marked it Right, that piece — not the generic recipe — is what the other
 * sizes should follow. This module turns that into data:
 *
 *   Exemplar = a template in the family (the master or a piece built from
 *   it) whose latest designer verdict is "correct", with the proportions
 *   measured off its layout: photo share, band share, pill size, lockup
 *   size, headline size and position, message ratio.
 *
 * `chooseReference` picks the exemplar to build a size from — the closest
 * shape in the same format class first — and returns either the exemplar
 * itself (to scale from, when the shapes are near-identical) or the master
 * plus recipe overrides measured from the exemplar (to rebuild with), so a
 * corrected pill size or lockup size on the portrait carries into the wide
 * and the square without anyone re-entering numbers.
 */
import { db, templatesTable } from "@workspace/db";
import { eq, or, sql } from "drizzle-orm";
import { normalizeFreeformConfig, isFreeformConfig, type FreeformConfig } from "./freeform";
import { inferSlots } from "./slots";
import { aspectDistance, classifyAspect, type FormatClass } from "./formatCatalog";
import type { Recipe } from "./recipes";
import { ensureFeedbackTable } from "./feedbackLearning";

export interface Exemplar {
  id: number;
  name: string;
  width: number;
  height: number;
  formatClass: FormatClass;
  config: FreeformConfig;
  /** Recipe fields measured off the approved layout (only the sane ones). */
  measured: Partial<Recipe>;
  approvedAt: string | null;
}

type TemplateRow = typeof templatesTable.$inferSelect;

const inRange = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;

/** Measure the recipe-shaped proportions of a laid-out piece. */
export function measureRecipe(config: FreeformConfig, width: number, height: number): Partial<Recipe> {
  const sem = inferSlots(config, width, height);
  const short = Math.min(width, height);
  const out: Partial<Recipe> = {};
  // The recomposer draws a panel-zone rect over the photo's spill; its edge
  // is the true seam. (The full-canvas ground rect is not it.)
  const zone = config.elements.find(
    (e) => e.type === "rect" && e.slot === "panel" && !(e.w >= width * 0.98 && e.h >= height * 0.98),
  );
  if (sem.photoBox) {
    // A cover-cropped photo element spills under the band and panel, so the
    // visible photo zone ends at the seam (band or panel edge), not at the
    // element's own edge.
    if (sem.axis === "stacked") {
      out.axis = "stacked";
      const bottom = sem.band ? sem.band.y : zone ? zone.y : sem.panelBox ? sem.panelBox.y : sem.photoBox.y + sem.photoBox.h;
      const f = (Math.min(bottom, height) - Math.max(0, sem.photoBox.y)) / height;
      if (inRange(f, 0.3, 0.85)) out.photoFrac = f;
    } else if (sem.axis === "side") {
      out.axis = "side";
      const right = sem.band ? sem.band.x : zone ? zone.x : sem.panelBox ? sem.panelBox.x : sem.photoBox.x + sem.photoBox.w;
      const f = (Math.min(right, width) - Math.max(0, sem.photoBox.x)) / width;
      if (inRange(f, 0.3, 0.8)) out.photoFrac = f;
    }
  }
  if (sem.band) {
    const f = sem.band.h / height;
    if (inRange(f, 0.015, 0.25)) out.bandFrac = f;
  }
  if (sem.cta) {
    const hf = sem.cta.h / short;
    if (inRange(hf, 0.03, 0.4)) {
      out.ctaHeightFrac = hf;
      out.ctaFloorPx = Math.round(sem.cta.h);
    }
    if (sem.panelBox && sem.panelBox.w > 0) {
      const wf = sem.cta.w / sem.panelBox.w;
      if (inRange(wf, 0.15, 0.95)) out.ctaMaxWidthFrac = wf;
    }
  }
  if (sem.lockup) {
    const hf = sem.lockup.h / short;
    if (inRange(hf, 0.04, 0.4)) out.lockupHeightFrac = hf;
    if (sem.panelBox && sem.panelBox.w > 0) {
      const wf = sem.lockup.w / sem.panelBox.w;
      if (inRange(wf, 0.15, 0.95)) out.lockupMaxWidthFrac = wf;
    }
  }
  if (sem.headline && sem.photoBox) {
    const centre = (sem.headline.y + sem.headline.h / 2 - sem.photoBox.y) / Math.max(1, sem.photoBox.h);
    if (inRange(centre, 0.1, 0.9)) {
      out.headlineCentreFrac = centre;
      out.headlineCentreFracBare = centre;
    }
    const hf = (sem.headline.fontSize * 1.1) / Math.max(1, sem.photoBox.h);
    if (inRange(hf, 0.08, 0.8)) out.headlineMaxHeightFrac = hf;
    const wf = sem.headline.w / Math.max(1, sem.photoBox.w);
    if (inRange(wf, 0.4, 1)) out.headlineWidthFrac = wf;
    if (sem.subheadline) {
      const r = sem.subheadline.fontSize / sem.headline.fontSize;
      if (inRange(r, 0.15, 0.6)) out.subheadRatio = r;
    }
    if (sem.message) {
      const r = sem.message.fontSize / sem.headline.fontSize;
      if (inRange(r, 0.12, 0.6)) out.messageMaxRatio = r;
    }
  }
  return out;
}

/** Latest verdict per template in one family. */
async function latestVerdicts(ids: number[]): Promise<Map<number, "correct" | "incorrect">> {
  const m = new Map<number, "correct" | "incorrect">();
  if (ids.length === 0) return m;
  await ensureFeedbackTable();
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (subject_id) subject_id, verdict FROM feedback
    WHERE subject_type = 'template' AND subject_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
    ORDER BY subject_id, id DESC`);
  for (const r of rows.rows as { subject_id: number; verdict: string }[]) {
    if (r.verdict === "correct" || r.verdict === "incorrect") m.set(Number(r.subject_id), r.verdict);
  }
  return m;
}

function parse(row: TemplateRow): FreeformConfig | null {
  try {
    const raw = JSON.parse(row.config || "{}");
    return isFreeformConfig(raw) ? normalizeFreeformConfig(raw) : null;
  } catch {
    return null;
  }
}

/** Every approved piece in the master's family, master included. */
export async function approvedExemplars(masterId: number): Promise<Exemplar[]> {
  const rows = await db
    .select()
    .from(templatesTable)
    .where(or(eq(templatesTable.id, masterId), eq(templatesTable.sourceTemplateId, masterId)));
  const verdicts = await latestVerdicts(rows.map((r) => r.id));
  const out: Exemplar[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    if (verdicts.get(row.id) !== "correct") continue;
    const config = parse(row);
    if (!config) continue;
    seen.add(row.id);
    out.push({
      id: row.id,
      name: row.name,
      width: row.width,
      height: row.height,
      formatClass: classifyAspect(row.width, row.height),
      config,
      measured: measureRecipe(config, row.width, row.height),
      approvedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    });
  }
  // Pieces marked Right and since deleted from WIP still lead: their layout
  // was snapshotted into the feedback row at verdict time.
  for (const r of await rememberedExemplarRows(masterId)) {
    if (seen.has(r.id)) continue;
    out.push(r);
  }
  return out;
}

/** Latest-verdict-Right feedback rows for the family whose template is gone, rebuilt from the stored config. */
async function rememberedExemplarRows(masterId: number): Promise<Exemplar[]> {
  await ensureFeedbackTable();
  const rows = await db.execute(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (subject_id) subject_id, verdict, subject_name, subject_width, subject_height, subject_config, created_at
      FROM feedback
      WHERE subject_type = 'template' AND element_id IS NULL
        AND (subject_id = ${masterId} OR source_template_id = ${masterId})
      ORDER BY subject_id, id DESC
    ) latest
    WHERE verdict = 'correct' AND subject_config IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM templates t WHERE t.id = latest.subject_id)`);
  const out: Exemplar[] = [];
  for (const r of rows.rows as any[]) {
    try {
      const raw = JSON.parse(String(r.subject_config));
      if (!isFreeformConfig(raw)) continue;
      const config = normalizeFreeformConfig(raw);
      const width = Number(r.subject_width);
      const height = Number(r.subject_height);
      if (!width || !height) continue;
      out.push({
        id: Number(r.subject_id),
        name: String(r.subject_name ?? `remembered #${r.subject_id}`),
        width,
        height,
        formatClass: classifyAspect(width, height),
        config,
        measured: measureRecipe(config, width, height),
        approvedAt: r.created_at ? new Date(r.created_at).toISOString() : null,
      });
    } catch {
      // a malformed snapshot never breaks an adapt
    }
  }
  return out;
}

export interface Reference {
  exemplar: Exemplar;
  /** Near-identical shape: scale the exemplar itself. */
  scaleFromExemplar: boolean;
  sameClass: boolean;
  distance: number;
  /** What to tell the reviewer. */
  note: string;
}

/** Shapes closer than this are scaled from the exemplar rather than rebuilt. */
export const EXEMPLAR_SCALE_TOLERANCE = 0.08;

/** The approved piece a size should follow, or null when nothing in the
 * family has been marked Right. Same class first, then closest shape. */
export function chooseReference(exemplars: Exemplar[], width: number, height: number, excludeId?: number): Reference | null {
  const cls = classifyAspect(width, height);
  const candidates = exemplars
    .filter((e) => e.id !== excludeId)
    .map((e) => ({ e, distance: aspectDistance(width, height, e.width, e.height), sameClass: e.formatClass === cls }))
    .sort((a, b) => Number(b.sameClass) - Number(a.sameClass) || a.distance - b.distance);
  const pick = candidates[0];
  if (!pick) return null;
  const scale = pick.distance <= EXEMPLAR_SCALE_TOLERANCE;
  const parts: string[] = [];
  const m = pick.e.measured;
  if (m.photoFrac) parts.push(`photo ${Math.round(m.photoFrac * 100)}%`);
  if (m.ctaHeightFrac) parts.push(`pill ${Math.round(m.ctaHeightFrac * 100)}% of short axis`);
  if (m.lockupHeightFrac) parts.push(`lockup ${Math.round(m.lockupHeightFrac * 100)}%`);
  if (m.headlineCentreFrac) parts.push(`headline at ${Math.round(m.headlineCentreFrac * 100)}% of the photo`);
  const note = scale
    ? `Scaled from the approved "${pick.e.name}" (${pick.e.width}×${pick.e.height}).`
    : `Follows the approved "${pick.e.name}" (${pick.e.width}×${pick.e.height})${parts.length ? `: ${parts.join(", ")}` : ""}.`;
  return { exemplar: pick.e, scaleFromExemplar: scale, sameClass: pick.sameClass, distance: pick.distance, note };
}


/**
 * Right pieces from anywhere in the studio (any family), nearest shape first:
 * templates whose latest whole-piece verdict is Right, plus Knowledge copies
 * remembered from Right pieces. What the studio has already accepted for a
 * shape is the standard every new piece of that shape is measured against.
 */
export interface ExemplarScope {
  /** Only pieces from these masters (the masters themselves, or pieces built from them). */
  familyIds?: number[];
  /** Or pieces whose name contains one of these terms (case-insensitive). */
  nameTerms?: string[];
}

export async function studioExemplars(width: number, height: number, excludeIds: number[] = [], limit = 3, scope: ExemplarScope = {}): Promise<Exemplar[]> {
  await ensureFeedbackTable();
  const cls = classifyAspect(width, height);
  const familyIds = (scope.familyIds ?? []).filter((n) => Number.isInteger(n) && n > 0);
  const nameTerms = (scope.nameTerms ?? []).map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 3);
  const scoped = familyIds.length > 0 || nameTerms.length > 0;
  // A campaign's references are its own: another campaign's Right pieces
  // describe another layout. When a scope is given, only pieces inside it
  // count; if it has none yet, the schema/profile is the standard.
  const scopeSql = scoped
    ? sql`AND (
        ${familyIds.length ? sql`t.id IN (${sql.join(familyIds.map((i) => sql`${i}`), sql`, `)}) OR t.source_template_id IN (${sql.join(familyIds.map((i) => sql`${i}`), sql`, `)})` : sql`false`}
        ${nameTerms.length ? sql`OR (${sql.join(nameTerms.map((term) => sql`lower(t.name) LIKE ${"%" + term + "%"}`), sql` OR `)})` : sql``}
      )`
    : sql``;
  const rows = await db.execute(sql`
    SELECT t.id, t.name, t.width, t.height, t.config, t.updated_at
    FROM templates t
    WHERE (
      t.id IN (
        SELECT subject_id FROM (
          SELECT DISTINCT ON (subject_id) subject_id, verdict FROM feedback
          WHERE subject_type = 'template' AND element_id IS NULL
          ORDER BY subject_id, id DESC
        ) latest WHERE verdict = 'correct'
      )
      OR (t.category = 'knowledge' AND (t.config::json ->> 'learnedFromTemplateId') IS NOT NULL)
    )
    ${excludeIds.length ? sql`AND t.id NOT IN (${sql.join(excludeIds.map((i) => sql`${i}`), sql`, `)})` : sql``}
    ${scopeSql}
    ORDER BY t.updated_at DESC, t.id DESC
    LIMIT 400`);
  const out: Array<Exemplar & { distance: number; sameClass: boolean }> = [];
  for (const r of rows.rows as any[]) {
    let config: FreeformConfig | null = null;
    try {
      const raw = JSON.parse(String(r.config || "{}"));
      config = isFreeformConfig(raw) ? normalizeFreeformConfig(raw) : null;
    } catch {
      config = null;
    }
    if (!config) continue;
    const w = Number(r.width), h = Number(r.height);
    out.push({
      id: Number(r.id),
      name: String(r.name),
      width: w,
      height: h,
      formatClass: classifyAspect(w, h),
      config,
      measured: measureRecipe(config, w, h),
      approvedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      distance: aspectDistance(width, height, w, h),
      sameClass: classifyAspect(w, h) === cls,
    });
  }
  out.sort((a, b) => (Number(b.sameClass) - Number(a.sameClass)) || a.distance - b.distance || (b.approvedAt ?? "").localeCompare(a.approvedAt ?? ""));
  return out.slice(0, limit).map(({ distance: _d, sameClass: _s, ...e }) => e);
}
