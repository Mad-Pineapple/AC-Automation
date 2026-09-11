/**
 * Subject detection for photographs (research plan step 4).
 *
 * A photo with no cut-out has nothing on the master that says where its
 * subject is: the attention-based hero box guesses from detail, which is
 * wrong for a face at the edge of a wide shot or a small figure in a big
 * landscape. Claude vision names the subject and boxes it once; the box is
 * stored on the master's photo (`focusBox`, `focusSource: "vision"`) and
 * every size built afterwards keeps that box inside its crop window.
 *
 * The designer's own box always wins (`focusSource: "designer"`), and the
 * detection is never repeated for a photo that already carries a vision box.
 */
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import type { FreeformConfig, FreeformImage } from "./freeform";
import type { ImageLoader } from "./renderFreeform";
import { logger } from "./logger";

export const SUBJECT_MODEL = "claude-opus-5";

export interface DetectedSubject {
  /** Plain description, e.g. "a woman and a child at a bus stop". */
  subject: string;
  /** The subject's box as fractions of the image (0..1). */
  box: { x: number; y: number; w: number; h: number };
  /** True when cropping into the box would lose meaning (a face, a whole
   * product, a sign that must be read). */
  keepWhole: boolean;
  faces: number;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "box", "keepWhole", "faces"],
  properties: {
    subject: { type: "string" },
    box: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y", "w", "h"],
      properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
    },
    keepWhole: { type: "boolean" },
    faces: { type: "integer" },
  },
} as const;

const clamp01 = (v: unknown) => Math.max(0, Math.min(1, Number(v) || 0));

export async function detectSubject(bytes: Buffer): Promise<DetectedSubject | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) return null;
  const jpeg = await sharp(bytes).resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const client = new Anthropic();
  const response = await client.beta.messages.create(
    {
      model: SUBJECT_MODEL,
      max_tokens: 600,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
      system: [
        "You locate the subject of an advertising photograph for an automated layout system that will crop the photo into many ad sizes.",
        "Answer as JSON matching the schema.",
        "- subject: what the photo is of, in a few words, the way an art director would say it.",
        "- box: the tightest rectangle that contains the whole subject (every person, the whole product, the whole vehicle, the sign that must be read), as fractions of the image width and height: x and y are the top-left corner, w and h the size. Include a little air around a person's head. The box must lie within 0..1.",
        "- keepWhole: true when a crop that cuts into the box would damage the meaning (a face or a person, a product, a vehicle, readable text); false for scenery or texture where any crop through it is fine.",
        "- faces: how many human faces are visible.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `The photograph is ${meta.width}×${meta.height}px.` },
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
          ],
        },
      ],
    },
    { timeout: 45_000 },
  );
  if (response.stop_reason === "refusal") return null;
  let text = "";
  for (const block of response.content as unknown as Array<Record<string, unknown>>) if (block.type === "text") text += String(block.text ?? "");
  let parsed: { subject?: unknown; box?: Record<string, unknown>; keepWhole?: unknown; faces?: unknown };
  try { parsed = JSON.parse(text); } catch { return null; }
  const b = parsed.box ?? {};
  const x = clamp01(b.x), y = clamp01(b.y);
  const w = Math.max(0.02, Math.min(1 - x, clamp01(b.w))), h = Math.max(0.02, Math.min(1 - y, clamp01(b.h)));
  return {
    subject: String(parsed.subject ?? "").slice(0, 120),
    box: { x: r3(x), y: r3(y), w: r3(w), h: r3(h) },
    keepWhole: parsed.keepWhole === true,
    faces: Math.max(0, Math.min(50, Math.round(Number(parsed.faces) || 0))),
  };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The photographs on a master that still need a subject: photo slot (or a
 * product-role image with no slot), with no vision or designer box, and no
 * cut-out on the master (a cut-out already says what the subject is). */
export function photosNeedingSubject(config: FreeformConfig): FreeformImage[] {
  if (config.elements.some((e) => e.slot === "cutout")) return [];
  return config.elements.filter(
    (e): e is FreeformImage =>
      e.type === "image" && !!e.src && !e.panelPart &&
      (e.slot === "photo" || (!e.slot && e.role === "product")) &&
      e.focusSource !== "vision" && e.focusSource !== "designer",
  );
}

/**
 * Detects the subject of every photograph that needs one and writes the box
 * onto the element. Returns the updated config and notes, or null when
 * nothing changed. Failures are logged, never thrown: the build goes on with
 * whatever focus the photo already had.
 */
export async function ensureSubjects(
  config: FreeformConfig,
  loadImage: ImageLoader,
): Promise<{ config: FreeformConfig; notes: string[] } | null> {
  const todo = photosNeedingSubject(config);
  if (todo.length === 0) return null;
  const notes: string[] = [];
  const elements = [...config.elements];
  let changed = false;
  for (const photo of todo) {
    try {
      const bytes = await loadImage(photo.src!);
      if (!bytes) continue;
      const found = await detectSubject(bytes);
      if (!found) continue;
      const idx = elements.findIndex((e) => e.id === photo.id);
      if (idx < 0) continue;
      elements[idx] = {
        ...photo,
        focusBox: found.box,
        focusX: r3(found.box.x + found.box.w / 2),
        focusY: r3(found.box.y + found.box.h / 2),
        focusSource: "vision",
        subject: found.subject,
        ...(found.keepWhole ? { keepWhole: true } : {}),
      };
      changed = true;
      notes.push(`Subject found by Claude vision: ${found.subject || "the subject"}${found.faces ? ` (${found.faces} face${found.faces === 1 ? "" : "s"})` : ""}; every size keeps it in frame.`);
    } catch (err) {
      logger.warn({ err, elementId: photo.id }, "subject detection failed; keeping the photo's existing focus");
    }
  }
  return changed ? { config: { ...config, elements }, notes } : null;
}

/**
 * The pan (0..1 on each axis) of a cover-cropped photo that keeps the
 * subject box inside the window when it fits, else centres on it. `slack`
 * is how far the oversize photo can move in each axis (photo px beyond the
 * window); `boxPx` is the subject in the same px.
 */
export function panToKeepBox(
  slackX: number, slackY: number,
  window: { w: number; h: number },
  boxPx: { x: number; y: number; w: number; h: number },
  fallback: { x: number; y: number },
): { x: number; y: number; whole: boolean } {
  const axis = (slack: number, win: number, b0: number, bw: number, fb: number) => {
    if (slack <= 0) return { p: fb, whole: bw <= win + 0.5 };
    const centre = Math.max(0, Math.min(slack, b0 + bw / 2 - win / 2));
    if (bw <= win) {
      // Keep the whole box inside: the window's left edge in [b0+bw-win, b0].
      const lo = Math.max(0, b0 + bw - win), hi = Math.min(slack, b0);
      const cur = fb * slack;
      const p = cur >= lo && cur <= hi ? cur : Math.max(lo, Math.min(hi, centre));
      return { p: p / slack, whole: true };
    }
    return { p: centre / slack, whole: false };
  };
  const ax = axis(slackX, window.w, boxPx.x, boxPx.w, fallback.x);
  const ay = axis(slackY, window.h, boxPx.y, boxPx.h, fallback.y);
  return { x: r3(ax.p), y: r3(ay.p), whole: ax.whole && ay.whole };
}
