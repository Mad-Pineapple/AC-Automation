import sharp from "sharp";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";
import { toObjectEntityPath } from "./assetImages";
import { ObjectStorageService } from "./objectStorage";

const objectStorageService = new ObjectStorageService();

/**
 * Brand-guideline compliance for a generated asset.
 *
 * Two independent checkers, chosen per asset type:
 *  - HTML assets (html_banner, animated_social) are judged DETERMINISTICALLY by
 *    parsing the colors + fonts out of the HTML source and comparing them to the
 *    brand palette (deltaE76, neutrals allowed). No AI, no headless browser.
 *  - Image assets (static backgrounds) are judged by a gpt-4o VISION verdict,
 *    because AI backgrounds are photographic and a strict hex comparison would
 *    false-fail nearly everything. Extracted dominant colors are passed to the
 *    model as supporting evidence only.
 *
 * Every check is best-effort: on any checker error the verdict is "skipped" so a
 * checker bug never blocks (or destroys) an expensive generation run.
 */
export type ComplianceStatus = "passed" | "failed" | "skipped";

export interface ComplianceVerdict {
  status: ComplianceStatus;
  score: number; // 0-100
  issues: string[];
}

export interface CompliangeBrand {
  name: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  guidelines?: string | null;
  toneOfVoice?: string;
  industry?: string | null;
}

interface AssetForCheck {
  templateSize: string;
  htmlContent?: string | null;
  imageUrl?: string | null;
}

// Pass thresholds (see architect plan).
const HTML_COLOR_RATIO_PASS = 0.8; // >=80% of non-neutral colors must be on-brand
const HTML_DELTA_E_TOLERANCE = 12; // a color is "on-brand" within this deltaE76
const IMAGE_SCORE_PASS = 70; // vision score >= 70 passes
const CHECK_TIMEOUT_MS = 30_000;

const HTML_TEMPLATE_SIZES = new Set(["html_banner", "animated_social"]);
export function isHtmlAsset(templateSize: string): boolean {
  return HTML_TEMPLATE_SIZES.has(templateSize);
}

// ---- color math ------------------------------------------------------------

interface Rgb { r: number; g: number; b: number; }
interface Lab { L: number; a: number; b: number; }

function hexToRgb(hex: string): Rgb | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const to = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToLab({ r, g, b }: Rgb): Lab {
  // sRGB -> linear
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const R = lin(r), G = lin(g), B = lin(b);
  // linear RGB -> XYZ (D65)
  const X = R * 0.4124 + G * 0.3576 + B * 0.1805;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  // XYZ -> Lab (D65 reference white)
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / 0.95047), fy = f(Y / 1.0), fz = f(Z / 1.08883);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function deltaE76(a: Lab, b: Lab): number {
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

// A color is "neutral" (white/black/grey) when it has little chroma or is very
// light/dark. Neutrals are always allowed regardless of the brand palette.
function isNeutral(lab: Lab): boolean {
  const chroma = Math.sqrt(lab.a ** 2 + lab.b ** 2);
  return chroma < 8 || lab.L > 95 || lab.L < 8;
}

function brandLabs(brand: CompliangeBrand): Lab[] {
  const hexes = [
    brand.primaryColor,
    brand.secondaryColor,
    brand.accentColor,
    brand.backgroundColor,
    brand.textColor,
  ];
  // The brand's stored guidelines are the authoritative palette source (the
  // generators are told to use every hex listed there — e.g. an extended
  // core/vibrant/muted palette). Honour those hexes too, or the checker
  // false-fails creative that used an approved palette colour outside the
  // five brand fields.
  if (brand.guidelines) {
    const guidelineHexes = brand.guidelines.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    hexes.push(...guidelineHexes.slice(0, 32));
  }
  return hexes
    .map((c) => hexToRgb(c))
    .filter((c): c is Rgb => c !== null)
    .map(rgbToLab);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// ---- HTML compliance (deterministic) ---------------------------------------

function extractHtmlColors(html: string): Rgb[] {
  const out: Rgb[] = [];
  const hexRe = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  const rgbRe = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(html)) !== null) {
    const c = hexToRgb(`#${m[1]}`);
    if (c) out.push(c);
  }
  while ((m = rgbRe.exec(html)) !== null) {
    const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
    if (r <= 255 && g <= 255 && b <= 255) out.push({ r, g, b });
  }
  return out;
}

