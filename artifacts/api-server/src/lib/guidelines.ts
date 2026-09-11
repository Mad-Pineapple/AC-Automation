/**
 * Element-aware brand guidelines.
 *
 * The brand's guidelines are indexed into passages tagged by topic. When a
 * piece is checked or built, the studio looks at which elements are on it
 * (a pōhutukawa tile, a pattern band, a photograph, live type, a panel
 * colour…) and reads the passages for those topics — so the logo rules are
 * read when there is a logo, the pattern rules when there is a band, and
 * nothing is judged against rules for things that are not there.
 *
 * Sources, in order of authority: the guideline PDFs in the brand library,
 * the bundled distilled guidelines, then the brand's short summary.
 */
import { db, brandsTable, brandAssetsTable, guidelinePassagesTable } from "@workspace/db";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { FreeformConfig } from "./freeform";
import { extractPdfText } from "./pdf";
import { DISTILLED_GUIDELINES, DISTILLED_GUIDELINES_SOURCE } from "./brandGuidelines/aucklandCouncilDistilled";
import { logger } from "./logger";

export type GuidelineTopic = "logo" | "pattern" | "anther" | "photography" | "typography" | "colour" | "voice" | "social" | "cta" | "layout";

export interface TopicDef {
  id: GuidelineTopic;
  label: string;
  /** Element slots / roles that make the topic relevant. */
  slots: string[];
  /** Words that mark a passage as being about this topic. */
  keywords: RegExp;
}

