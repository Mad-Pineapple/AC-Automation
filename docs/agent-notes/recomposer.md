---
name: Recomposer (slots · classes · recipes)
description: How masters are rebuilt for towers, portraits, wides and strips the way shipped AC creative is — and where the numbers live.
---

# Recomposer

Shipped AC creative never scales one layout into a different shape. It rebuilds from a kit of
parts along an axis the canvas chooses (tall → stack, wide → columns, strip → one row), keeps
the CTA at a fixed pixel size, re-crops and pans the photo, re-sets the headline to fill the
photo zone, tiles the kotahitanga band along the seam, and drops body copy before anything
shrinks. `docs/complex-size-layouts.md` has the measurements. The recomposer implements them.

## Pipeline (api-server/src/lib)

| Module | Job |
|---|---|
| `formatCatalog.ts` | `classifyAspect` (tower / portrait / square / landscape / wide / strip), `classifyBudget` (micro / small / standard / large), the named `FORMAT_CATALOG`, `needsRebuild`, and the ONE `ASPECT_REBUILD_THRESHOLD` (0.3) + `STRIP_MAX_HEIGHT` (120). kvAdapt, logoRules and campaignPlan import these — never re-declare them. |
| `slots.ts` | `inferSlots` — what each rectangle is FOR: photo, cutout, scrim, panel, band, headline, subheadline, message, cta, ctaLabel, ctaIcon, lockup, logo. An explicit `slot` on the element (model field in `freeform.ts`) always wins; geometry fills the rest. Verified on the Get Ready 384×592 and 960×256 InDesign masters (11/11 correct). |
| `recipes.ts` | `RECIPES[class]` — the fractions and floors per class (photo/band/panel split, headline fit, CTA floor px, lockup size, which slots survive). `recipeFor(class, budget)` trims slots for micro/small canvases. **Data, not code**: calibrate from delivered campaigns, don't tune per call site. |
| `textMeasure.ts` | Real measurement with the registered fonts (`fitText` binary-searches the largest size that fits a box within N lines). Replaces the 0.52/0.58em estimates. |
| `recompose.ts` | The solver: zones from the recipe → photo cover-crop oversized and panned to its focus box → scrim → tiled band → headline (+ sub-headline) fitted to the photo zone (word-per-line on towers, single row on strips) → panel stack (message, CTA at its floor, lockup) → logo tile where guidelines want one. Emits a normal freeform config with `adaptMethod: "recomposed:<class>"` and `adaptNotes`. Deterministic. |
| `layoutCheck.ts` | Contact-sheet checks on any adapted config: copy wider than its box, furniture off canvas, CTA under 24px, headline under 12px. Findings ride in `adaptNotes` as "Check: …". |

## Where it runs

- `POST /templates/:id/adapt` tries, in order: recompose (when `needsRebuild`), key-visual adapt,
  panel recompose, geometric scale. Every result is layout-checked and stored with
  `sourceTemplateId` = the master (new column; `Adapted from "…"` in the description is kept for
  the older family lookups).
- `POST /campaigns/build-plan` (`campaignPlan.ts`) now picks the example in the **same format
  class** first and only falls back to the nearest aspect; jobs carry `formatClass`,
  `formatLabel` (catalog or brief deliverable name), `method` and `needsReview` (no same-class
  example → rebuilt from the recipe alone → designer sign-off).

## Judging output

`pnpm --filter @workspace/api-server run recompose:preview <outDir> <masters.json> [WxH,…]`
renders masters at the awkward sizes to PNG (plus the config JSON) using local object storage.
Compare against `~/Downloads/Large campaign example` (OOH 384×592 / 960×256, DV360 300×600 /
970×250). As of 2026-09-02 the 960×256 master rebuilt to 384×592 matches the shipped portrait
billboard structurally, and vice versa.

## Gotchas

- Package photos over ~100 MB (the Storms PSD) never make it into object storage; those
  masters recompose with the panel colour behind the headline and a "No photograph" note.
- `drizzle-kit push` wants to drop the legacy `feedback` table; the `source_template_id`
  column was added with plain `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. Do the same on Neon.
- Strip and tower outputs are always `needsReview`: they are correct by recipe but the studio
  has shipped none to calibrate against yet.
