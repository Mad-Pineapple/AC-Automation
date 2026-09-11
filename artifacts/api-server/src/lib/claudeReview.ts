/**
 * Claude as the studio's final reviewer.
 *
 * After a piece is adapted or rebuilt, Claude (claude-opus-5, vision) gets
 * the rendered artwork, its element list, the brand's layout rules, the
 * measuring tool's findings and up to two pieces of the same format the
 * designers already marked Right, and answers the one question the studio
 * asks on a contact sheet: would we sign this off as-is? Findings are
 * element-level (which element, what fault, what to change) so the editor can
 * act on them. The verdict is advisory — a person still clicks Right.
 *
 * Config: ANTHROPIC_API_KEY (set on the deployment). Without it reviews are
 * skipped and the route answers 503.
 */
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import type { FreeformConfig } from "./freeform";
import { renderFreeformToPng, type ImageLoader } from "./renderFreeform";
import { getBrandRules } from "./brandRules";
import { classifyAspect } from "./formatCatalog";
import type { Exemplar } from "./exemplars";
import type { LayoutIssue } from "./layoutCheck";
import { logger } from "./logger";

export const CLAUDE_REVIEW_MODEL = "claude-opus-5";

export const REVIEW_FAULTS = [
  "too_big", "too_small", "wrong_position", "cut_off", "missing", "illegible",
  "wrong_style", "off_brand_colour_or_font", "wrong_crop", "other",
] as const;
export type ReviewFault = (typeof REVIEW_FAULTS)[number];

/** A concrete change to one existing element. Only these properties can be set. */
export interface ElementEdit {
  elementId: string;
  delete: boolean;
  set: Partial<{
    x: number; y: number; w: number; h: number;
    fontSize: number; text: string; color: string; fill: string;
    align: "left" | "center" | "right"; fontWeight: 400 | 700;
    opacity: number; lineHeight: number; letterSpacing: number;
    focusX: number; focusY: number; fit: "cover" | "contain"; radius: number;
  }>;
}

export interface ReviewIssue {
  elementId: string | null;
  slot: string | null;
  fault: ReviewFault;
  message: string;
  fix: string | null;
  severity: "send_back" | "fix_next_time";
  /** The change that fixes it, when one existing element's properties can. */
  edit: ElementEdit | null;
}

export interface ClaudeReview {
  verdict: "right" | "wrong";
  confidence: number;
  summary: string;
  issues: ReviewIssue[];
  model: string;
  reviewedAt: string;
  ms: number;
  exemplarIds: number[];
  /** The guideline topics read for this piece's elements (what was checked against). */
  guidelinesApplied?: Array<{ topic: string; label: string; elementIds: string[]; sources: string[]; passages: number }>;
  /** Set when a safety fallback model answered instead of claude-opus-5. */
  answeredBy?: string;
}