// Generic CSS font families that are an acceptable fallback even without the
// brand font present. Deliberately excludes cursive/fantasy so an obviously
// off-brand named font stack still fails.
const GENERIC_FONT_FAMILIES = [
  "sans-serif", "serif", "monospace", "system-ui",
  "ui-sans-serif", "ui-serif", "ui-monospace", "-apple-system",
];

function normalizeFontToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function checkFont(html: string, brand: CompliangeBrand): { ok: boolean; sample: string | null } {
  const decls: string[] = [];
  const declRe = /font-family\s*:\s*([^;}"]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(html)) !== null) decls.push(m[1].trim());
  // Google Fonts @import families also count as declaring the brand typeface.
  const importRe = /family=([^:&"')]+)/gi;
  const importFamilies: string[] = [];
  while ((m = importRe.exec(html)) !== null) importFamilies.push(decodeURIComponent(m[1].replace(/\+/g, " ")));

  const combined = [...decls, ...importFamilies].join(" ");
  if (combined.trim() === "") return { ok: true, sample: null }; // no fonts declared -> don't fail

  const brandPresent = normalizeFontToken(combined).includes(normalizeFontToken(brand.fontFamily));
  const genericPresent = GENERIC_FONT_FAMILIES.some((g) => new RegExp(`(^|[^a-z-])${g}([^a-z-]|$)`, "i").test(combined));
  return { ok: brandPresent || genericPresent, sample: decls[0] ?? importFamilies[0] ?? null };
}

export function checkHtmlCompliance(html: string, brand: CompliangeBrand): ComplianceVerdict {
  const palette = brandLabs(brand);
  const colors = extractHtmlColors(html);

  // Dedupe by hex so a single repeated color can't skew the ratio.
  const distinct = new Map<string, Rgb>();
  for (const c of colors) distinct.set(rgbToHex(c), c);

  const issues: string[] = [];
  let nonNeutral = 0;
  let onBrand = 0;
  const offBrandExamples: { hex: string; delta: number }[] = [];

  for (const [hex, rgb] of distinct) {
    const lab = rgbToLab(rgb);
    if (isNeutral(lab)) continue;
    nonNeutral++;
    let min = Infinity;
    for (const bl of palette) min = Math.min(min, deltaE76(lab, bl));
    if (min <= HTML_DELTA_E_TOLERANCE) onBrand++;
    else offBrandExamples.push({ hex, delta: Math.round(min) });
  }

  const colorRatio = nonNeutral === 0 ? 1 : onBrand / nonNeutral;
  const font = checkFont(html, brand);

  if (offBrandExamples.length > 0) {
    for (const ex of offBrandExamples.slice(0, 6)) {
      issues.push(`Off-brand color ${ex.hex} (nearest brand color differs by ΔE ${ex.delta}, tolerance ${HTML_DELTA_E_TOLERANCE}).`);
    }
    if (offBrandExamples.length > 6) issues.push(`…and ${offBrandExamples.length - 6} more off-brand color(s).`);
  }
  if (!font.ok) {
    issues.push(`Off-brand font${font.sample ? ` "${font.sample}"` : ""}; brand font is "${brand.fontFamily}".`);
  }

  const base = Math.round(colorRatio * 100);
  const score = font.ok ? base : Math.min(base, 55);
  const passed = colorRatio >= HTML_COLOR_RATIO_PASS && font.ok;
  return { status: passed ? "passed" : "failed", score, issues };
}

// ---- image compliance (gpt-4o vision) --------------------------------------

/** Load image bytes from object storage (preferred) or an http(s) URL. */
async function loadImageBytes(imageUrl: string): Promise<Buffer | null> {
  const objectPath = toObjectEntityPath(imageUrl);
  if (objectPath) {
    const file = await objectStorageService.getObjectEntityFile(objectPath);
    const [raw] = await file.download();
    return raw;
  }
  if (/^https?:\/\//i.test(imageUrl)) {
    const resp = await fetch(imageUrl);
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  }
  if (imageUrl.startsWith("data:")) {
    const comma = imageUrl.indexOf(",");
    if (comma !== -1) return Buffer.from(imageUrl.slice(comma + 1), "base64");
  }
  return null;
}

/** Best-effort dominant-color extraction (supporting evidence for the model). */
async function extractDominantColors(buffer: Buffer, max = 5): Promise<string[]> {
  try {
    const { data, info } = await sharp(buffer)
      .resize(48, 48, { fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const counts = new Map<string, number>();
    const step = info.channels;
    for (let i = 0; i + 2 < data.length; i += step) {
      const r = Math.round(data[i] / 24) * 24;
      const g = Math.round(data[i + 1] / 24) * 24;
      const b = Math.round(data[i + 2] / 24) * 24;
      const key = `${r},${g},${b}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([k]) => {
        const [r, g, b] = k.split(",").map(Number);
        return rgbToHex({ r, g, b });
      });
  } catch {
    return [];
  }
}

export async function checkImageCompliance(imageUrl: string, brand: CompliangeBrand): Promise<ComplianceVerdict> {
  const raw = await loadImageBytes(imageUrl);
  if (!raw) return { status: "skipped", score: 0, issues: [] };

  // Downscale for the vision call; source art can be multi-MB.
  const jpeg = await sharp(raw)
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  const dominant = await extractDominantColors(raw);

  const palette = [
    `Primary ${brand.primaryColor}`,
    `Secondary ${brand.secondaryColor}`,
    `Accent ${brand.accentColor}`,
    `Background ${brand.backgroundColor}`,
    `Text ${brand.textColor}`,
  ].join(", ");

  const promptText = `You are a strict brand-compliance reviewer for "${brand.name}". Assess whether this advertising background image is on-brand.

Brand color palette: ${palette}.
${brand.toneOfVoice ? `Brand tone: ${brand.toneOfVoice}.\n` : ""}${brand.guidelines ? `Brand visual guidelines:\n${brand.guidelines.slice(0, 1200)}\n` : ""}${dominant.length ? `Detected dominant colors in the image: ${dominant.join(", ")}.\n` : ""}
Judge PRIMARILY on whether the image's dominant colors and overall mood align with the brand palette and guidelines. Photographic realism and natural tones (sky, skin, foliage) are acceptable as long as the color story is clearly built around the brand palette rather than clashing with it.

Return ONLY a JSON object:
{"score": <0-100 integer, how well the image matches the brand's palette and visual identity>, "onBrand": <boolean>, "issues": [<short strings naming specific brand violations, empty if fully on-brand>]}
A score of ${IMAGE_SCORE_PASS} or above means acceptable. No commentary, just the JSON.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: promptText },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: 500,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content);
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.filter((i: unknown): i is string => typeof i === "string").slice(0, 8)
    : [];
  const passed = score >= IMAGE_SCORE_PASS;
  return { status: passed ? "passed" : "failed", score, issues };
}

// ---- dispatcher ------------------------------------------------------------

/**
 * Check a single asset against its brand. Dispatches by asset type, isolates the
 * checker in its own timeout + try/catch, and returns "skipped" on any error so
 * a checker failure never blocks approval or aborts a generation run.
 */
export async function checkAssetCompliance(
  asset: AssetForCheck,
  brand: CompliangeBrand,
): Promise<ComplianceVerdict> {
  try {
    if (isHtmlAsset(asset.templateSize)) {
      if (!asset.htmlContent) return { status: "skipped", score: 0, issues: [] };
      return await withTimeout(
        Promise.resolve().then(() => checkHtmlCompliance(asset.htmlContent!, brand)),
        CHECK_TIMEOUT_MS,
        "HTML compliance",
      );
    }
    if (asset.imageUrl) {
      return await withTimeout(checkImageCompliance(asset.imageUrl, brand), CHECK_TIMEOUT_MS, "image compliance");
    }
    // Nothing generated to validate (e.g. no AI image) — not a violation.
    return { status: "skipped", score: 0, issues: [] };
  } catch (err) {
    logger.warn({ err, templateSize: asset.templateSize }, "Compliance check errored; marking skipped");
    return { status: "skipped", score: 0, issues: [] };
  }
}

/** Serialize issues for storage in assets.complianceIssues (JSON text column). */
export function serializeIssues(issues: string[]): string {
  return JSON.stringify(issues ?? []);
}
