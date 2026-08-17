import { openai, editImageBuffers } from "@workspace/integrations-openai-ai-server";
import { finalizeHtmlBanner } from "./htmlBanner";
import { getBrandRules } from "./brandRules";

/** gpt-image-1 output sizes, chosen to match a target canvas orientation. */
export type ProductImageSize = "1024x1024" | "1536x1024" | "1024x1536";

export async function generateCopy(params: {
  campaignName: string;
  brandName: string;
  toneOfVoice: string;
  industry: string | null;
  templateSize: string;
  sizeDescription?: string;
  userPrompt?: string;
  guidelines?: string | null;
  /** Campaign context from the brief (objective, audience, key messages, mandatories). */
  briefContext?: string | null;
}): Promise<{ headline: string; bodyText: string; callToAction: string }> {
  const sizeDescriptions: Record<string, string> = {
    social_square: "1080x1080 square social media post",
    story: "1080x1920 vertical story format",
    banner: "728x90 horizontal banner ad (very short copy)",
    html_banner: "970x250 HTML5 display banner (very short copy)",
    print_a4: "A4 print material",
    animated_social: "1080x1080 animated social post",
  };

  const sizeDesc = params.sizeDescription || sizeDescriptions[params.templateSize] || params.templateSize;

  const prompt = `You are a creative copywriter for ${params.brandName}, a brand in the ${params.industry || "retail"} industry.
Tone of voice: ${params.toneOfVoice}.
${params.guidelines ? `\nBrand guidelines to follow:\n${params.guidelines}\n` : ""}${
    params.briefContext ? `\nCampaign brief (ground every line in this — it is the source of truth for what the ad must say):\n${params.briefContext.slice(0, 3000)}\n` : ""
  }
Write advertising copy for the campaign "${params.campaignName}" formatted for a ${sizeDesc}.
${params.userPrompt ? `Additional direction: ${params.userPrompt}` : ""}

Writing rules:
- Use New Zealand English spelling (organise, programme, colour).
- Headlines: no full stop at the end, sentence case unless the brand guidelines say otherwise.
- Speak directly to the reader (you/your/we/us); plain words over formal ones.
${getBrandRules(params.brandName).copyRules(params.templateSize).map((r) => `- ${r}`).join("\n")}

Return ONLY a JSON object with these exact fields:
- headline: punchy headline (max 8 words for banner, max 12 words otherwise)
- bodyText: supporting copy (1-2 sentences; for banner format return empty string "")
- callToAction: CTA button text (2-4 words)

No explanation, just the JSON.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 300,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(content);
    return {
      headline: parsed.headline ?? "",
      bodyText: parsed.bodyText ?? "",
      callToAction: parsed.callToAction ?? "Find out more",
    };
  } catch {
    return { headline: params.campaignName, bodyText: "", callToAction: "Find out more" };
  }
}

/**
 * Structure the raw text of an uploaded brief document (Word/PDF) into draft
 * brief fields so the New Brief form can be pre-filled for the user to review.
 */
export async function extractBriefFromText(params: {
  text: string;
  fileName?: string;
}): Promise<{
  campaignName: string;
  headline: string;
  bodyText: string;
  callToAction: string;
  notes: string;
  warnings: string[];
}> {
  const prompt = `You are a marketing operations assistant. Below is the raw text of a campaign brief document${
    params.fileName ? ` ("${params.fileName}")` : ""
  }. Extract the key fields needed to pre-fill a new creative brief.

Brief document text:
${params.text.slice(0, 12000)}

Return ONLY a JSON object with these exact fields:
- campaignName: a concise campaign name (max 8 words). If it isn't stated, infer a sensible one from the brief.
- headline: the main advertising headline if present, otherwise an empty string ""
- bodyText: 1-2 sentences of supporting/body copy if present, otherwise an empty string ""
- callToAction: the call-to-action button text (2-4 words) if present, otherwise an empty string ""
- notes: a dense summary of the campaign context that a copywriter and art director need: objective, target audience, key messages (verbatim where given), offer/dates, landing page or search phrase, mandatories/legal lines, and any creative direction (concepts, imagery, formats/sizes). Use short markdown bullet lines. Return "" only if the document has none of this.
- warnings: array of short strings noting any important fields that could not be found (may be empty)

No explanation, just the JSON.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1200,
    response_format: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
    return {
      campaignName: typeof parsed.campaignName === "string" ? parsed.campaignName : "",
      headline: typeof parsed.headline === "string" ? parsed.headline : "",
      bodyText: typeof parsed.bodyText === "string" ? parsed.bodyText : "",
      callToAction: typeof parsed.callToAction === "string" ? parsed.callToAction : "",
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 4000) : "",
      warnings: Array.isArray(parsed.warnings)
        ? parsed.warnings.filter((w: unknown): w is string => typeof w === "string")
        : [],
    };
  } catch {
    return {
      campaignName: "",
      headline: "",
      bodyText: "",
      callToAction: "",
      notes: "",
      warnings: ["Could not parse the document into brief fields."],
    };
  }
}