export function isClaudeReviewConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "confidence", "summary", "issues"],
  properties: {
    verdict: { type: "string", enum: ["right", "wrong"] },
    confidence: { type: "number" },
    summary: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["elementId", "slot", "fault", "message", "fix", "severity", "edit"],
        properties: {
          elementId: { type: ["string", "null"] },
          slot: { type: ["string", "null"] },
          fault: { type: "string", enum: [...REVIEW_FAULTS] },
          message: { type: "string" },
          fix: { type: ["string", "null"] },
          severity: { type: "string", enum: ["send_back", "fix_next_time"] },
          edit: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["elementId", "delete", "set"],
            properties: {
              elementId: { type: "string" },
              delete: { type: "boolean" },
              set: {
                type: "object",
                additionalProperties: false,
                required: ["x", "y", "w", "h", "fontSize", "text", "color", "fill", "align", "fontWeight", "opacity", "lineHeight", "letterSpacing", "focusX", "focusY", "fit", "radius"],
                properties: {
                  x: { type: ["number", "null"] }, y: { type: ["number", "null"] },
                  w: { type: ["number", "null"] }, h: { type: ["number", "null"] },
                  fontSize: { type: ["number", "null"] }, text: { type: ["string", "null"] },
                  color: { type: ["string", "null"] }, fill: { type: ["string", "null"] },
                  align: { anyOf: [{ type: "string", enum: ["left", "center", "right"] }, { type: "null" }] },
                  fontWeight: { type: ["number", "null"] },
                  opacity: { type: ["number", "null"] }, lineHeight: { type: ["number", "null"] },
                  letterSpacing: { type: ["number", "null"] },
                  focusX: { type: ["number", "null"] }, focusY: { type: ["number", "null"] },
                  fit: { anyOf: [{ type: "string", enum: ["cover", "contain"] }, { type: "null" }] },
                  radius: { type: ["number", "null"] },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

async function toJpeg(png: Buffer, maxEdge: number): Promise<{ data: string; media_type: "image/jpeg" }> {
  const buf = await sharp(png).resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { data: buf.toString("base64"), media_type: "image/jpeg" };
}

function describeElements(config: FreeformConfig): string {
  return config.elements
    .map((e) => {
      const any = e as unknown as Record<string, unknown>;
      const base = `${e.id} ${e.type}${any.slot ? ` slot=${any.slot}` : any.role ? ` role=${any.role}` : ""} @(${Math.round(e.x)},${Math.round(e.y)}) ${Math.round(e.w)}×${Math.round(e.h)}`;
      if (e.type === "text") {
        const t = e as unknown as { text?: string; fontSize?: number; fontWeight?: string | number; align?: string };
        return `${base} size=${t.fontSize ?? "?"}px ${t.fontWeight ?? ""} "${String(t.text ?? "").slice(0, 80)}"`;
      }
      return base;
    })
    .join("\n");
}

export interface ReviewInput {
  name: string;
  config: FreeformConfig;
  width: number;
  height: number;
  brand: { name: string; guidelines?: string | null; fontFamily?: string | null; primaryColor?: string; secondaryColor?: string; accentColor?: string };
  loadImage: ImageLoader;
  exemplars: Exemplar[];
  measured: LayoutIssue[];
  adaptMethod?: string | null;
  /** The designer's latest note on this piece, when they marked it Wrong. */
  designerNote?: string | null;
  /** The campaign's measured style schema, when one matches this piece. */
  styleSpec?: string | null;
  /** Guideline passages for the elements on the piece (lib/guidelines.ts). */
  elementGuidelines?: Array<{ topic: string; label: string; elementIds: string[]; passages: Array<{ heading: string; body: string; source: string }> }>;
  /** Layered pieces: the tallest a picture headline may be, in px (campaign share of the short side). */
  headlineMaxH?: number | null;
}

/** Element geometry as fractions of the canvas, so a reference's decisions transfer to another size. */
function describeReference(ex: Exemplar): string {
  const lines = ex.config.elements.map((e) => {
    const any = e as unknown as Record<string, unknown>;
    const pct = (v: number, of: number) => `${Math.round((v / of) * 100)}%`;
    const geo = `x=${pct(e.x, ex.width)} y=${pct(e.y, ex.height)} w=${pct(e.w, ex.width)} h=${pct(e.h, ex.height)}`;
    const slot = any.slot ?? any.role ?? e.id;
    if (e.type === "text") {
      const t = e as unknown as { fontSize?: number; color?: string; align?: string };
      return `  ${slot}: text ${geo} fontSize=${t.fontSize}px (${pct(t.fontSize ?? 0, ex.height)} of height) color=${t.color} align=${t.align}`;
    }
    if (e.type === "rect") return `  ${slot}: rect ${geo} fill=${(e as unknown as { fill?: string }).fill}`;
    return `  ${slot}: image ${geo}`;
  });
  return `${ex.name} — ${ex.width}×${ex.height} (${ex.formatClass})\n${lines.join("\n")}`;
}

export async function reviewPiece(input: ReviewInput): Promise<ClaudeReview> {
  const started = Date.now();
  const client = new Anthropic();
  const formatClass = classifyAspect(input.width, input.height);
  const rules = getBrandRules(input.brand.name);

  const candidatePng = await renderFreeformToPng(input.config, input.width, input.height, { scale: 1, loadImage: input.loadImage });
  const candidate = await toJpeg(candidatePng, 1200);

  const refs: Array<{ id: number; image: { data: string; media_type: "image/jpeg" }; label: string }> = [];
  for (const ex of input.exemplars.slice(0, 3)) {
    try {
      const png = await renderFreeformToPng(ex.config, ex.width, ex.height, { scale: 1, loadImage: input.loadImage });
      refs.push({ id: ex.id, image: await toJpeg(png, 800), label: `${ex.name} (${ex.width}×${ex.height})` });
    } catch (err) {
      logger.warn({ err, exemplarId: ex.id }, "claude review: exemplar render failed, continuing without it");
    }
  }

  const system = [
    `You are the final reviewer at ${input.brand.name}'s in-house brand studio. Designers have adapted or rebuilt a piece of artwork into a new size. Judge it exactly as a senior designer would on a contact sheet before it goes to the traffic team: would the studio sign this off as-is?`,
    "",
    "Answer as JSON matching the schema. Rules for the verdict:",
    "- \"right\" means a designer would approve it without touching it. \"wrong\" means it needs a change before it can ship.",
    "- Judge composition, hierarchy, crop, legibility, spacing to the margins and the logo tile, and whether copy sits where the brand grid puts it. Do not invent problems: a plain, correct layout is right.",
    "- THE APPROVED REFERENCES ARE THE STANDARD. When references are given, the piece under review must match their decisions: panel colour, photo/panel split, band placement, headline size relative to the canvas, pill height, margins, alignment. Every departure from the references is an issue, and its `edit` brings the piece in line — use the references' element geometry (given as fractions of their canvas) to compute the target values for this canvas. Your own taste never overrides a reference.",
    "- LAYERED ARTWORK (an element list where the headline, sub-head, CTA or panel are images): those are pictures, not type. Move and scale the headline and sub-head together as one block, keep the sub-head directly under the headline, never crop a picture layer (do not change its fit), and treat the panel graphic as a single card that includes its pattern band and lockup — resize it as a whole or leave it. The cut-out (e.g. the car) is a pop-out of the subject already in the photograph and has been placed to coincide with it: never move, resize or delete the cut-out, and never change the photo's crop when a cut-out is present.",
    "- Whenever a fix is a matter of position, size, font size, colour or alignment of an existing element, ALWAYS supply the `edit` — a pill that is too short, a panel in the wrong colour, a headline in the wrong place are all edits, never notes.",
    "- Each issue names one element by its id (or null for the whole piece), one fault, a plain-language message a designer would write, and a concrete fix (\"move up 24px\", \"shrink to 36px\", \"crop to the right third\"). severity send_back = must fix before shipping; fix_next_time = note for the rules.",
    "- YOU ALSO MAKE THE FIX. For every send_back issue that can be corrected by changing one existing element, fill `edit` with that element's id and the exact new values in `set` (absolute template pixels for x/y/w/h, font size in px, colours as hex, focusX/focusY 0..1 for a photo crop; leave every property you are not changing as null; set `delete` true only to remove a stray element). Keep elements inside the canvas and on the margins the rules give. Use `edit: null` only when the fix needs a new element or something the properties cannot express. Never move, resize or recolour the logo tile or the lockup. NEVER change the wording, spelling, case or letterforms of any copy: the words and their display styling — including stylised digital-clock lettering with colons between letters — come from the campaign and are correct by definition; do not report them as errors. You may change a text element's size, position, colour and alignment only.",
    "- confidence is 0 to 1.",
    "",
    "BRAND LAYOUT RULES FOR THIS CANVAS:",
    ...rules.layoutRules(input.width, input.height).map((r) => `- ${r}`),
    input.brand.fontFamily ? `- Brand font: ${input.brand.fontFamily}.` : "",
    "",
    input.elementGuidelines && input.elementGuidelines.length
      ? `GUIDELINES FOR THE ELEMENTS ON THIS PIECE — read from the brand guidelines for exactly the things present (a logo tile, a pattern band, a photograph, live type, a panel colour…). Check each named element against its passages and cite the passage in the issue message when it is broken:\n${input.elementGuidelines.map((g) => `${g.label.toUpperCase()}${g.elementIds.length ? ` (elements ${g.elementIds.slice(0, 6).join(", ")})` : ""}:\n${g.passages.map((p) => `- ${p.heading ? `[${p.heading}] ` : ""}${p.body} (${p.source})`).join("\n")}`).join("\n\n").slice(0, 9000)}`
      : input.brand.guidelines ? `BRAND GUIDELINES (operational extract):\n${input.brand.guidelines.slice(0, 3500)}` : "",
    input.styleSpec ? `\nCAMPAIGN STYLE SPEC — measured off the signed-off artwork; this is the standard for this piece, above general taste:\n${input.styleSpec.slice(0, 6000)}` : "",
  ].filter((l) => l !== undefined).join("\n");

  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
  refs.forEach((r, i) => {
    const ex = input.exemplars.find((e) => e.id === r.id);
    content.push({
      type: "text",
      text: `Approved reference ${i + 1} of ${refs.length} — marked Right by the designers: ${r.label}` + (ex ? `\nIts elements (fractions of its own canvas):\n${describeReference(ex)}` : ""),
    });
    content.push({ type: "image", source: { type: "base64", media_type: r.image.media_type, data: r.image.data } });
  });
  if (input.designerNote) {
    content.push({ type: "text", text: `A designer marked this piece Wrong and wrote: "${input.designerNote.slice(0, 500)}". Treat that as the first thing to fix.` });
  }
  content.push({
    type: "text",
    text: [
      `PIECE UNDER REVIEW: "${input.name}" — ${input.width}×${input.height}px, ${formatClass}${input.adaptMethod ? `, made by: ${input.adaptMethod}` : ""}.`,
      "",
      "Elements (id type slot @(x,y) w×h …):",
      describeElements(input.config),
      "",
      input.measured.length
        ? `The measuring tool reports (confirm, dismiss, or add to these):\n${input.measured.map((m) => `- [${m.severity}] ${m.message}${m.elementId ? ` (element ${m.elementId})` : ""}`).join("\n")}`
        : "The measuring tool found no geometric problems.",
      "",
      "The rendered piece follows.",
    ].join("\n"),
  });
  content.push({ type: "image", source: { type: "base64", media_type: candidate.media_type, data: candidate.data } });

  // Server-side fallback ("default"): if Claude Opus 5 declines, the request is
  // re-run on Anthropic's recommended substitute inside the same call.
  const response = await client.beta.messages.create(
    {
      model: CLAUDE_REVIEW_MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: REVIEW_SCHEMA as unknown as Record<string, unknown> } },
      system,
      messages: [{ role: "user", content }],
    },
    { timeout: 90_000 },
  );

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to review this piece");
  }
  let answeredBy: string | undefined;
  let text = "";
  for (const block of response.content as unknown as Array<Record<string, unknown>>) {
    if (block.type === "text") text += String(block.text ?? "");
    if (block.type === "fallback") answeredBy = String((block.to as { model?: string } | undefined)?.model ?? "");
  }
  let parsed: { verdict: string; confidence: number; summary: string; issues: ReviewIssue[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Claude's review was not valid JSON");
  }
  const issues: ReviewIssue[] = (Array.isArray(parsed.issues) ? parsed.issues : []).map((i) => ({
    elementId: i.elementId ?? null,
    slot: i.slot ?? null,
    fault: (REVIEW_FAULTS as readonly string[]).includes(i.fault) ? i.fault : "other",
    message: String(i.message ?? "").slice(0, 400),
    fix: i.fix ? String(i.fix).slice(0, 300) : null,
    severity: i.severity === "fix_next_time" ? "fix_next_time" : "send_back",
    edit: cleanEdit(i.edit),
  }));
  const review: ClaudeReview = {
    verdict: parsed.verdict === "right" ? "right" : "wrong",
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    summary: String(parsed.summary ?? "").slice(0, 600),
    issues,
    model: CLAUDE_REVIEW_MODEL,
    reviewedAt: new Date().toISOString(),
    ms: Date.now() - started,
    exemplarIds: refs.map((r) => r.id),
    ...(input.elementGuidelines && input.elementGuidelines.length
      ? { guidelinesApplied: input.elementGuidelines.map((g) => ({ topic: g.topic, label: g.label, elementIds: g.elementIds, sources: [...new Set(g.passages.map((p) => p.source))], passages: g.passages.length })) }
      : {}),
    ...(answeredBy ? { answeredBy } : {}),
  };
  logger.info({ verdict: review.verdict, confidence: review.confidence, issues: issues.length, ms: review.ms, tokens: response.usage?.input_tokens }, "claude review finished");
  return review;
}


// ---------------------------------------------------------------------------
// Applying Claude's fixes

function cleanEdit(raw: unknown): ElementEdit | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.elementId !== "string" || !r.elementId) return null;
  const setRaw = (r.set && typeof r.set === "object" ? r.set : {}) as Record<string, unknown>;
  const set: ElementEdit["set"] = {};
  const num = (k: keyof ElementEdit["set"]) => {
    const v = setRaw[k];
    if (typeof v === "number" && Number.isFinite(v)) (set as Record<string, unknown>)[k] = v;
  };
  (["x", "y", "w", "h", "fontSize", "opacity", "lineHeight", "letterSpacing", "focusX", "focusY", "radius"] as const).forEach(num);
  // Copy is never Claude's to change — text edits are dropped on purpose.
  const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : undefined);
  if (hex(setRaw.color)) set.color = hex(setRaw.color);
  if (hex(setRaw.fill)) set.fill = hex(setRaw.fill);
  if (setRaw.align === "left" || setRaw.align === "center" || setRaw.align === "right") set.align = setRaw.align;
  if (setRaw.fontWeight === 400 || setRaw.fontWeight === 700) set.fontWeight = setRaw.fontWeight;
  if (setRaw.fit === "cover" || setRaw.fit === "contain") set.fit = setRaw.fit;
  const del = r.delete === true;
  if (!del && Object.keys(set).length === 0) return null;
  return { elementId: r.elementId, delete: del, set };
}

