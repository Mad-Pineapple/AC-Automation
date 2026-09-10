import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { extractPdfText } from "../lib/pdf";
import { analyzeGuidelineText, analyzeWebsiteContent, type GuidelineSuggestions } from "../lib/openai";
import { extractPdfAssets, type ExtractedImage } from "../lib/pdfAssets";

const router = Router();

const HEX = /^#[0-9a-f]{6}$/i;
const COLOR_FIELDS = new Set<keyof GuidelineSuggestions>([
  "primaryColor",
  "secondaryColor",
  "accentColor",
  "backgroundColor",
  "textColor",
]);

router.post("/brands/:id/analyze-guideline", requireAuth, async (req, res): Promise<void> => {
  const brandId = Number(req.params.id);
  if (!Number.isInteger(brandId)) {
    res.status(400).json({ error: "Invalid brand id" });
    return;
  }

  const objectPath = req.body?.objectPath;
  if (typeof objectPath !== "string" || !objectPath.startsWith("/objects/")) {
    res.status(400).json({ error: "objectPath is required" });
    return;
  }

  let text: string;
  try {
    text = await extractPdfText(objectPath);
  } catch {
    res.status(400).json({ error: "Could not read the uploaded PDF." });
    return;
  }

  if (text.replace(/\s/g, "").length < 20) {
    res.status(422).json({
      error:
        "This PDF appears to be image-only or has no selectable text, so nothing could be extracted. Try a PDF that contains real (selectable) text.",
    });
    return;
  }

  let suggestions: GuidelineSuggestions;
  let notes: string[];
  let guidelines: string;
  try {
    ({ suggestions, guidelines, notes } = await analyzeGuidelineText({ text }));
  } catch {
    res.status(502).json({
      error: "The AI analysis service is unavailable right now. Please try again.",
    });
    return;
  }

  const clean: GuidelineSuggestions = {};
  const allNotes = [...notes];
  for (const [key, value] of Object.entries(suggestions) as [keyof GuidelineSuggestions, string][]) {
    if (COLOR_FIELDS.has(key)) {
      if (HEX.test(value)) {
        clean[key] = value;
      } else {
        allNotes.push(`Ignored an invalid color value for ${key}.`);
      }
    } else {
      clean[key] = value;
    }
  }

  // Best-effort: also dissect the PDF for logos/imagery and the fonts actually
  // used. Never fail the request over this — degrade to a note instead.
  let images: ExtractedImage[] = [];
  let fonts: string[] = [];
  try {
    ({ images, fonts } = await extractPdfAssets(objectPath));
  } catch {
    allNotes.push("Could not extract images or fonts from the PDF.");
  }

  res.status(200).json({ suggestions: clean, guidelines, notes: allNotes, images, fonts });
});

/**
 * "Business DNA" from a URL: fetch a public website, extract its visible text
 * plus the colours/fonts present in its markup, and suggest brand fields.
 * Response shape matches analyze-guideline so the frontend panel is shared.
 */
router.post("/brands/analyze-url", requireAuth, async (req, res): Promise<void> => {
  const rawUrl = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  let target: URL;
  try {
    target = new URL(rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`);
  } catch {
    res.status(400).json({ error: "Enter a valid website URL." });
    return;
  }
  if (!/^https?:$/.test(target.protocol)) {
    res.status(400).json({ error: "Only http(s) URLs are supported." });
    return;
  }
  // Light SSRF guard: this endpoint fetches server-side, so keep it away from
  // loopback/private ranges.
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\])/.test(target.hostname)) {
    res.status(400).json({ error: "Private/localhost URLs are not allowed." });
    return;
  }

  let html = "";
  try {
    const resp = await fetch(target.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "Mozilla/5.0 (BrandCreativeStudio site analysis)" },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    html = (await resp.text()).slice(0, 600_000);
  } catch {
    res.status(422).json({ error: "Could not fetch that website. Check the URL and try again." });
    return;
  }

  // Pull one same-site stylesheet too — most real brand colours live in CSS.
  let css = "";
  const cssHref = html.match(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/i)?.[1] ??
    html.match(/<link[^>]+href=["']([^"']+\.css[^"']*)["'][^>]*rel=["']stylesheet["']/i)?.[1];
  if (cssHref) {
    try {
      const cssUrl = new URL(cssHref, target).toString();
      const cssResp = await fetch(cssUrl, { signal: AbortSignal.timeout(8000) });
      if (cssResp.ok) css = (await cssResp.text()).slice(0, 400_000);
    } catch {
      // stylesheet is best-effort
    }
  }

  const styleSource = html + "\n" + css;
  const colorCounts = new Map<string, number>();
  for (const m of styleSource.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    const hex = `#${m[1].toLowerCase()}`;
    colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
  }
  const cssColors = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  const fontSet = new Set<string>();
  for (const m of styleSource.matchAll(/font-family\s*:\s*([^;}"']{3,120})/gi)) {
    fontSet.add(m[1].trim().replace(/\s+/g, " "));
  }

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 100) {
    res.status(422).json({
      error: "That site renders entirely with JavaScript, so no text could be read. Try its about page, or use the PDF upload instead.",
    });
    return;
  }

  try {
    const { suggestions, guidelines, notes } = await analyzeWebsiteContent({
      url: target.toString(),
      text,
      cssColors,
      cssFonts: [...fontSet],
    });
    const clean: GuidelineSuggestions = {};
    const allNotes = [...notes];
    for (const [key, value] of Object.entries(suggestions) as [keyof GuidelineSuggestions, string][]) {
      if (COLOR_FIELDS.has(key)) {
        if (HEX.test(value)) clean[key] = value;
        else allNotes.push(`Ignored an invalid color value for ${key}.`);
      } else {
        clean[key] = value;
      }
    }
    res.status(200).json({ suggestions: clean, guidelines, notes: allNotes, images: [], fonts: [...fontSet].slice(0, 8) });
  } catch {
    res.status(502).json({ error: "The AI analysis service is unavailable right now. Please try again." });
  }
});

export default router;
