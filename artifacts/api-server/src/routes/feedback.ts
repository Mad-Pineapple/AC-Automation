import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, optionalAuth, requireAdmin } from "../middlewares/requireAuth";

const router = Router();

/**
 * Reviewer feedback: a thumbs up/down on any piece the studio produced or
 * imported (WIP artwork, templates, generated assets), with an optional note
 * saying what's wrong. The notes are the learning signal — the generation
 * pipeline reads recent "incorrect" notes back into its prompts so flagged
 * problems aren't repeated.
 *
 * The table is created lazily so the same code works on the local Postgres
 * and on Neon (where we can't run migrations by hand).
 */
import { ensureFeedbackTable, snapshotTemplate, snapshotTemplateConfig, rememberRightPiece, forgetRightPiece, backfillRememberedRights } from "../lib/feedbackLearning";
import { renderFreeformToPng } from "../lib/renderFreeform";
import { ObjectStorageService } from "../lib/objectStorage";
import { makeImageLoader } from "./exports";
import { profileForMaster, updateProfileRules } from "../lib/layoutProfile";
import { PART_RULE_SLOTS, type PartRuleSlot } from "../lib/styleSpecs/getReadyBurst2";
import { templatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { normalizeFreeformConfig, isFreeformConfig } from "../lib/freeform";
import { inferSlots } from "../lib/slots";
import { describeConstraints, type LiquidConstraints } from "../lib/liquid";

const ensureTable = ensureFeedbackTable;

/** Remember options built from a real request (needed for the preview renderer's image loader). */
function rememberOptionsFor(req: any) {
  const storage = new ObjectStorageService();
  const loadImage = makeImageLoader(req);
  return {
    renderPreview: (config: any, width: number, height: number) => renderFreeformToPng(config, width, height, { scale: 1, loadImage }),
    uploadBytes: (buffer: Buffer, contentType: string) => storage.uploadBytes(buffer, contentType),
    userId: req.clerkUserId ?? null,
  };
}

// Verdicts given before layouts were remembered are caught up once per
// process, on the first verdict after deploy (or on demand, below).
let backfillPromise: Promise<unknown> | null = null;
function backfillOnce(req: any): Promise<unknown> {
  backfillPromise ??= backfillRememberedRights(rememberOptionsFor(req)).catch((err) => {
    req.log?.warn?.({ err }, "feedback: backfill of remembered Right pieces failed");
  });
  return backfillPromise;
}

const SUBJECT_TYPES = new Set(["template", "asset"]);
const VERDICTS = new Set(["correct", "incorrect"]);
/** Structured Wrong: the part of the piece and the kind of fault. */
export const FEEDBACK_ELEMENTS = ["photo", "headline", "subheadline", "message", "cta", "band", "panel", "lockup", "logo", "copy", "whole"] as const;
export const FEEDBACK_FAULTS = [
  "too_big", "too_small", "wrong_position", "cut_off", "missing", "illegible", "wrong_style", "off_brand_colour_or_font", "wrong_crop", "other",
] as const;
export const FEEDBACK_SEVERITIES = ["send_back", "fix_next_time"] as const;

router.post("/feedback", requireAuth, async (req, res): Promise<void> => {
  const { subjectType, subjectId, verdict, note, elementId, elementLabel, elementSlot, fault, expected, severity } = req.body ?? {};
  if (!SUBJECT_TYPES.has(subjectType) || !VERDICTS.has(verdict) || !Number.isInteger(subjectId)) {
    res.status(400).json({ error: "subjectType, integer subjectId and verdict (correct|incorrect) are required" });
    return;
  }
  const cleanNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 1000) : null;
  const elId = typeof elementId === "string" && elementId.trim() ? elementId.trim().slice(0, 100) : null;
  const elLabel = typeof elementLabel === "string" && elementLabel.trim() ? elementLabel.trim().slice(0, 200) : null;
  const slot = typeof elementSlot === "string" && (FEEDBACK_ELEMENTS as readonly string[]).includes(elementSlot) ? elementSlot : null;
  const faultV = typeof fault === "string" && (FEEDBACK_FAULTS as readonly string[]).includes(fault) ? fault : null;
  const expectedV = typeof expected === "string" && expected.trim() ? expected.trim().slice(0, 200) : null;
  const severityV = typeof severity === "string" && (FEEDBACK_SEVERITIES as readonly string[]).includes(severity) ? severity : null;
  // A Wrong with no reason teaches nothing (19 of the first 27 had none).
  // The form has required a fault since 8 Sept; the server now agrees.
  if (verdict === "incorrect" && !faultV && !cleanNote) {
    res.status(400).json({ error: "Say what is wrong: pick a fault or write a note." });
    return;
  }
  await ensureTable();
  // Snapshot what the verdict is about so it still teaches after the piece
  // is deleted (WIP gets cleared; the lesson must not go with it).
  const snap = subjectType === "template"
    ? await snapshotTemplate(subjectId)
    : { subjectName: null, width: null, height: null, formatClass: null, adaptMethod: null, sourceTemplateId: null };
  const snapConfig = subjectType === "template" ? await snapshotTemplateConfig(subjectId) : null;
  await db.execute(
    sql`INSERT INTO feedback (subject_type, subject_id, verdict, element_id, element_label, note, created_by,
                              subject_name, subject_width, subject_height, format_class, adapt_method, source_template_id, element_slot, fault, expected, severity, subject_config)
        VALUES (${subjectType}, ${subjectId}, ${verdict}, ${elId}, ${elLabel}, ${cleanNote}, ${(req as any).clerkUserId ?? null},
                ${snap.subjectName}, ${snap.width}, ${snap.height}, ${snap.formatClass}, ${snap.adaptMethod}, ${snap.sourceTemplateId}, ${slot}, ${faultV}, ${expectedV}, ${severityV}, ${snapConfig})`,
  );

  // A whole-piece Right is remembered in Knowledge as a learned creative (so
  // it survives WIP clean-ups and is selectable in briefs); a whole-piece
  // Wrong retracts that copy. Element-level flags don't touch Knowledge.
  let rememberedId: number | null = null;
  if (subjectType === "template" && !elId) {
    try {
      if (verdict === "correct") {
        rememberedId = await rememberRightPiece(subjectId, rememberOptionsFor(req));
      } else {
        await forgetRightPiece(subjectId);
      }
    } catch (err) {
      req.log.warn({ err, subjectId, verdict }, "feedback: remembering the verdict in Knowledge failed");
    }
  }
  // A structured Wrong moves geometry, not just prompts: "too small" with a
  // px value becomes the part's minimum, "missing" makes the part
  // undroppable — on the campaign profile this piece belongs to.
  let ruleUpdated: { profileId: number; slot: string; change: Record<string, unknown> } | null = null;
  if (subjectType === "template" && verdict === "incorrect" && slot && (PART_RULE_SLOTS as readonly string[]).includes(slot)) {
    try {
      const px = expectedV ? Number((/(\d{1,4})\s*px/i.exec(expectedV) ?? [])[1]) : NaN;
      const change: Record<string, unknown> =
        faultV === "too_small" && Number.isFinite(px) && px > 0 ? { minPx: px }
        : faultV === "missing" || faultV === "cut_off" ? { dropWhenTight: false }
        : {};
      if (Object.keys(change).length > 0) {
        const p = await profileForMaster(snap.sourceTemplateId ?? subjectId, snap.sourceTemplateId ? subjectId : null);
        if (p) {
          await updateProfileRules(p.id, { [slot as PartRuleSlot]: change });
          ruleUpdated = { profileId: p.id, slot, change };
          req.log.info({ profileId: p.id, slot, change }, "feedback: profile rule updated from a structured Wrong");
        }
      }
    } catch (err) {
      req.log.warn({ err, subjectId }, "feedback: could not move the verdict into the profile's rules");
    }
  }
  // Position verdicts set liquid-layout pins on the MASTER's element, so
  // every later build of the family follows them: "full width of the box" →
  // pinned left + right, flexible width; "bleed to the top" → pinned top.
  let pinsUpdated: { masterId: number; elementId: string; constraints: LiquidConstraints; words: string } | null = null;
  if (subjectType === "template" && verdict === "incorrect" && slot && slot !== "whole" && slot !== "copy") {
    try {
      const text = `${expectedV ?? ""} ${cleanNote ?? ""}`.toLowerCase();
      const c: LiquidConstraints = {};
      if (/full[- ]width|edge to edge|whole width|length of the (box|panel)/.test(text)) { c.pinLeft = true; c.pinRight = true; c.flexW = true; }
      if (/full[- ]height|whole height/.test(text)) { c.pinTop = true; c.pinBottom = true; c.flexH = true; }
      if (/top of the (box|panel|artwork|canvas)|to the top|bleed(s)? (off|to) the top/.test(text)) c.pinTop = true;
      if (/bottom of the (box|panel|artwork|canvas)|to the bottom|bleed(s)? (off|to) the bottom/.test(text)) c.pinBottom = true;
      if (/left edge|to the left|bleed(s)? (off|to) the left/.test(text)) c.pinLeft = true;
      if (/right edge|to the right|bleed(s)? (off|to) the right/.test(text)) c.pinRight = true;
      if (Object.keys(c).length > 0) {
        const masterId = snap.sourceTemplateId ?? subjectId;
        const [m] = await db.select().from(templatesTable).where(eq(templatesTable.id, masterId));
        if (m) {
          const raw = JSON.parse(m.config || "{}");
          if (isFreeformConfig(raw)) {
            const cfg = normalizeFreeformConfig(raw);
            const sem = inferSlots(cfg, m.width, m.height);
            const target = cfg.elements.find((e) => e.slot === slot) ?? (sem.elements.find((e) => e.slot === slot) as { id: string } | undefined);
            if (target) {
              const elements = cfg.elements.map((e) => (e.id === target.id ? { ...e, constraints: { ...(e.constraints ?? {}), ...c } } : e));
              await db.update(templatesTable).set({ config: JSON.stringify({ ...raw, elements }), updatedAt: new Date() }).where(eq(templatesTable.id, m.id));
              pinsUpdated = { masterId: m.id, elementId: target.id, constraints: c, words: describeConstraints(c) };
              req.log.info({ masterId: m.id, slot, constraints: c }, "feedback: liquid pins set on the master from a verdict");
            }
          }
        }
      }
    } catch (err) {
      req.log.warn({ err, subjectId }, "feedback: could not set liquid pins from the verdict");
    }
  }
  res.status(201).json({ ok: true, rememberedId, ...(ruleUpdated ? { ruleUpdated } : {}), ...(pinsUpdated ? { pinsUpdated } : {}) });
  void backfillOnce(req);
});

