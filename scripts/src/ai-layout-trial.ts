/**
 * AI layout trial — does Claude improve generated ad sizes?
 *
 * For every local template whose name starts with a prefix (default
 * "[PRODCHECK]": copies of the production Tsunami sizes), this script:
 *   1. renders the current layout ("before") through the app's own exporter,
 *   2. asks Claude Opus 5 — as an art director — to score it against the master
 *      and the shipped reference for that shape family, and to MOVE / SCALE /
 *      CROP / HIDE the existing elements (it cannot add anything),
 *   3. clamps the answer inside the app's own guardrails, saves it as a new
 *      "[AI]" template, renders it ("after"),
 *   4. asks Claude to review before vs after and score both,
 *   5. writes side-by-side PNGs and a report.
 *
 * Run against the auth-bypassed local server:
 *   ANTHROPIC_API_KEY=... pnpm --filter scripts exec tsx src/ai-layout-trial.ts
 * Env: BASE (default http://localhost:8081), PREFIX, LIMIT, OUT (/tmp/ai-trial).
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:8081";
const PREFIX = process.env.PREFIX ?? "[PRODCHECK]";
const LIMIT = Number(process.env.LIMIT ?? 0) || Infinity;
const OUT = process.env.OUT ?? "/tmp/ai-trial";
/** REVIEW_ONLY=1: score and critique each template against the references; change nothing. */
const REVIEW_ONLY = process.env.REVIEW_ONLY === "1";
/** NO_REFS=1: the artwork is not from the Get Ready campaign — judge it on its own. */
const NO_REFS = process.env.NO_REFS === "1";
/** STYLE=getready (default) judges against the Get Ready campaign model; STYLE=brand judges
 *  against the AC brand digital layout style (docs/brand-layout-style.md). */
const STYLE = process.env.STYLE === "brand" ? "brand" : "getready";
const MODEL = "claude-opus-5";
/** Master + shipped references (local template ids). */
const MASTER_ID = Number(process.env.MASTER_ID ?? 478); // AEM Get Ready 384x592 — Tsunami
const REF_PORTRAIT_ID = Number(process.env.REF_PORTRAIT_ID ?? 535); // shipped DV360 300x600 (GWD import)
const REF_WIDE_ID = Number(process.env.REF_WIDE_ID ?? 534); // shipped DV360 970x250 (GWD import)

const client = new Anthropic();

// ---------------------------------------------------------------------------
// App API helpers
// ---------------------------------------------------------------------------
interface Template {
  id: number;
  name: string;
  width: number;
  height: number;
  category: string;
  config: string | Record<string, unknown>;
}
interface El {
  id: string;
  type: string;
  role?: string;
  slot?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fit?: string;
  focusX?: number;
  focusY?: number;
  locked?: boolean;
  [k: string]: unknown;
}

