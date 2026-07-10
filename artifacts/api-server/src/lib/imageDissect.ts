/**
 * Image dissection: turn an uploaded finished creative (a raster image) into an
 * editable freeform template ("learn" its layout). This powers the Knowledge
 * feature — a learned creative is just a freeform template (category
 * "knowledge") whose layout was recovered from the artwork, so it can later be
 * reused in a brief by swapping in new copy + imagery.
 *
 * Strategy (best-effort — the review UI lets the user fix anything):
 *  - dimensions: real pixel size read from the bytes via `sharp` (orientation
 *    aware). The vision model is NOT trusted for absolute pixels.
 *  - layout: a gpt-4o vision call returns elements with NORMALIZED 0..1 coords
 *    (top-left origin) which we scale to real px. Text gets role + content +
 *    color + align + a font size expressed as a fraction of canvas height.
 *  - background: FreeformCanvas always renders white, so a non-white background
 *    is emitted as a full-canvas rect behind everything.
 *  - images: the artwork's embedded photos can't be extracted, so image
 *    elements are placeholders (src:null) carrying only a role; the product /
 *    logo slot is filled at brief time. That is exactly the reuse workflow.
 *
 * All model output is piped through `normalizeFreeformConfig`, which bounds
 * colors, sizes and srcs before they ever reach a React `style` attribute.
 */
import sharp from "sharp";
import { openai } from "@workspace/integrations-openai-ai-server";
import { ObjectStorageService } from "./objectStorage";
import {
  normalizeFreeformConfig,
  type FreeformConfig,
  type FreeformElement,
} from "./freeform";

const objectStorageService = new ObjectStorageService();

const MAX_EDGE = 1024; // downscale long edge before sending to the vision model
const MIN_DIM = 16;
const MAX_DIM = 8000;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export interface DissectResult {
  name: string;
  width: number;
  height: number;
  config: FreeformConfig;
  warnings: string[];
}

function clampDim(n: number, fallback: number): number {
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(Math.max(MIN_DIM, Math.min(MAX_DIM, n)));
}

function isWhite(hex: string): boolean {
  return /^#(?:fff|ffffff)$/i.test(hex.trim());
}

function safeHex(v: unknown, fallback: string): string {
  return typeof v === "string" && HEX.test(v.trim()) ? v.trim() : fallback;
}

/** Read the full object bytes for a `/objects/...` path. */
async function readObjectBytes(objectPath: string): Promise<Buffer> {
  const file = await objectStorageService.getObjectEntityFile(objectPath);
  const [bytes] = await file.download();
  return bytes;
}

const VISION_PROMPT = `You are a senior art director reverse-engineering the LAYOUT of a finished marketing creative so it can be reused as a reusable template.

Look at the image and return ONLY a JSON object describing the layout as positioned blocks. Use a coordinate system where the top-left of the image is (0,0) and the bottom-right is (1,1). All x, y, w, h values are FRACTIONS of the image width/height in the range 0..1.

Return this exact shape:
{
  "name": "2-4 word descriptive name for this creative (e.g. 'Food Scraps Promo')",
  "background": "#rrggbb dominant background color, or '#ffffff' if it is white/plain",
  "elements": [
    {
      "type": "text" | "image" | "rect",
      "x": 0..1, "y": 0..1, "w": 0..1, "h": 0..1,
      // for type "text":
      "role": "headline" | "subhead" | "body" | "cta" | "other",
      "text": "the exact text content",
      "color": "#rrggbb text color",
      "align": "left" | "center" | "right",
      "fontWeight": 400 or 700,
      "fontSizePct": number  // cap height of the text as a fraction of the IMAGE height, e.g. 0.09 for a big headline
      // for type "image" (a photo/illustration placeholder — do NOT try to read its pixels):
      "role": "product" | "logo" | "decoration"
      // for type "rect" (a solid colored block / button background / panel):
      "fill": "#rrggbb"
    }
  ]
}

Rules:
- Identify every distinct text block, photo/product area, logo, and solid color block.
- A button is usually a "rect" with a short "text" (role "cta") on top of it — emit BOTH.
- Use "product" for the main hero photo/subject, "logo" for the brand mark, "decoration" for other imagery.
- Be faithful to positions and sizes; approximate is fine.
- Do NOT include the overall background as an element here (it is captured separately via "background").
- Return ONLY the JSON, no commentary.`;

interface RawEl {
  type?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  role?: unknown;
  text?: unknown;
  color?: unknown;
  align?: unknown;
  fontWeight?: unknown;
  fontSizePct?: unknown;
  fill?: unknown;
}