/**
 * Recommend which template sizes/formats a brief needs, based on what the
 * user typed (campaign name, copy, notes). Channel words ("Instagram",
 * "display", "billboard", "print") map to formats; when nothing is stated the
 * sensible council default is social + display.
 */
export async function suggestTemplateSizes(params: {
  text: string;
  options: { key: string; label: string }[];
}): Promise<{ sizes: string[]; reason: string }> {
  const optionList = params.options.map((o) => `- ${o.key}: ${o.label}`).join("\n");
  const prompt = `You are a media planner. Based on the campaign brief text below, pick which creative formats to produce.

Available formats (pick by key):
${optionList}

Brief text:
${params.text.slice(0, 6000)}

Rules:
- Pick ONLY keys from the list above.
- Map channel mentions to formats: social/Instagram/Facebook → square social (and animated social if motion/video is implied); story/reels/TikTok → story; display/banner/programmatic/GDN/DV360/CM360 → HTML banner; print/poster/flyer/A4 → print.
- If the brief names specific sizes or formats, honour them.
- If channels aren't stated, default to the square social format plus the HTML banner.
- 1 to 4 formats. Prefer fewer, well-justified picks.

Return ONLY a JSON object:
- sizes: array of format keys
- reason: one short sentence (max 18 words) explaining the picks, referencing the brief's channels.

No explanation, just the JSON.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 200,
    response_format: { type: "json_object" },
  });

  const validKeys = new Set(params.options.map((o) => o.key));
  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
    const sizes = Array.isArray(parsed.sizes)
      ? parsed.sizes.filter((s: unknown): s is string => typeof s === "string" && validKeys.has(s))
      : [];
    return {
      sizes,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "",
    };
  } catch {
    return { sizes: [], reason: "" };
  }
}

/**
 * Choose an existing brand-library image whose SUBJECT matches the campaign,
 * so real approved artwork is used instead of generating new imagery. Returns
 * null when nothing clearly fits — callers then fall back to AI generation.
 */
export async function pickLibraryImageAsset(params: {
  briefText: string;
  candidates: { id: number; name: string; folder: string | null }[];
}): Promise<{ assetId: number | null; reason: string }> {
  if (params.candidates.length === 0) return { assetId: null, reason: "empty library" };
  const list = params.candidates
    .map((c) => `${c.id} | ${c.folder ?? "unfiled"} | ${c.name.replace(/\.[a-z0-9]+$/i, "")}`)
    .join("\n");
  const prompt = `You are an art director picking artwork for a campaign from the brand's asset library.

Campaign brief:
${params.briefText.slice(0, 3000)}

Library assets (id | folder | name):
${list.slice(0, 30000)}

Rules:
- Pick an asset ONLY if its name clearly indicates the SUBJECT matches the campaign topic (e.g. a dog illustration for a dog campaign, a flood image for a flood campaign).
- Prefer Illustrations, then Photography. Icon graphics only when the campaign is literally about that motif. Never pick from Logos or Kotahitanga patterns — they are marks and devices, not hero imagery.
- A vague thematic connection is NOT enough. When unsure, return null — generating fresh artwork is better than a mismatched picture.

Return ONLY a JSON object:
- assetId: the chosen asset's numeric id, or null if nothing clearly matches
- reason: one short sentence.

No explanation, just the JSON.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 120,
    response_format: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
    const id = Number(parsed.assetId);
    const valid = Number.isInteger(id) && params.candidates.some((c) => c.id === id);
    return {
      assetId: valid ? id : null,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "",
    };
  } catch {
    return { assetId: null, reason: "picker response unparseable" };
  }
}