export interface AppliedChange {
  elementId: string;
  label: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  deleted?: boolean;
}

/**
 * Apply edits to a copy of the config. Values are clamped to the canvas and
 * to sane ranges; locked elements and unknown ids are skipped. Returns the
 * new config and what actually changed.
 */
export function applyEdits(config: FreeformConfig, edits: ElementEdit[], width: number, height: number): { config: FreeformConfig; applied: AppliedChange[] } {
  const elements = config.elements.map((e) => ({ ...e })) as FreeformConfig["elements"];
  const applied: AppliedChange[] = [];
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  for (const edit of edits) {
    const idx = elements.findIndex((e) => e.id === edit.elementId);
    if (idx < 0) continue;
    const el = elements[idx] as unknown as Record<string, unknown> & { type: string; locked?: boolean };
    const slot = String((el as { slot?: string }).slot ?? "");
    const role = String((el as { role?: string }).role ?? "");
    // Brand marks are never touched; other locked furniture (panel, scrim,
    // CTA pill) is exactly what a designer's fix usually adjusts.
    if (slot === "logo" || slot === "lockup" || role === "logo") continue;
    // Layered artwork: the cut-out is a pop-out of the subject in the photo
    // and is placed by the adapter to coincide with it. Moving either one
    // makes two cars — so neither the cut-out nor the photo crop is editable
    // when a cut-out is present.
    const hasCutout = elements.some((e) => e.type === "image" && (e as { slot?: string }).slot === "cutout");
    if (hasCutout && (slot === "cutout" || slot === "photo")) continue;
    const label = String((el as { slot?: string }).slot ?? (el as { role?: string }).role ?? el.id);
    if (edit.delete) {
      elements.splice(idx, 1);
      applied.push({ elementId: edit.elementId, label, changes: {}, deleted: true });
      continue;
    }
    const changes: AppliedChange["changes"] = {};
    const setNum = (k: string, v: number | undefined, lo: number, hi: number, round = true) => {
      if (v === undefined) return;
      const nv = round ? Math.round(clamp(v, lo, hi)) : clamp(v, lo, hi);
      if (el[k] !== nv) { changes[k] = { from: el[k], to: nv }; el[k] = nv; }
    };
    const s = edit.set;
    setNum("x", s.x, -width, width * 2);
    setNum("y", s.y, -height, height * 2);
    setNum("w", s.w, 4, width * 2);
    setNum("h", s.h, 4, height * 2);
    if (el.type === "text") {
      setNum("fontSize", s.fontSize, 6, Math.max(height, width));
      setNum("lineHeight", s.lineHeight, 0.6, 3, false);
      setNum("letterSpacing", s.letterSpacing, -20, 60, false);
      if (s.color && s.color !== el.color) { changes.color = { from: el.color, to: s.color }; el.color = s.color; }
      if (s.align && s.align !== el.align) { changes.align = { from: el.align, to: s.align }; el.align = s.align; }
      if (s.fontWeight && s.fontWeight !== el.fontWeight) { changes.fontWeight = { from: el.fontWeight, to: s.fontWeight }; el.fontWeight = s.fontWeight; }
    }
    if (el.type === "rect") {
      if (s.fill && s.fill !== el.fill) { changes.fill = { from: el.fill, to: s.fill }; el.fill = s.fill; }
      setNum("radius", s.radius, 0, Math.max(width, height));
    }
    if (el.type === "image") {
      setNum("focusX", s.focusX, 0, 1, false);
      setNum("focusY", s.focusY, 0, 1, false);
      // Baked graphics (a headline, sub-head, CTA or panel that is a picture)
      // are never cropped: only the photo may switch between cover and contain.
      const baked = slot === "headline" || slot === "subheadline" || slot === "cta" || slot === "panel" || slot === "band";
      if (!baked && s.fit && s.fit !== el.fit) { changes.fit = { from: el.fit, to: s.fit }; el.fit = s.fit; }
      setNum("radius", s.radius, 0, Math.max(width, height));
    }
    setNum("opacity", s.opacity, 0, 1, false);
    if (Object.keys(changes).length > 0) applied.push({ elementId: edit.elementId, label, changes });
  }
  // Layered artwork: a headline that is a picture moves with its sub-head.
  // If Claude moved or resized the headline image and left the sub-head
  // image alone, carry the sub-head along by the same transform.
  const hl = applied.find((a) => !a.deleted && a.label === "headline" && (a.changes.x || a.changes.y || a.changes.w || a.changes.h));
  const hlEl = hl ? (elements.find((e) => e.id === hl.elementId) as (Record<string, unknown> & { type: string }) | undefined) : undefined;
  if (hl && hlEl && hlEl.type === "image") {
    const subEl = elements.find((e) => e.type === "image" && (e as { slot?: string }).slot === "subheadline") as (Record<string, unknown> & { id: string }) | undefined;
    if (subEl && !applied.some((a) => a.elementId === subEl.id)) {
      const fromX = Number(hl.changes.x?.from ?? hlEl.x), fromY = Number(hl.changes.y?.from ?? hlEl.y), fromW = Number(hl.changes.w?.from ?? hlEl.w);
      const sc = Number(hlEl.w) / Math.max(1, fromW);
      const nx = Number(hlEl.x) + (Number(subEl.x) - fromX) * sc;
      const ny = Number(hlEl.y) + (Number(subEl.y) - fromY) * sc;
      const ch: AppliedChange["changes"] = {};
      const upd = (k: string, v: number) => { const nv = Math.round(v); if (subEl[k] !== nv) { ch[k] = { from: subEl[k], to: nv }; subEl[k] = nv; } };
      upd("x", nx); upd("y", ny); upd("w", Number(subEl.w) * sc); upd("h", Number(subEl.h) * sc);
      if (Object.keys(ch).length) applied.push({ elementId: subEl.id, label: "subheadline", changes: ch });
    }
  }
  return { config: { ...config, elements }, applied };
}

