---
name: Brand guidelines ingestion
description: Option-C guidelines flow — how brand guideline PDFs steer AI generation and where the steering field must be wired.
---

- Ingesting a brand guideline PDF does two things (option C): fills brand settings (colors/font/tone) AND stores a free-text `guidelines` summary on `brands.guidelines`.
- `brands.guidelines` is the single source of AI brand-voice steering. It is injected into copy, HTML banner, AND product-image generation.
- The analyze-guideline endpoint returns the summary alongside field suggestions and is `requireAuth` (non-persisting, any signed-in user). Persisting it (brand POST/PATCH) and the Knowledge ingestion UI are admin-only.

**Why:** option C means guidelines must steer *all* creative + copy, not just one surface; injecting into only some generators makes those surfaces silently drift from the brand voice.

**How to apply:** when adding any new generator (new asset type or new prompt) that should respect brand voice, thread `brand.guidelines` into its prompt the same way the existing copy/HTML-banner/product-image generators do, or it will ignore the guidelines.

## The regenerate path is a second, easy-to-miss generation path
There are TWO server generation paths, not one: the brief generate flow (routes/briefs.ts) AND the asset regenerate flow (routes/assets.ts `POST /assets/:id/regenerate`). The regenerate path had silently omitted `guidelines` from all three generator calls while briefs.ts threaded it. Any "inject into all gen paths in lockstep" change must touch BOTH files.

## Image generator truncates guidelines — lead with visual direction
`generateProductImage` only injects the first ~900 chars of `brand.guidelines` (a `slice()` — deliberately, to keep image prompts concise). Copy + HTML-banner generators get the FULL text. So any brand's stored guidelines must put the **visual direction (photography style + colour palette hex + illustration style) at the very top**, or the image generator never sees the guidance most relevant to imagery. Ordering is irrelevant to copy/banner (they read all of it) but critical for images.

**Why:** "follow guidelines to the letter in artwork" fails silently for AI imagery if the palette/photography rules sit past the truncation point.

## Deterministic renderer can't honour licensed brand fonts "to the letter"
Brands can name a licensed font (e.g. Auckland Council = "National 2", Klim Type Foundry) that the app cannot ship. The client TemplateRenderer silently falls back to its default stack, so true type fidelity in the deterministic (non-HTML) templates needs the actual webfont files uploaded, or an explicit user-approved free substitute. HTML-banner "artwork" is prompt-driven CSS and can be steered toward the font name in text, but non-HTML template layouts cannot render an unavailable font.