export async function generateHtmlBanner(params: {
  campaignName: string;
  brandName: string;
  toneOfVoice: string;
  industry: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  headline?: string | null;
  bodyText?: string | null;
  callToAction?: string | null;
  imageUrl?: string | null;
  styleHints?: string;
  guidelines?: string | null;
  dimensions?: { width: number; height: number };
  animated?: boolean;
  /** Campaign context from the brief (objective, audience, key messages, mandatories). */
  briefContext?: string | null;
  /** Extra directives fed back after a failed compliance check (retry). */
  complianceFeedback?: string | null;
  /** Master logo tile as a data URI; injected bottom-right by the finalizer. */
  logoDataUri?: string;
}): Promise<string> {
  const { width = 970, height = 250 } = params.dimensions ?? {};

  // For the animated size the motion IS the deliverable, so make a prominent
  // looping animation a hard requirement instead of an optional flourish.
  const animationRequirement = params.animated
    ? `- ANIMATION IS THE PRIMARY DELIVERABLE: include prominent, continuously looping CSS keyframe animations so the banner is visibly in motion on its own (e.g. animated headline/CTA entrance, looping accent motion, an infinite gradient or pulse). Do NOT produce a static-looking banner.`
    : `- Use CSS animations for visual interest (subtle pulse, fade, or slide)`;

  const styleSection = params.styleHints
    ? `\n\nAPPLY THIS SAVED BRAND STYLE:\n${params.styleHints}`
    : "";

  const guidelinesSection = params.guidelines
    ? `\n\nBRAND GUIDELINES TO FOLLOW:\n${params.guidelines}`
    : "";

  const feedbackSection = params.complianceFeedback
    ? `\n\nIMPORTANT — the previous version FAILED a brand-compliance check for these reasons:\n${params.complianceFeedback}\nYou MUST fix these: use ONLY the brand palette colors listed above (plus neutral white/black/grey where needed) and the brand font.`
    : "";

  // Only reference the product image in the prompt when it's a real http(s) URL.
  // Generated images come back as base64 data URLs (often >1MB) which would blow
  // past the model's context limit if embedded verbatim as prompt text.
  const isHttpUrl = !!params.imageUrl && /^https?:\/\//i.test(params.imageUrl);
  const imageSection = isHttpUrl
    ? `\nProduct image URL: ${params.imageUrl}\nInclude this product image in the banner using an <img> tag whose src is set EXACTLY to the URL above (do not alter or shorten it). Integrate it naturally into the layout (e.g. as a product visual or hero), sizing it with object-fit so it never distorts or overflows the banner.`
    : "\nNo product image URL is available, so do not reference an external image; design the banner without an <img> tag.";

  const briefSection = params.briefContext
    ? `\n\nCAMPAIGN BRIEF (the ad must communicate this):\n${params.briefContext.slice(0, 2000)}`
    : "";

  const prompt = `You are an expert HTML5 display-ad developer and designer. Create a production-ready, self-contained HTML5 banner for ${params.brandName}.

Brand palette:
- Primary: ${params.primaryColor}
- Secondary: ${params.secondaryColor}
- Accent: ${params.accentColor}
- Background: ${params.backgroundColor}
- Text: ${params.textColor}
- Font: ${params.fontFamily}

Banner dimensions: ${width}px × ${height}px
Campaign: "${params.campaignName}"
Industry: ${params.industry || "retail"}
Tone: ${params.toneOfVoice}
${params.headline ? `Headline: "${params.headline}"` : ""}
${params.bodyText ? `Body: "${params.bodyText}"` : ""}
${params.callToAction ? `CTA: "${params.callToAction}"` : ""}${imageSection}${styleSection}${guidelinesSection}${briefSection}${feedbackSection}

Return ONLY a complete, self-contained HTML document (<!DOCTYPE html>...) with inline CSS.
Requirements:
- Exact ${width}×${height}px fixed size: <html> and <body> at margin:0, a single root container div sized exactly ${width}x${height}px with position:relative and overflow:hidden. No scrollbars.
- Include <meta name="ad.size" content="width=${width},height=${height}"> in the <head>.
${animationRequirement}
- Animation timing (ad-server rules): entrance animation completes within 6-8 seconds; anything that keeps moving after that must be subtle. Use CSS keyframes only.
- BRAND COMPLIANCE (mandatory): every non-neutral color you use MUST be one of the brand palette hex values above. Neutral white/black/grey are allowed for text and spacing. Do NOT introduce off-brand accent colors.
- COMPOSITION (mandatory): the design must fill the ENTIRE ${width}×${height} canvas — no large empty areas. Use the product image full-bleed as a background (object-fit:cover with a dark scrim under light text) or as a half/two-thirds panel, with every remaining area a solid brand-colour panel. Copy block aligned to a clear grid (margins ≈ 1/18 of the shortest side).
- Typography: use font-family: "${params.fontFamily}", "Helvetica Neue", Helvetica, Arial, sans-serif. Do NOT load any webfont (no @import, no <link> to font CDNs) — ad servers reject external requests. Emulate the brand's condensed bold headline style with font-weight:700/800, tight letter-spacing and uppercase where the guidelines call for it.
- ABSOLUTELY NO external network requests: no external scripts, stylesheets, fonts, or analytics.${isHttpUrl ? " The ONLY allowed external resource is the provided product image URL." : ""}
- Structure for editability: give the key elements stable ids — id="headline", id="body-copy", id="cta" — so a human can tweak them later.
- Include a styled CTA button (id="cta").
- Do NOT add clickTag wiring or <a> tags around the ad — click handling is injected downstream.
- Professional, production-ready design matching the brand palette.
${getBrandRules(params.brandName).bannerRules(params.animated ? "animated_social" : "html_banner").map((r) => `- ${r}`).join("\n")}
Output ONLY the raw HTML, no markdown code fences.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 4000,
  });

  const html = response.choices[0]?.message?.content ?? "";
  // Deterministic pass: guarantees ad.size meta + clickTag wiring and strips
  // external font loads, regardless of what the model produced.
  // Animated social is a 1080x1080 social feed tile: per the brand guidelines
  // social tiles carry NO pohutukawa logo (the channel profile picture brands
  // the post), so skip the logo-tile injection for it.
  return finalizeHtmlBanner(html, {
    width,
    height,
    logoDataUri: params.animated ? undefined : params.logoDataUri,
  });
}

export async function extractBrandStyle(params: {
  html: string;
  brandName: string;
  campaignName: string;
}): Promise<{ name: string; description: string; cssSnippet: string }> {
  const prompt = `You are a CSS design analyst. A user edited an HTML banner for "${params.brandName}" (campaign: "${params.campaignName}").

Analyse the HTML and extract the reusable design style as a named CSS snippet.

HTML:
${params.html.slice(0, 6000)}

Return ONLY a JSON object with:
- name: short descriptive style name (e.g. "Bold Hero Split", "Minimal Card", "Gradient Overlay") - max 4 words
- description: one sentence describing the visual style and when to use it
- cssSnippet: the key CSS rules that define this style (variables, layout, typography choices) - compact, reusable snippet (not the full HTML)

No markdown, just JSON.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 600,
    response_format: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
    return {
      name: parsed.name ?? "Custom Style",
      description: parsed.description ?? "",
      cssSnippet: parsed.cssSnippet ?? "",
    };
  } catch {
    return { name: "Custom Style", description: "", cssSnippet: "" };
  }
}