export interface FixResult {
  review: ClaudeReview;
  config: FreeformConfig;
  rounds: number;
  applied: AppliedChange[];
  /** send_back issues Claude could not express as an edit — still need a person. */
  remaining: ReviewIssue[];
}

/**
 * Review, apply every fix Claude can express, re-render, review again — up to
 * `maxRounds` — and return the corrected config. Stops early once Claude would
 * sign off or has nothing left it can change.
 */
export async function reviewAndFix(input: ReviewInput, maxRounds = 3): Promise<FixResult> {
  let config = input.config;
  const applied: AppliedChange[] = [];
  let review = await reviewPiece({ ...input, config });
  let rounds = 1;
  while (rounds < maxRounds + 1) {
    if (review.verdict === "right") break;
    const edits = review.issues.filter((i) => i.severity === "send_back" && i.edit).map((i) => i.edit as ElementEdit);
    if (edits.length === 0) break;
    const result = applyEdits(config, edits, input.width, input.height);
    if (result.applied.length === 0) break;
    config = input.headlineMaxH ? capPictureHeadline(result.config, input.headlineMaxH) : result.config;
    applied.push(...result.applied);
    if (rounds >= maxRounds) break;
    review = await reviewPiece({ ...input, config, measured: [] });
    rounds += 1;
  }
  const remaining = review.issues.filter((i) => i.severity === "send_back" && !i.edit);
  return { review, config, rounds, applied, remaining };
}

/** A picture headline (and its sub-head) never grows past the campaign's share of the short side. */
export function capPictureHeadline(config: FreeformConfig, maxH: number): FreeformConfig {
  const hl = config.elements.find((e) => e.type === "image" && e.slot === "headline");
  if (!hl || hl.h <= maxH) return config;
  const k = maxH / Math.max(1, hl.h);
  const cx = hl.x + hl.w / 2;
  const elements = config.elements.map((e) => {
    if (e.type !== "image") return e;
    if (e.slot === "headline") return { ...e, w: Math.round(e.w * k), h: Math.round(e.h * k), x: Math.round(cx - (e.w * k) / 2) };
    if (e.slot === "subheadline") return { ...e, w: Math.round(e.w * k), h: Math.round(e.h * k), x: Math.round(cx - (e.w * k) / 2), y: Math.round(hl.y + hl.h * k + (e.y - (hl.y + hl.h)) * k) };
    return e;
  });
  return { ...config, elements };
}
