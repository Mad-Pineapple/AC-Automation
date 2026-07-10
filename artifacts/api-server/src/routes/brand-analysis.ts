import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { extractPdfText } from "../lib/pdf";
import { analyzeGuidelineText, type GuidelineSuggestions } from "../lib/openai";
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

export default router;