export const TOPICS: TopicDef[] = [
  { id: "logo", label: "Pōhutukawa tile and logos", slots: ["logo", "lockup"], keywords: /p[oō]hutukawa|\blogo\b|\btile\b|lockup|clear ?space|wordmark|emblem|corporate logo|minimum (logo )?(height|size)|bottom[- ]right/i },
  { id: "pattern", label: "Kotahitanga patterns and bands", slots: ["band", "pattern", "decoration"], keywords: /kotahitanga|pattern|tohu|motif|wallpaper|stamp|texture|band\b/i },
  { id: "anther", label: "The anther framing device", slots: ["anther", "frame"], keywords: /anther|framing device|circle on a (straight )?stem|stem/i },
  { id: "photography", label: "Photography and imagery", slots: ["photo", "product", "cutout", "image"], keywords: /photograph|imagery|\bimage\b|crop|talent|model release|stock|video\b|footage/i },
  { id: "typography", label: "Typography", slots: ["headline", "subheadline", "message", "body", "text", "kicker"], keywords: /typograph|\bfont\b|typeface|national 2|condensed|tracking|leading|sentence case|caps\b|headline|body copy/i },
  { id: "colour", label: "Colour palette", slots: ["panel", "rect", "scrim"], keywords: /colou?r|palette|#[0-9a-f]{6}|\bhex\b|tint|ocean|k[oō]whai|shore|anther red|pantone|cmyk/i },
  { id: "voice", label: "Voice and tone", slots: ["headline", "subheadline", "message", "body", "text", "cta"], keywords: /voice|tone|te reo|māori|maori|greeting|kia ora|plain (english|language)|we say|never say|copy\b/i },
  { id: "social", label: "Social media rules", slots: ["social"], keywords: /social|instagram|facebook|tiktok|linkedin|story\b|reel|profile picture|safe zone|1080/i },
  { id: "cta", label: "Buttons and calls to action", slots: ["cta", "ctaLabel", "ctaIcon"], keywords: /call to action|\bcta\b|button|pill|search (bar|pill)|find out more|learn more/i },
  { id: "layout", label: "Grid, margins and formats", slots: ["*"], keywords: /\bgrid\b|margin|format|layout|hierarchy|white ?space|alignment|bleed/i },
];

export interface Passage {
  topic: GuidelineTopic;
  label: string;
  heading: string;
  body: string;
  source: string;
}

// ---------------------------------------------------------------------------
// Splitting text into passages

interface RawPassage { heading: string; body: string; ord: number }

/** Markdown-ish text → passages: each bullet or paragraph under its heading. */
export function splitIntoPassages(text: string): RawPassage[] {
  const out: RawPassage[] = [];
  let heading = "";
  let buf: string[] = [];
  let ord = 0;
  const flush = () => {
    const body = buf.join(" ").replace(/\s+/g, " ").trim();
    if (body.length >= 40) out.push({ heading, body: body.slice(0, 900), ord: ord++ });
    buf = [];
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, " ").trimEnd();
    const h = /^#{1,4}\s+(.*)$/.exec(line.trim());
    if (h) { flush(); heading = h[1].replace(/[*_`]/g, "").trim(); continue; }
    if (line.trim() === "") { flush(); continue; }
    // A new bullet starts a new passage; continuation lines join the current one.
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) { flush(); buf.push(line.replace(/^\s*([-*•]|\d+[.)])\s+/, "").replace(/\*\*/g, "")); continue; }
    buf.push(line.trim().replace(/\*\*/g, ""));
  }
  flush();
  return out;
}

/** Plain PDF text → passages: paragraphs, with ALL-CAPS or short title lines as headings. */
export function splitPdfText(text: string): RawPassage[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());
  const out: RawPassage[] = [];
  let heading = "";
  let buf: string[] = [];
  let ord = 0;
  const flush = () => {
    const body = buf.join(" ").replace(/\s+/g, " ").trim();
    if (body.length >= 60) {
      // Long paragraphs become several passages at sentence boundaries.
      const sentences = body.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [body];
      let cur = "";
      for (const s of sentences) {
        if ((cur + s).length > 700 && cur) { out.push({ heading, body: cur.trim(), ord: ord++ }); cur = ""; }
        cur += s;
      }
      if (cur.trim().length >= 40) out.push({ heading, body: cur.trim().slice(0, 900), ord: ord++ });
    }
    buf = [];
  };
  for (const line of lines) {
    if (line === "") { flush(); continue; }
    const isHeading = line.length <= 60 && (line === line.toUpperCase() && /[A-Z]/.test(line) || (/^[A-Z][^.]{2,58}$/.test(line) && buf.length === 0));
    if (isHeading) { flush(); heading = line; continue; }
    buf.push(line);
  }
  flush();
  return out;
}

/** Keyword hits for a topic in a passage. */
function hitCount(t: TopicDef, hay: string): number {
  return (hay.match(new RegExp(t.keywords.source, "gi")) ?? []).length;
}

/** Text lifted from a PDF page carries layout debris: size lists, contents
 *  pages, captions. Such passages are not rules and are not indexed. */
export function looksLikeDebris(body: string): boolean {
  const digits = (body.match(/\d/g) ?? []).length;
  const words = body.split(/\s+/).length;
  if (words < 8) return true;
  if (digits / Math.max(1, body.length) > 0.07) return true;
  if (/\bcontents\b/i.test(body) && words < 60) return true;
  if ((body.match(/\b\d{2,4}\s*[x×]\s*\d{2,4}\b/g) ?? []).length >= 2) return true;
  return false;
}

export function topicsOf(heading: string, body: string, minHits = 1): GuidelineTopic[] {
  const hay = `${heading}\n${body}`;
  const hits = TOPICS.filter((t) => t.id !== "layout" && hitCount(t, hay) >= minHits).map((t) => t.id);
  if (hitCount(TOPICS.find((t) => t.id === "layout")!, hay) >= minHits) hits.push("layout");
  return hits;
}

// ---------------------------------------------------------------------------
// Indexing

export interface IndexResult { sources: Array<{ source: string; passages: number; tagged: number }>; total: number }

/** (Re)build the passage index for a brand from every source available. */
export async function indexGuidelines(brandId: number): Promise<IndexResult> {
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
  if (!brand) throw new Error("Brand not found");
  const sources: Array<{ source: string; assetId: number | null; passages: RawPassage[] }> = [];

  sources.push({ source: DISTILLED_GUIDELINES_SOURCE, assetId: null, passages: splitIntoPassages(DISTILLED_GUIDELINES) });
  if (brand.guidelines && brand.guidelines.trim().length > 40) sources.push({ source: "Brand summary", assetId: null, passages: splitIntoPassages(brand.guidelines) });

  const files = await db
    .select({ id: brandAssetsTable.id, name: brandAssetsTable.name, objectPath: brandAssetsTable.objectPath, contentType: brandAssetsTable.contentType })
    .from(brandAssetsTable)
    .where(and(eq(brandAssetsTable.brandId, brandId), eq(brandAssetsTable.kind, "file")));
  for (const f of files) {
    if (!/pdf/i.test(f.contentType ?? "") || !/guideline|brand book|brand standards|style guide/i.test(f.name)) continue;
    try {
      const text = await extractPdfText(f.objectPath);
      if (text.replace(/\s/g, "").length < 200) continue;
      sources.push({ source: f.name, assetId: f.id, passages: splitPdfText(text) });
    } catch (err) {
      logger.warn({ err, asset: f.id }, "guideline index: could not read a library PDF");
    }
  }

  await db.delete(guidelinePassagesTable).where(eq(guidelinePassagesTable.brandId, brandId));
  const result: IndexResult = { sources: [], total: 0 };
  for (const src of sources) {
    let tagged = 0;
    const rows: Array<typeof guidelinePassagesTable.$inferInsert> = [];
    const fromPdf = src.assetId != null;
    for (const p of src.passages) {
      if (fromPdf && looksLikeDebris(p.body)) continue;
      // PDF text is noisy: a topic needs two hits there, one in curated text.
      const topics = topicsOf(p.heading, p.body, fromPdf ? 2 : 1);
      if (topics.length === 0) continue;
      tagged++;
      for (const topic of topics) rows.push({ brandId, source: src.source, sourceAssetId: src.assetId, topic, heading: p.heading, body: p.body, ord: p.ord });
    }
    for (let i = 0; i < rows.length; i += 200) await db.insert(guidelinePassagesTable).values(rows.slice(i, i + 200));
    result.sources.push({ source: src.source, passages: src.passages.length, tagged });
    result.total += rows.length;
  }
  return result;
}

export async function guidelineStatus(brandId: number): Promise<{ total: number; bySource: Array<{ source: string; passages: number }>; byTopic: Array<{ topic: GuidelineTopic; label: string; passages: number }> }> {
  const rows = await db
    .select({ source: guidelinePassagesTable.source, topic: guidelinePassagesTable.topic, n: sql<number>`count(*)::int` })
    .from(guidelinePassagesTable)
    .where(eq(guidelinePassagesTable.brandId, brandId))
    .groupBy(guidelinePassagesTable.source, guidelinePassagesTable.topic);
  const bySource = new Map<string, number>();
  const byTopic = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    bySource.set(r.source, (bySource.get(r.source) ?? 0) + Number(r.n));
    byTopic.set(r.topic, (byTopic.get(r.topic) ?? 0) + Number(r.n));
    total += Number(r.n);
  }
  return {
    total,
    bySource: [...bySource.entries()].map(([source, passages]) => ({ source, passages })),
    byTopic: TOPICS.map((t) => ({ topic: t.id, label: t.label, passages: byTopic.get(t.id) ?? 0 })).filter((t) => t.passages > 0),
  };
}

// ---------------------------------------------------------------------------
// Reading for a piece

/** The topics the elements on a piece call for, with the element ids per topic. */
export function topicsForConfig(config: FreeformConfig, width: number, height: number): Array<{ topic: TopicDef; elementIds: string[] }> {
  const out: Array<{ topic: TopicDef; elementIds: string[] }> = [];
  const hasText = config.elements.some((e) => e.type === "text" && e.text.trim().length > 0);
  for (const t of TOPICS) {
    const ids = config.elements
      .filter((e) => {
        const slot = e.slot ?? "";
        const role = e.type === "text" || e.type === "image" ? (e as { role?: string }).role ?? "" : "";
        if (t.id === "colour") return e.type === "rect" || slot === "panel" || slot === "scrim";
        if (t.id === "typography" || t.id === "voice") return (e.type === "text" && e.text.trim().length > 0) || ["headline", "subheadline", "message", "kicker"].includes(slot);
        if (t.id === "social") return false;
        if (t.id === "layout") return false;
        if (t.id === "anther") return e.type === "image" && ((e as { radius?: number }).radius ?? 0) > 0 && slot !== "logo";
        return t.slots.includes(slot) || t.slots.includes(role);
      })
      .map((e) => e.id);
    if (t.id === "social" && Math.abs(width - height) < 2 && width >= 600) out.push({ topic: t, elementIds: [] });
    else if (t.id === "layout") out.push({ topic: t, elementIds: [] });
    else if (t.id === "voice" && !hasText) continue;
    else if (ids.length > 0) out.push({ topic: t, elementIds: ids });
  }
  return out;
}

export interface ElementGuideline { topic: GuidelineTopic; label: string; elementIds: string[]; passages: Passage[] }

/** Curated text first (the distilled guidelines are exact rules), then the
 *  guideline PDFs, then the brand's short summary. */
const SOURCE_RANK = (source: string) => (source === DISTILLED_GUIDELINES_SOURCE ? 0 : source === "Brand summary" ? 2 : 1);

/** Passages for the topics a piece calls for: the most specific first. */
export async function guidelinesForConfig(brandId: number | null, config: FreeformConfig, width: number, height: number, perTopic = 4): Promise<ElementGuideline[]> {
  const wanted = topicsForConfig(config, width, height);
  if (wanted.length === 0) return [];
  let rows: Array<typeof guidelinePassagesTable.$inferSelect> = [];
  try {
    rows = await db
      .select()
      .from(guidelinePassagesTable)
      .where(and(brandId != null ? or(eq(guidelinePassagesTable.brandId, brandId), isNull(guidelinePassagesTable.brandId)) : isNull(guidelinePassagesTable.brandId), inArray(guidelinePassagesTable.topic, wanted.map((w) => w.topic.id))));
  } catch {
    rows = [];
  }
  // No index yet: read the bundled guidelines directly so a check never runs blind.
  if (rows.length === 0) {
    const raw = splitIntoPassages(DISTILLED_GUIDELINES);
    rows = raw.flatMap((p) => topicsOf(p.heading, p.body).map((topic) => ({ id: 0, brandId: null, source: DISTILLED_GUIDELINES_SOURCE, sourceAssetId: null, topic, heading: p.heading, body: p.body, ord: p.ord, createdAt: new Date() })));
  }
  const out: ElementGuideline[] = [];
  for (const w of wanted) {
    const mine = rows.filter((r) => r.topic === w.topic.id);
    // Rank: PDF sources first, then the distilled doc, then the summary;
    // within a source, passages with more topic keywords first.
    const score = (r: typeof rows[number]) => {
      const hay = `${r.heading} ${r.body}`;
      const own = hitCount(w.topic, hay);
      // A passage that matches many topics is a page dump, not a rule.
      const others = TOPICS.filter((t) => t.id !== w.topic.id && t.id !== "layout" && hitCount(t, hay) >= 2).length;
      const headingBonus = w.topic.keywords.test(r.heading) ? 6 : 0;
      return SOURCE_RANK(r.source) * -100 + headingBonus + own * 3 - others * 4;
    };
    const picked = mine.sort((a, b) => score(b) - score(a) || a.ord - b.ord).slice(0, perTopic);
    if (picked.length === 0) continue;
    out.push({ topic: w.topic.id, label: w.topic.label, elementIds: w.elementIds, passages: picked.map((r) => ({ topic: w.topic.id, label: w.topic.label, heading: r.heading, body: r.body, source: r.source })) });
  }
  return out;
}

/** Prompt text: the guideline passages that apply to what is on the piece. */
export function describeElementGuidelines(items: ElementGuideline[]): string {
  if (items.length === 0) return "";
  return items
    .map((g) => {
      const who = g.elementIds.length ? ` (elements ${g.elementIds.slice(0, 6).join(", ")})` : "";
      return `${g.label.toUpperCase()}${who}:\n${g.passages.map((p) => `- ${p.heading ? `[${p.heading}] ` : ""}${p.body} (${p.source})`).join("\n")}`;
    })
    .join("\n\n");
}

/** One reminder line per topic present, for the adapt notes. */
export function guidelineNotes(items: ElementGuideline[]): string[] {
  return items
    .filter((g) => g.elementIds.length > 0 && g.passages.length > 0)
    .map((g) => {
      const first = g.passages[0].body.split(/(?<=[.!?])\s/)[0].slice(0, 160);
      return `Guideline (${g.label}): ${first}`;
    });
}
