---
name: Wide-banner "strip" layout
description: How TemplateRenderer lays out very wide/short formats (728x90-type banners) so the brand mark stays whole and copy stays legible.
---

# Wide-banner strip layout (BrandCanvas)

Very wide & short formats (`isStrip = width >= 300 && height <= width * 0.35`,
e.g. 728×90 leaderboards) use a dedicated horizontal layout instead of the
vertical headline/body/CTA stack (the stack crushes the headline to ~10px).

## Invariant — keep it a single flat flex row
The strip content must be ONE flex row whose direct children are:
brand mark (logo OR wordmark) → headline → CTA.

- **Brand mark + CTA are rigid** (`flexShrink: 0`), each with a `maxWidth` cap.
- **Headline is the only flexible element** (`flex: "1 1 auto"`, `minWidth: 0`,
  `overflow:hidden` + `textOverflow:ellipsis`). It is what yields/truncates.
- The two rigid `maxWidth` caps **must sum to well under 100%** (currently
  wordmark 42% + CTA 40%) so that, with gaps + padding, they can never overflow
  the row and collapse the headline to zero.

**Why:** an earlier version nested the wordmark+headline inside a child flex
(`stripLeft`) with `space-between`. That let the *brand wordmark* shrink below
its own content and ellipsis mid-word ("AUCKLAND C..."), which reads as broken.
Flattening + making only the headline flexible fixes it. If both rigid caps are
50%/50% they sum past 100% (with gaps/padding) and overflow again — hence the
sub-100% caps.

**How to apply:** when editing the strip, do NOT re-introduce a nested flex
wrapper around the mark+headline, and do not raise the wordmark/CTA `maxWidth`
caps so their sum approaches 100%.

## Legibility over photos
Strip uses a left-to-right dark scrim (`stripScrimStyle`, ~0.72→0.30) under
white text + text-shadows so copy stays readable over bright background photos.
Background images use `objectFit:cover` + `objectPosition:center` to fill the
frame. These BrandCanvas styles are template-canvas only and do not affect the
freeform editor/renderer (which share their own exported helpers).