async function api<T>(p: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + p, init);
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${p} → ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}
async function png(p: string): Promise<Buffer> {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(`GET ${p} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
function cfgOf(t: Template): { kind?: string; elements: El[]; [k: string]: unknown } {
  return typeof t.config === "string" ? JSON.parse(t.config) : (t.config as any);
}
/** Claude's image limit is ~8000px on the long edge and best under ~1.15MP; downscale. */
async function forVision(buf: Buffer, maxEdge = 1200): Promise<string> {
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const out =
    Math.max(w, h) > maxEdge ? await sharp(buf).resize({ width: w >= h ? maxEdge : undefined, height: h > w ? maxEdge : undefined }).png().toBuffer() : buf;
  return out.toString("base64");
}

// ---------------------------------------------------------------------------
// Schemas Claude must answer in
// ---------------------------------------------------------------------------
const Adjust = z.object({
  score_before: z.number().describe("0-100: how close the current layout is to what the agency would ship for this size"),
  verdict: z.enum(["pass", "adjust", "designer"]),
  issues: z.array(z.string()),
  elements: z.array(
    z.object({
      id: z.string(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      fontSize: z.number().nullable(),
      hidden: z.boolean(),
      focusX: z.number().nullable().describe("0-1 horizontal focal point for image elements, else null"),
      focusY: z.number().nullable(),
      reason: z.string(),
    }),
  ),
  summary: z.string(),
});
type AdjustT = z.infer<typeof Adjust>;
const Review = z.object({
  score_before: z.number(),
  score_after: z.number(),
  better: z.boolean(),
  remaining_issues: z.array(z.string()),
  summary: z.string(),
});
type ReviewT = z.infer<typeof Review>;
const SenseCheck = z.object({
  score: z.number().describe("0-100 against what the agency would ship"),
  ship: z.enum(["yes", "with-fixes", "no"]),
  defects: z.array(z.object({ severity: z.enum(["blocker", "major", "minor"]), what: z.string(), where: z.string() })),
  summary: z.string(),
});

function loadBrandStyleDoc(): string {
  const candidates = ["../docs/brand-layout-style.md", "docs/brand-layout-style.md"];
  for (const c of candidates) {
    try {
      return fs.readFileSync(path.resolve(c), "utf8");
    } catch {
      /* try next */
    }
  }
  return "";
}

const SYSTEM_BRAND = `You are the senior designer for Auckland Council's brand studio, sense-checking digital creative built in the council's house layout style (not a named campaign).

You never draw or invent anything. You judge whether the EXISTING elements sit where the house style puts them, and when asked to adjust you only move, scale, crop or hide them. Copy text is fixed; placeholder copy such as "HEADLINE" or "Body copy here." on a master is expected and is not a defect.

The house style, measured from the designer's master (treat as ground truth):
${loadBrandStyleDoc() || "(style document missing — judge against the master image only)"}


Pōhutukawa mark, anther and pattern rules (June 2025 guidelines — apply to every layout):
- The logo is the colour pōhutukawa in a white square tile, mark centred with 1/8 clearspace; tile = short axis ÷ 4/6/8 (print) or ÷ 1/2/4 (digital); placed bottom-right; never redrawn, recoloured, distorted, cropped or boxed again. 1080×1080 social tiles carry NO logo.
- The anther (large circle on a straight stem, incl. the koru photo frame) has its stem from the left, lower-left 45° or bottom centre — never lower-right; never covered by the tile; a cropped anther needs design review.
- Kotahitanga patterns ≤ 30% opacity as background texture; the full-colour stamp row sits NEXT TO the tile and never runs under it.

Score honestly against that style. "pass"/"yes" means you would send it as is.`;

const SYSTEM_GETREADY = `You are the senior art director for Auckland Council's "Get Ready" emergency-preparedness campaign, reviewing machine-generated ad sizes before they go to the client.

You never draw or invent anything. You only decide where the EXISTING elements sit: position, size, font size, photo crop focus, and whether a secondary element should be hidden because there is no room. Copy text is fixed. The element set is fixed.

Rules measured from the shipped AC creative (treat as ground truth):
- Composition axis follows the canvas: tall → photo stacked above a solid Ocean-blue message panel; wide → photo left, panel right. A kotahitanga pattern band divides the two zones.
- Copy never floats over busy photography without the scrim; the panel carries "Make a plan today", the search pill and the logo lockup.
- The headline is the display-type word (e.g. "tsu:na:mi"): on the tall DV360 it is ~19% of the short axis high and sits just above the strapline; on the wide DV360 ~38%. Headline + strapline block centre: with a foreground cut-out ~47% (tall) / 36% (wide) down the photo zone; without one ~56% / 49% — drop it onto the subject so the photo never reads as empty.
- The search pill is 181×43 at DV360 scale: a legibility floor, not a proportional element. Centred-low on tall formats, right-centred in the panel on wide.
- Photos are cover-cropped oversize and panned to place the subject (the wave, or the flooded car). Never letterbox.
- Nothing may be cropped by the canvas edge except the photo. Keep text fully inside the canvas with a margin ≈ 6% of the short axis.
- Only hide "message" or "subheadline" elements, and only when the panel genuinely cannot hold them legibly.


Pōhutukawa mark, anther and pattern rules (June 2025 guidelines — apply to every layout):
- The logo is the colour pōhutukawa in a white square tile, mark centred with 1/8 clearspace; tile = short axis ÷ 4/6/8 (print) or ÷ 1/2/4 (digital); placed bottom-right; never redrawn, recoloured, distorted, cropped or boxed again. 1080×1080 social tiles carry NO logo.
- The anther (large circle on a straight stem, incl. the koru photo frame) has its stem from the left, lower-left 45° or bottom centre — never lower-right; never covered by the tile; a cropped anther needs design review.
- Kotahitanga patterns ≤ 30% opacity as background texture; the full-colour stamp row sits NEXT TO the tile and never runs under it.

Score honestly. "pass" means you would send it as is; "adjust" means your element list fixes it; "designer" means the format needs a human because no adjustment of these pieces gets it right.`;

const SYSTEM = STYLE === "brand" ? SYSTEM_BRAND : SYSTEM_GETREADY;

function describeElements(els: El[]): string {
  return els
    .map((e) => {
      const kind = e.slot ?? e.role ?? e.type;
      const geo = `x=${Math.round(e.x)} y=${Math.round(e.y)} w=${Math.round(e.w)} h=${Math.round(e.h)}`;
      if (e.type === "text") return `- ${e.id} [text/${kind}] ${geo} fontSize=${e.fontSize ?? "?"} font=${e.fontFamily ?? "brand"} text="${String(e.text ?? "").replace(/\s+/g, " ").slice(0, 40)}"`;
      if (e.type === "image") return `- ${e.id} [image/${kind}] ${geo} fit=${e.fit ?? "cover"} focus=${e.focusX ?? 0.5},${e.focusY ?? 0.45}`;
      return `- ${e.id} [${e.type}/${kind}] ${geo}`;
    })
    .join("\n");
}

/** Clamp Claude's answer inside the app's guardrails and apply it. */
function applyAdjust(cfg: { elements: El[] }, W: number, H: number, a: AdjustT): { elements: El[]; changes: string[] } {
  const byId = new Map(cfg.elements.map((e) => [e.id, e]));
  const changes: string[] = [];
  const protectedKinds = new Set(["photo", "product", "headline", "cta", "lockup", "panel", "band"]);
  const out: El[] = [];
  const decided = new Map(a.elements.map((e) => [e.id, e]));
  for (const el of cfg.elements) {
    const d = decided.get(el.id);
    if (!d) {
      out.push(el);
      continue;
    }
    const kind = String(el.slot ?? el.role ?? el.type);
    if (d.hidden) {
      if (protectedKinds.has(kind) || el.type === "rect") {
        out.push(el); // never hide structure
        continue;
      }
      changes.push(`${el.id}: hidden (${d.reason})`);
      continue;
    }
    const n: El = { ...el };
    const isPhoto = el.type === "image" && (kind === "photo" || kind === "product");
    // Photos may bleed; everything else stays inside the canvas.
    const minX = isPhoto ? -W : 0;
    const minY = isPhoto ? -H : 0;
    n.w = Math.max(1, Math.round(d.w));
    n.h = Math.max(1, Math.round(d.h));
    n.x = Math.round(Math.min(Math.max(d.x, minX), isPhoto ? W : Math.max(0, W - n.w)));
    n.y = Math.round(Math.min(Math.max(d.y, minY), isPhoto ? H : Math.max(0, H - n.h)));
    if (el.type === "text" && d.fontSize != null) n.fontSize = Math.max(8, Math.min(Math.round(d.fontSize), Math.round(Math.min(W, H))));
    if (el.type === "image" && d.focusX != null && d.focusY != null) {
      n.focusX = Math.min(1, Math.max(0, d.focusX));
      n.focusY = Math.min(1, Math.max(0, d.focusY));
    }
    const moved = n.x !== el.x || n.y !== el.y || n.w !== el.w || n.h !== el.h || n.fontSize !== el.fontSize || n.focusX !== el.focusX || n.focusY !== el.focusY;
    if (moved) changes.push(`${el.id}: ${Math.round(el.x)},${Math.round(el.y)} ${Math.round(el.w)}×${Math.round(el.h)}${el.fontSize ? ` ${el.fontSize}px` : ""} → ${n.x},${n.y} ${n.w}×${n.h}${n.fontSize ? ` ${n.fontSize}px` : ""} (${d.reason})`);
    out.push(n);
  }
  return { elements: out, changes };
}

function parseBlock<S extends z.ZodTypeAny>(schema: S, resp: Anthropic.Beta.Messages.BetaMessage): z.infer<S> {
  if (resp.stop_reason === "refusal") throw new Error(`refused: ${JSON.stringify(resp.stop_details)}`);
  const text = resp.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`schema: ${parsed.error.message}`);
  return parsed.data;
}

async function ask<S extends z.ZodTypeAny>(schema: S, content: Anthropic.Beta.Messages.BetaContentBlockParam[]): Promise<{ data: z.infer<S>; usage: Anthropic.Beta.Messages.BetaUsage }> {
  const resp = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(schema) },
    messages: [{ role: "user", content }],
  });
  return { data: parseBlock(schema, resp), usage: resp.usage };
}

const img = (data: string): Anthropic.Beta.Messages.BetaImageBlockParam => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });

// ---------------------------------------------------------------------------
async function sideBySide(before: Buffer, after: Buffer, file: string) {
  const target = 700;
  const a = await sharp(before).resize({ width: target }).png().toBuffer();
  const b = await sharp(after).resize({ width: target }).png().toBuffer();
  const ma = await sharp(a).metadata();
  const mb = await sharp(b).metadata();
  const h = Math.max(ma.height ?? 0, mb.height ?? 0);
  await sharp({ create: { width: target * 2 + 24, height: h + 16, channels: 4, background: "#e5e7eb" } })
    .composite([
      { input: a, left: 8, top: 8 },
      { input: b, left: target + 16, top: 8 },
    ])
    .png()
    .toFile(file);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const all = await api<Template[]>("/api/templates");
  const targets = all.filter((t) => t.name.startsWith(PREFIX)).sort((a, b) => a.width / a.height - b.width / b.height).slice(0, LIMIT);
  if (targets.length === 0) throw new Error(`no templates with prefix ${PREFIX}`);
  console.log(`${targets.length} sizes; references: master ${MASTER_ID}, portrait ${REF_PORTRAIT_ID}, wide ${REF_WIDE_ID}`);

  const masterPng = await forVision(await png(`/api/templates/${MASTER_ID}/export.png`));
  const refPortrait = await forVision(await png(`/api/templates/${REF_PORTRAIT_ID}/export.png`));
  const refWide = await forVision(await png(`/api/templates/${REF_WIDE_ID}/export.png`));

  const rows: string[] = [];
  let inTok = 0;
  let outTok = 0;
  const queue = [...targets];
  const worker = async () => {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      const label = `${t.width}x${t.height}`;
      try {
        const cfg = cfgOf(t);
        const W = t.width;
        const H = t.height;
        const before = await png(`/api/templates/${t.id}/export.png`);
        const ratio = W / H;
        const family = ratio < 0.8 ? "portrait" : ratio >= 2 ? "wide" : ratio > 1.25 ? "landscape" : "square";
        const familyRef = family === "portrait" ? refPortrait : family === "wide" || family === "landscape" ? refWide : null;

        if (REVIEW_ONLY) {
          const sc = await ask(SenseCheck, [
            ...(NO_REFS
              ? []
              : [
                  { type: "text", text: "Reference: the campaign MASTER (384×592 digital OOH)." } as const,
                  img(masterPng),
                  ...(familyRef ? [{ type: "text", text: `Reference: the agency's shipped ${family === "portrait" ? "300×600" : "970×250"} DV360 banner for this shape family.` } as const, img(familyRef)] : []),
                ]),
            { type: "text", text: `ARTWORK TO SENSE-CHECK — "${t.name}", ${label}. Elements:\n${describeElements(cfg.elements)}` },
            img(await forVision(before)),
            {
              type: "text",
              text: "Sense-check this artwork as the art director: doubled or ghosted copy, wrong or substituted typeface, missing photo or subject cropped out, clipped text, pill off spec, logo issues, brand-colour problems, anything the client would bounce. Be specific about where.",
            },
          ]);
          inTok += sc.usage.input_tokens;
          outTok += sc.usage.output_tokens;
          fs.writeFileSync(path.join(OUT, `${label}-${t.id}-before.png`), before);
          fs.writeFileSync(path.join(OUT, `${label}-${t.id}.json`), JSON.stringify({ template: t.id, name: t.name, senseCheck: sc.data }, null, 2));
          const line = `| ${t.id} ${label} | ${sc.data.ship} | ${sc.data.score} | ${sc.data.defects.length} | ${sc.data.defects.map((d) => `${d.severity}: ${d.what}`).join("; ").replace(/\|/g, "/").slice(0, 220)} |`;
          rows.push(line);
          console.log(line);
          continue;
        }
        const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [
          { type: "text", text: "Image 1 — the campaign MASTER (384×592 digital OOH) this size was generated from:" },
          img(masterPng),
        ];
        if (familyRef) {
          content.push({ type: "text", text: `Image 2 — the agency's SHIPPED ${family === "portrait" ? "300×600" : "970×250"} DV360 banner: the reference for this shape family.` });
          content.push(img(familyRef));
        }
        content.push({ type: "text", text: `Image ${familyRef ? 3 : 2} — the CURRENT machine-generated layout for ${label} that you are reviewing:` });
        content.push(img(await forVision(before)));
        content.push({
          type: "text",
          text:
            `Canvas: ${W}×${H} px (${family}). Elements (canvas px, origin top-left, document order = z-order):\n${describeElements(cfg.elements)}\n\n` +
            `Return every element you want changed with its FULL new geometry (unchanged elements may be omitted). ` +
            `Use the reference to judge scale and placement, not to copy it: this canvas is ${label}.`,
        });
        const a = await ask(Adjust, content);
        inTok += a.usage.input_tokens;
        outTok += a.usage.output_tokens;

        let afterId: number | null = null;
        let after: Buffer | null = null;
        let changes: string[] = [];
        if (a.data.verdict === "adjust" && a.data.elements.length > 0) {
          const applied = applyAdjust(cfg as any, W, H, a.data);
          changes = applied.changes;
          const created = await api<Template>("/api/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: `[AI] ${t.name.replace(PREFIX, "").trim()}`,
              category: "wip",
              width: W,
              height: H,
              description: `AI layout trial from template ${t.id}`,
              config: { ...cfg, elements: applied.elements, adaptNotes: [...((cfg.adaptNotes as string[]) ?? []), `AI adjust: ${a.data.summary}`] },
            }),
          });
          afterId = created.id;
          after = await png(`/api/templates/${afterId}/export.png`);
        }

        let review: ReviewT | null = null;
        if (after) {
          const r = await ask(Review, [
            { type: "text", text: `Reference master:` },
            img(masterPng),
            ...(familyRef ? [{ type: "text", text: "Shipped reference for this shape:" } as const, img(familyRef)] : []),
            { type: "text", text: `BEFORE (machine layout, ${label}):` },
            img(await forVision(before)),
            { type: "text", text: `AFTER (your adjustments applied and rendered by the app):` },
            img(await forVision(after)),
            { type: "text", text: "Score both 0-100 against what the agency would ship. Is AFTER better? List what still needs a designer." },
          ]);
          inTok += r.usage.input_tokens;
          outTok += r.usage.output_tokens;
          review = r.data;
          await sideBySide(before, after, path.join(OUT, `${label}.png`));
        } else {
          fs.writeFileSync(path.join(OUT, `${label}-before.png`), before);
        }
        const line = `| ${label} | ${a.data.verdict} | ${a.data.score_before} | ${review ? review.score_after : "—"} | ${changes.length} | ${(review?.summary ?? a.data.summary).replace(/\|/g, "/").slice(0, 160)} |`;
        rows.push(line);
        console.log(line);
        fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify({ template: t.id, afterId, adjust: a.data, changes, review }, null, 2));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        rows.push(`| ${label} | error | — | — | — | ${msg.slice(0, 160)} |`);
        console.error(label, msg);
      }
    }
  };
  await Promise.all([worker(), worker()]);

  rows.sort();
  const cost = (inTok * 5 + outTok * 25) / 1_000_000;
  const report = [
    `# AI layout trial — ${new Date().toISOString()}`,
    ``,
    `Model ${MODEL}; ${targets.length} sizes; tokens in ${inTok} / out ${outTok}; est. cost $${cost.toFixed(2)}.`,
    ``,
    REVIEW_ONLY ? `| Template | Ship? | Score | Defects | Findings |` : `| Size | Verdict | Before | After | Changes | Summary |`,
    REVIEW_ONLY ? `|---|---|---|---|---|` : `|---|---|---|---|---|---|`,
    ...rows,
    ``,
    `Side-by-side PNGs (before | after) and per-size JSON are in ${OUT}.`,
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "report.md"), report);
  console.log(`\n${report}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