/** POST /feedback/remember-backfill — catch up pre-existing Right verdicts (admin). */
router.post("/feedback/remember-backfill", requireAdmin, async (req, res): Promise<void> => {
  const result = await backfillRememberedRights(rememberOptionsFor(req));
  res.json({ ok: true, ...result });
});

router.get("/feedback", optionalAuth, async (req, res): Promise<void> => {
  await ensureTable();
  const subjectType = typeof req.query.subjectType === "string" ? req.query.subjectType : null;
  const rows = await db.execute(
    subjectType
      ? sql`SELECT * FROM (
              SELECT DISTINCT ON (subject_id, element_id) id, subject_type, subject_id, verdict, element_id, element_label, note, created_by, created_at,
                     subject_name, subject_width, subject_height, format_class, adapt_method, element_slot, fault, expected, severity
              FROM feedback WHERE subject_type = ${subjectType}
              ORDER BY subject_id, element_id, id DESC
            ) latest ORDER BY id DESC LIMIT 5000`
      : sql`SELECT id, subject_type, subject_id, verdict, element_id, element_label, note, created_by, created_at,
                   subject_name, subject_width, subject_height, format_class, adapt_method, element_slot, fault, expected, severity
            FROM feedback ORDER BY id DESC LIMIT 500`,
  );
  res.json({
    items: (rows.rows as any[]).map((r) => ({
      id: r.id,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      verdict: r.verdict,
      elementId: r.element_id,
      elementLabel: r.element_label,
      note: r.note,
      createdBy: r.created_by,
      createdAt: r.created_at,
      subjectName: r.subject_name ?? null,
      subjectWidth: r.subject_width ?? null,
      subjectHeight: r.subject_height ?? null,
      formatClass: r.format_class ?? null,
      adaptMethod: r.adapt_method ?? null,
      elementSlot: r.element_slot ?? null,
      fault: r.fault ?? null,
      expected: r.expected ?? null,
      severity: r.severity ?? null,
    })),
  });
});

/**
 * Recent "incorrect" notes, newest first — consumed by the generation
 * pipeline as things to avoid repeating.
 */
export async function recentIncorrectNotes(limit = 8): Promise<string[]> {
  await ensureTable();
  const rows = await db.execute(
    sql`SELECT note, element_label, element_slot, fault, expected FROM feedback
        WHERE verdict = 'incorrect' AND (note IS NOT NULL OR fault IS NOT NULL)
        ORDER BY id DESC LIMIT ${limit}`,
  );
  return (rows.rows as any[])
    .map((r) => {
      const part = r.element_slot ?? r.element_label;
      const structured = r.fault ? `${String(r.fault).replace(/_/g, " ")}${r.expected ? ` — expected ${r.expected}` : ""}` : "";
      const text = [structured, r.note ? String(r.note) : ""].filter(Boolean).join("; ");
      return part ? `[${part}] ${text}` : text;
    })
    .filter(Boolean);
}

export default router;