/**
 * Dissect an uploaded image (object-storage path) into a draft freeform
 * template. Throws on unreadable input or a vision failure — the route maps
 * that to a 422.
 */
export async function dissectImageToTemplate(objectPath: string): Promise<DissectResult> {
  const bytes = await readObjectBytes(objectPath);

  // Real pixel dimensions (orientation aware).
  const meta = await sharp(bytes).metadata();
  let width = meta.width ?? 0;
  let height = meta.height ?? 0;
  if (meta.orientation && meta.orientation >= 5) {
    [width, height] = [height, width];
  }

  // Downscaled, auto-oriented JPEG for the vision call.
  const { data: resized, info } = await sharp(bytes)
    .rotate()
    .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer({ resolveWithObject: true });

  // Fall back to resized dims (scaled by the reduction ratio) if metadata was missing.
  if (!width || !height) {
    width = info.width;
    height = info.height;
  }
  const W = clampDim(width, 1080);
  const H = clampDim(height, 1080);

  const dataUrl = `data:image/jpeg;base64,${resized.toString("base64")}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 3000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: VISION_PROMPT },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  let parsed: { name?: unknown; background?: unknown; elements?: unknown };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Vision model returned non-JSON output");
  }

  const rawElements: RawEl[] = Array.isArray(parsed.elements) ? (parsed.elements as RawEl[]) : [];
  const warnings: string[] = [];

  const toPx = (v: unknown, span: number): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    // Tolerate the model occasionally returning percentages (0..100) or pixels.
    const frac = n > 1.5 ? (n > 100 ? n / span : n / 100) : n;
    return Math.round(frac * span);
  };

  const rects: FreeformElement[] = [];
  const images: FreeformElement[] = [];
  const texts: FreeformElement[] = [];

  rawElements.forEach((el, i) => {
    const x = toPx(el.x, W);
    const y = toPx(el.y, H);
    const w = Math.max(1, toPx(el.w, W));
    const h = Math.max(1, toPx(el.h, H));

    if (el.type === "text") {
      const text = String(el.text ?? "").trim();
      if (!text) return;
      const pct = Number(el.fontSizePct);
      const fontSize = Number.isFinite(pct) && pct > 0 ? Math.max(8, Math.round(pct * H)) : Math.max(12, Math.round(h * 0.7));
      const role = ["headline", "subhead", "body", "cta", "other"].includes(String(el.role))
        ? (el.role as string)
        : "body";
      const align = ["left", "center", "right"].includes(String(el.align)) ? (el.align as string) : "left";
      texts.push({
        id: `txt_${i}`,
        type: "text",
        role,
        text,
        x,
        y,
        w,
        h: Math.max(h, fontSize),
        fontSize,
        fontWeight: Number(el.fontWeight) >= 600 ? 700 : 400,
        color: safeHex(el.color, "#111827"),
        align,
        lineHeight: 1.2,
      } as unknown as FreeformElement);
    } else if (el.type === "image") {
      const role = ["product", "logo", "decoration"].includes(String(el.role))
        ? (el.role as string)
        : "decoration";
      images.push({
        id: `img_${i}`,
        type: "image",
        role,
        src: null,
        x,
        y,
        w,
        h,
      } as unknown as FreeformElement);
    } else if (el.type === "rect") {
      rects.push({
        id: `rect_${i}`,
        type: "rect",
        fill: safeHex(el.fill, "#e5e7eb"),
        x,
        y,
        w,
        h,
      } as unknown as FreeformElement);
    }
  });

  // Background: FreeformCanvas renders white, so emit a full-canvas rect behind
  // everything when the artwork has a non-white background.
  const background = safeHex(parsed.background, "#ffffff");
  const bgElements: FreeformElement[] =
    !isWhite(background)
      ? [
          {
            id: "bg",
            type: "rect",
            fill: background,
            x: 0,
            y: 0,
            w: W,
            h: H,
          } as unknown as FreeformElement,
        ]
      : [];

  if (texts.length === 0 && images.length === 0 && rects.length === 0) {
    warnings.push("No layout blocks were detected — you can add elements manually before saving.");
  } else {
    warnings.push("Layout, text and colors are AI best-guesses — review and adjust before saving.");
    warnings.push("Image areas are placeholders; the actual imagery is supplied later from your brief.");
  }

  // z-order: background -> rects (back) -> images -> text (front).
  const config = normalizeFreeformConfig({
    kind: "freeform",
    elements: [...bgElements, ...rects, ...images, ...texts],
  });

  const name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim().slice(0, 80) : "Learned creative";

  return { name, width: W, height: H, config, warnings };
}