export async function generateProductImage(params: {
  campaignName: string;
  brandName: string;
  industry: string | null;
  toneOfVoice: string;
  /** Campaign context from the brief so the artwork depicts the right subject. */
  briefContext?: string | null;
  /** Output size matching the target canvas orientation. Defaults to square. */
  size?: ProductImageSize;
  /** Brand/template reference images so the result follows their visual style. */
  references?: { buffer: Buffer; mimeType: string }[];
  guidelines?: string | null;
  /** Brand palette so the generated art is dominated by on-brand colors. */
  palette?: {
    primaryColor?: string | null;
    secondaryColor?: string | null;
    accentColor?: string | null;
    backgroundColor?: string | null;
  } | null;
  /** Extra directives fed back after a failed compliance check (retry). */
  complianceFeedback?: string | null;
}): Promise<string | null> {
  const size = params.size ?? "1024x1024";
  // Copy (headline/CTA/logo) is overlaid by the renderer, so the generated
  // image must be a clean, edge-to-edge background with no baked-in text/logos.
  const guidelineHint = params.guidelines
    ? ` Follow these brand visual guidelines where relevant: ${params.guidelines.slice(0, 900)}.`
    : "";
  // Steer the composition toward the brand palette. Image models cannot hit
  // exact hex values, so phrase this as "dominated by" (not "ONLY these hex")
  // to avoid guaranteeing a compliance failure on every generation.
  const paletteColors = params.palette
    ? [
        params.palette.primaryColor,
        params.palette.secondaryColor,
        params.palette.accentColor,
        params.palette.backgroundColor,
      ].filter((c): c is string => typeof c === "string" && c.trim() !== "")
    : [];
  const paletteHint = paletteColors.length
    ? ` The composition must be dominated by the brand's color palette (${paletteColors.join(", ")}): use these as the primary colors so the artwork is unmistakably on-brand, while keeping it photographic and natural.`
    : "";
  const feedbackHint = params.complianceFeedback
    ? ` IMPORTANT — the previous attempt was rejected for not matching the brand: ${params.complianceFeedback.slice(0, 400)}. Correct these issues and lean harder into the brand palette above.`
    : "";
  const briefHint = params.briefContext
    ? ` Campaign context (depict the right subject matter): ${params.briefContext.slice(0, 600)}.`
    : "";
  // The renderer overlays all copy (headline, body, CTA, logo) on top of this
  // image, so any baked-in lettering would duplicate or clash with the real
  // copy. State the rule FIRST and repeat it last — long prompts and text-heavy
  // reference images otherwise pull the model into rendering headlines.
  const basePrompt = `A pure ARTWORK-ONLY advertising background image — it must contain absolutely NO text of any kind: no words, headlines, letters, numbers, logos, buttons, search bars or UI elements (all copy is overlaid separately later). For ${params.brandName}${
    params.industry ? ` (${params.industry})` : ""
  }. Campaign: "${params.campaignName}".${briefHint} ${params.toneOfVoice} aesthetic.${guidelineHint}${paletteHint}${feedbackHint} Full-bleed composition that completely fills the frame edge to edge, no borders or margins. Leave calm negative space where a headline could later be overlaid. Reminder: zero text, lettering, numbers or logos anywhere in the image.`;

  const references = params.references ?? [];

  try {
    // Image-to-image: follow the brand's own images + the template's image.
    if (references.length > 0) {
      try {
        const editPrompt = `Create a brand-new advertising background image for the "${params.campaignName}" campaign by ${params.brandName}, closely matching the visual style, color palette, illustration/photography style, and overall art direction of the reference images. Reproduce only their ART STYLE — if the reference images contain any text, headlines, logos or UI elements, do NOT reproduce those. ${basePrompt}`;
        const buffer = await editImageBuffers(references, editPrompt, size);
        if (buffer.length > 0) {
          return `data:image/png;base64,${buffer.toString("base64")}`;
        }
      } catch {
        // Fall through to text-only generation below.
      }
    }

    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: basePrompt,
      size,
      n: 1,
    });
    const imageData = response.data?.[0];
    if (imageData && "b64_json" in imageData && imageData.b64_json) {
      return `data:image/png;base64,${imageData.b64_json}`;
    }
    if (imageData && "url" in imageData && imageData.url) {
      return imageData.url;
    }
    return null;
  } catch {
    return null;
  }
}

