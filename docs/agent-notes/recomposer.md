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

## Pill rule (2026-09-16, audit fixes P2/P3)

`lib/ctaPlan.ts` is the one pill rule. The label is measured with the real face at the master's own
label-to-pill ratio (clamped 0.3–0.6) and the pill is that label plus the master's padding. When the
zone is too narrow: label and pill shrink together to the floor (9px, 8px on micro), padding tightens
to 0.3× pill height, the icon goes, then the label wraps to 2–3 lines on towers and canvases under
200px wide. Words are never cut; a label that still does not fit is flagged `Check:` and
`needsReview`. Used by `recompose.ts` (planned before the strip headline so the two never overlap)
and `kvAdapt.ts`. The Claude guard (`claudeReview.ts`) scales a pill's label with the pill.

Type growth: `kvAdapt.fitFont` grows a headline to the master's share of canvas height (never past
what fits); `geometryAdapt.fitText` grows into its measured box up to 1.5× the proposed size and
siblings with the same text role share the smallest fitted size. `textMeasure.fontResolution` reports
a substituted face and both engines add a `Check:` note when the headline or label was measured in
National 2 because its face (e.g. DS-Digital) was not registered. The approved-sibling scale path is
skipped outside 0.5×–2× of the sibling's short side (rebuild with its proportions instead).

## One rule layer (2026-09-16, audit fix P1)

`lib/partRulesLayer.ts` — `ruleLayerFor(schema)` gives every engine the campaign's part rules
(`pin`, `size`, `dropWhenTight`, `minPx`) with the studio floors as defaults (headline 12, sub-line
10, message 13, pill 24, lockup 16, logo 24; label 9). The adapt route builds it once and passes it
to the recomposer (floors, drops, band pin none), the key-visual engine (headline and pill floors),
the geometry engine (floors, parts pinned none are left out) and the layered engine already read the
schema (band `size: fit-width` now keeps full width with a cover crop; `pin: centre` centres it in
the panel). The scaled paths (plain scale and approved-sibling scale) do not apply floors: they
reproduce the reference as it is. Re-learning a profile with the same campaign name updates the
existing profile (rules kept, source ids widened) instead of spawning a default one that outranks it.

## Fallback scaler zones (2026-09-16, audit fix P4)

`adaptFreeformConfig` (the plain-scale and approved-sibling paths, and the geometry engine's
fallback) now understands zones. Full-width strips and full-height columns keep their span, snap
to the canvas edges and tile against each other (a strip whose master top met another's bottom
keeps meeting it; the strip that touched the far edge fills to it), so photo / band / panel stay
seamless on any canvas. Elements that overlap in the master (pill + label + icon, a lockup's marks)
move as one cluster, placed at the master's relative position inside its zone and clamped inside it;
anything flush to a canvas edge in the master snaps flush. Text boxes get 3% slack so a line that
met its box does not wrap after rounding. The geometry engine now unions edge flags across masters
and snaps flush copy and rects to the edge instead of the measured fraction.

## Parity gate, retry, kicker (2026-09-16, audit fix P5)

Every build records `droppedParts` ({slot, reason, byRule}) and `needsReview` on its config.
`checkMandatory` reads the master with `inferSlots` and requires every part it carries in the output
unless a drop entry is allowed: `byRule`, a profile `dropWhenTight`, or the default-droppable set
(message, sub-line, kicker, cut-out, band). Headline, pill, lockup/logo and photo are never droppable
by default. A rejected result is retried with the next engine (recompose, then plain scale) and the
build keeps the result with the fewest rejections, noting the switch. Descriptions carry `REVIEW ·`
when a piece needs a look; the WIP card shows a Review badge and a "Left out:" line.
New slot `kicker` (the line above the headline, e.g. "IT'S TIME TO TALK"): inferred for live text
(slots.ts) and for image layers (layeredArtwork.inferImageSlots), placed above the headline by the
recomposer and the layered engine, and existing layered masters are relabelled on their next build.
Known gap: the message's first line in the Phase 1/2 HTML5 files is still lost — the panel splitter
keeps one yellow segment (P6).

## Panel split without doubling (2026-09-16, audit fix P6)

`splitPanelGraphic` now merges consecutive yellow message segments (a two-line message no longer
loses its first line) and paints the cut regions out of the panel graphic in the exact ground colour
(`panelMasked: true` on the panel image), so any engine can draw the panel and its parts together
without doubling. `resplitLegacyPanel` re-cuts a master split before masking existed; the adapt route
runs it once on the next build of such a master and persists the result.
