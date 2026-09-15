/** OpenAI vision fallback for the in-build artwork guard. */
import sharp from "sharp";
import { openai } from "@workspace/integrations-openai-ai-server";
import { renderFreeformToPng } from "./renderFreeform";
import {
  applyEdits,
  capPictureHeadline,
  REVIEW_FAULTS,
  type ClaudeReview,
  type ElementEdit,
  type FixResult,
  type ReviewInput,
  type ReviewIssue,
} from "./claudeReview";

export const OPENAI_REVIEW_MODEL = process.env.OPENAI_ARTWORK_REVIEW_MODEL?.trim() || "gpt-4o";

export function isOpenAIReviewConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY?.trim();
}

const describe = (input: ReviewInput) => input.config.elements.map((e) => {
  const role = e.slot ?? ("role" in e ? e.role : "other");
  const base = `${e.id} ${e.type} ${role} x=${Math.round(e.x)} y=${Math.round(e.y)} w=${Math.round(e.w)} h=${Math.round(e.h)}`;
  return e.type === "text" ? `${base} font=${e.fontSize}px text=${JSON.stringify(e.text.slice(0, 120))}` : base;
}).join("\n");

async function jpegData(config: ReviewInput["config"], input: ReviewInput, maxEdge: number): Promise<string> {
  const png = await renderFreeformToPng(config, input.width, input.height, { scale: 1, loadImage: input.loadImage });
  const jpg = await sharp(png).resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}

function editOf(value: unknown): ElementEdit | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (typeof r.elementId !== "string") return null;
  const rawSet = r.set && typeof r.set === "object" ? r.set as Record<string, unknown> : {};
  const set: ElementEdit["set"] = {};
  for (const key of ["x", "y", "w", "h", "fontSize", "opacity", "lineHeight", "letterSpacing", "focusX", "focusY", "radius"] as const) {
    if (typeof rawSet[key] === "number" && Number.isFinite(rawSet[key])) set[key] = rawSet[key];
  }
  if (rawSet.align === "left" || rawSet.align === "center" || rawSet.align === "right") set.align = rawSet.align;
  if (rawSet.fit === "cover" || rawSet.fit === "contain") set.fit = rawSet.fit;
  if (rawSet.fontWeight === 400 || rawSet.fontWeight === 700) set.fontWeight = rawSet.fontWeight;
  for (const key of ["color", "fill"] as const) if (typeof rawSet[key] === "string") set[key] = rawSet[key].slice(0, 32);
  return { elementId: r.elementId, delete: r.delete === true, set };
}

export async function reviewPieceWithOpenAI(input: ReviewInput): Promise<ClaudeReview> {
  const started = Date.now();
  const candidate = await jpegData(input.config, input, 1200);
  const referenceBlocks: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
  for (const ex of input.exemplars.slice(0, 2)) {
    try {
      const refInput = { ...input, config: ex.config, width: ex.width, height: ex.height };
      referenceBlocks.push({ type: "text", text: `Approved source reference: ${ex.name}, ${ex.width}x${ex.height}.` });
      referenceBlocks.push({ type: "image_url", image_url: { url: await jpegData(ex.config, refInput, 800) } });
    } catch { /* one missing reference must not stop the guard */ }
  }
  const prompt = [
    `You are the AI Artwork Guard for ${input.brand.name}. Inspect an automatically resized creative before it reaches a designer.`,
    "The source references are authoritative. Do not redesign, rewrite copy, alter logos, or apply personal taste.",
    "Check for stretched raster artwork, distorted logos, bad crops, missing elements, text collisions, overflowing text, unsafe margins, incorrect edge contact, weak hierarchy and departures from the supplied masters.",
    "Return JSON only with verdict, confidence, summary and issues.",
    "Each issue has elementId, slot, fault, message, fix, severity and edit.",
    "severity is send_back or fix_next_time. fault is one of: " + REVIEW_FAULTS.join(", ") + ".",
    "For a safe correction to an existing element, edit is {elementId, delete:false, set:{x,y,w,h,fontSize,align,opacity,lineHeight,letterSpacing,focusX,focusY,fit,radius}} containing only changed properties.",
    "Never change image width and height independently. For an image resize, preserve its current w:h ratio. Never resize, recolour, delete or move a logo or lockup. Never change any text wording.",
    input.styleSpec ? `Measured campaign rules:\n${input.styleSpec.slice(0, 5000)}` : "",
    input.measured.length ? `Deterministic checks:\n${input.measured.map((x) => `- ${x.severity}: ${x.message}`).join("\n")}` : "Deterministic checks found no issue.",
    `Canvas: ${input.width}x${input.height}. Method: ${input.adaptMethod ?? "unknown"}.`,
    `Elements:\n${describe(input)}`,
  ].filter(Boolean).join("\n\n");

  const response = await openai.chat.completions.create({
    model: OPENAI_REVIEW_MODEL,
    messages: [{ role: "user", content: [
      ...referenceBlocks,
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: candidate } },
    ] }],
    max_tokens: 2400,
    response_format: { type: "json_object" },
  });
  const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
  const issues: ReviewIssue[] = (Array.isArray(parsed.issues) ? parsed.issues : []).slice(0, 16).map((raw: unknown) => {
    const i = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const fault = typeof i.fault === "string" && (REVIEW_FAULTS as readonly string[]).includes(i.fault) ? i.fault as ReviewIssue["fault"] : "other";
    return {
      elementId: typeof i.elementId === "string" ? i.elementId : null,
      slot: typeof i.slot === "string" ? i.slot : null,
      fault,
      message: String(i.message ?? "Artwork needs review").slice(0, 400),
      fix: typeof i.fix === "string" ? i.fix.slice(0, 300) : null,
      severity: i.severity === "fix_next_time" ? "fix_next_time" : "send_back",
      edit: editOf(i.edit),
    };
  });
  return {
    verdict: parsed.verdict === "right" ? "right" : "wrong",
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    summary: String(parsed.summary ?? "OpenAI artwork check completed").slice(0, 600),
    issues,
    model: OPENAI_REVIEW_MODEL,
    answeredBy: `OpenAI ${OPENAI_REVIEW_MODEL}`,
    reviewedAt: new Date().toISOString(),
    ms: Date.now() - started,
    exemplarIds: input.exemplars.slice(0, 2).map((e) => e.id),
  };
}

export async function reviewAndFixWithOpenAI(input: ReviewInput, maxReviews = 2): Promise<FixResult> {
  let config = input.config;
  const applied: FixResult["applied"] = [];
  let review = await reviewPieceWithOpenAI({ ...input, config });
  let rounds = 1;
  while (rounds < maxReviews && review.verdict !== "right") {
    const edits = review.issues.filter((i) => i.severity === "send_back" && i.edit).map((i) => i.edit as ElementEdit);
    if (!edits.length) break;
    const fixed = applyEdits(config, edits, input.width, input.height);
    if (!fixed.applied.length) break;
    config = input.headlineMaxH ? capPictureHeadline(fixed.config, input.headlineMaxH) : fixed.config;
    applied.push(...fixed.applied);
    rounds++;
    review = await reviewPieceWithOpenAI({ ...input, config, measured: [] });
  }
  return { review, config, rounds, applied, remaining: review.issues.filter((i) => i.severity === "send_back" && !i.edit) };
}