export interface GuidelineSuggestions {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  toneOfVoice?: string;
  industry?: string;
}

const GUIDELINE_FIELDS: (keyof GuidelineSuggestions)[] = [
  "primaryColor",
  "secondaryColor",
  "accentColor",
  "backgroundColor",
  "textColor",
  "fontFamily",
  "toneOfVoice",
  "industry",
];

/**
 * Analyse brand-guideline document text and extract suggested brand fields.
 * Returns ONLY fields the model could find evidence for; everything is optional
 * so the caller can present non-destructive suggestions for user review.
 */
export async function analyzeGuidelineText(params: {
  text: string;
}): Promise<{ suggestions: GuidelineSuggestions; guidelines: string; notes: string[] }> {
  const prompt = `You are a brand identity analyst. Extract brand design attributes from the brand guideline document text below.

Document text:
"""
${params.text.slice(0, 20000)}
"""

Return ONLY a JSON object with this exact shape:
{
  "suggestions": {
    "primaryColor": "#RRGGBB",
    "secondaryColor": "#RRGGBB",
    "accentColor": "#RRGGBB",
    "backgroundColor": "#RRGGBB",
    "textColor": "#RRGGBB",
    "fontFamily": "string",
    "toneOfVoice": "string",
    "industry": "string"
  },
  "guidelines": "string",
  "notes": ["string"]
}

Rules:
- Colors MUST be 6-digit hex like #1A2B3C. Convert color names, RGB, CMYK, or Pantone references to the closest hex ONLY when the document gives a concrete value.
- OMIT any field you cannot determine from the document. Never guess or invent a value. Only include a field when there is real evidence in the text.
- fontFamily: the primary brand typeface name.
- toneOfVoice: a short phrase (e.g. "Bold and confident", "Warm and approachable").
- industry: the brand's industry or category if stated.
- guidelines: a concise but comprehensive summary (use short markdown bullet lines) of the brand's voice, key messaging/themes, and explicit do's and don'ts that should steer future ad copy and creative. Use plain language. Return "" if the document has no usable guidance.
- notes: short strings naming which fields could NOT be found, or anything ambiguous. Keep it brief.

No markdown, no commentary, just the JSON object.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 600,
    response_format: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
    const raw = parsed.suggestions ?? {};
    const suggestions: GuidelineSuggestions = {};
    for (const field of GUIDELINE_FIELDS) {
      const value = raw[field];
      if (typeof value === "string" && value.trim()) {
        suggestions[field] = value.trim();
      }
    }
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.filter((n: unknown): n is string => typeof n === "string").slice(0, 12)
      : [];
    const guidelines = typeof parsed.guidelines === "string" ? parsed.guidelines.trim().slice(0, 4000) : "";
    return { suggestions, guidelines, notes };
  } catch {
    return { suggestions: {}, guidelines: "", notes: ["Could not interpret the guideline document."] };
  }
}
