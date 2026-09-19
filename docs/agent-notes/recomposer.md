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

## Liquid layout constraints (2026-09-19, audit addendum)

`lib/liquid.ts` — InDesign's object-based model per element: `constraints { pinTop, pinBottom, pinLeft,
pinRight, flexW, flexH }` (on `FreeformBase`, in the API schema, kept by normalize). Resolution per
axis: pinned both → stretch between the pins; pinned one side → ride that edge keeping the scaled
offset; unpinned → the centre keeps its share of the zone. Offsets scale with the canvas (min ratio).
Sources, in order: the element's own switches (editor widget in the properties panel, IDML
`Horizontal/VerticalLayoutConstraints` when a designer applied an object-based rule, or a position
verdict — "full width of the box" → pinned left + right + flexible width, "to the top" → pinned top,
written onto the MASTER's element by `POST /feedback`); else inferred from the master (flush to a
zone edge → pinned; spanning ≥96% of the zone axis → pinned both + flexible).
Consulted by `adaptFreeformConfig` (cluster-level: any member's explicit switches win, else inferred
against the cluster's zone), the geometry engine (explicit switches beat the measured box) and the
layered band (`flexW` = full width). The recompose/key-visual engines rebuild from slots and do not
read pins. None of the delivered IDML packages carry object rules yet (all default, page rule
UseMaster).

## InDesign bridge accuracy (2026-09-19)

`lib/authoritativeAdapt.ts` now places bridge blocks with the liquid resolver: designer `constraints`
win, else bridge anchors merged with span inference (a block spanning the page is pinned both sides
and flexible whatever a v1 anchor said), else inference. A stretched single image or rect crops/fills
its box; logos never flex; text re-aligns inside a stretched block. Studio floors apply (raised and
flagged). Import maps anchors → `constraints` (one vocabulary with the editor). A target between two
SAME-AXIS masters is blended block by block (`adaptAuthoritativeBetween`, method
`indesign-interpolated`); copy keeps its side of the panel and colliding copy is nudged. A slim
target with no slim master is no longer a 422: it is built from the nearest master by the ordinary
engines and marked REVIEW (`X-Adapt-Softened`). Coverage gate (`contentCoverage`): under 40% of the
canvas on an axis rejects, under 60% flags, on the whole-composition paths. `checkMandatory` no
longer counts a pill and its own label as a collision and judges lockups by height. The bridge
script v2 infers pins by edge (no thirds), exports text frames inside groups as live text (hidden
while the group renders) and lists the fonts used.

## Ground-truth refinement (2026-09-19)

Method: import the studio's real master of shape A, build shape B from it,
and measure the build against the studio's real master of shape B
(384×592 ↔ 960×256, Get Ready). Every number below came from that, not
from taste. After the pass every measured share is within ~3% of the real
file (was up to 12%).

- **Profiles never borrow across axes.** `buildProfile` used the side
  master's band share for stacked zones and vice-versa (band is 5.9% of a
  portrait's height, 16.9% of a wide's). Wides got a hairline band and a
  60% photo; portraits got a 17% band and lost the message. An unmeasured
  axis now reads the named campaign schema, else the class recipe —
  also applied on read (`profileToStyleSchema`) so stored profiles heal.
- **Empty links are missing links.** Slimmed packages carry 0-byte files in
  Links/. They were stored as the photo, so the master and everything built
  from it had no photograph. `indesignPackage.ts` now skips empty or
  undecodable images; the IDML parser crops the frame from the document PDF
  and the import warns by file name.
- **Search pill modelled from the master**: label ratio ceiling 0.6 → 0.72
  (real 0.66–0.68), left inset read from the master's label x, icon 0.74 of
  the pill height sitting concentric in the round end, gap read from the
  master.
- **Pill floor is a label floor.** The recipe's pixel floor (43px, learned
  on DV360 buttons whose label is 42% of the button) is capped at
  18px ÷ label ratio. The 384×592 search pill is 28.9px in the real file.
- **Cap-height copy boxes.** One-line headline, sub-line and message boxes
  are their cap height with `baselineFit: "cap"`, as InDesign frames them,
  so the 0.12em gap under the headline is the visible gap. The gate judges
  copy floors by `fontSize`, not box height.
- **Headline width is a share of the whole zone** (88% portrait, 81% wide),
  capped by the margins. Sub-line tries one line first (may give up 20%).
- **Panel stack**: lockup always bottom-anchored with 0.4 of its height
  under it; message + pill centred at 0.6 (side) / 0.54 (stacked) of the
  room above it; gaps tighten before a part is dropped.
- **Scrim share is per axis when crossing axes**: 0.70 stacked, 0.84 side.
- **Photo crop follows the designer's layout.** With no person- or
  vision-marked focus, the subject is the part of the master's photo zone
  left clear under the copy; it is placed 82% down the new zone. The
  automatic "attention" focus no longer outranks this (it picked the trees
  over the flooded car).
- **Narrow towers** set the pill label on two lines before it collapses to
  the 9px floor.
- **Designer rulings, 19 Sep (evening).** (1) 160×600 pill: the two-line
  label made a blob with no icon — wrong. The pill is always ONE line with
  its search icon; `planCta` now searches for the largest label that fits
  (master spacing, then tight spacing), gives up the icon only when the
  label would fall under the floor, and towers may run the pill to 6px from
  each edge. Two lines is the last resort only. (2) 300×250 headline was
  too small for its space: headline height now follows the photo zone's
  aspect, interpolated between the two masters (0.32 of zone height at
  aspect 1.14 → 0.45 at 1.9), never below the class recipe's value.

## The pill formula (2026-09-19, designer ruling)

"The size of the pills needs a formula they follow, including the text
centred to the height, and pills relative to the heading as in the original
upload." The formula lives in `lib/ctaPlan.ts` (`pillHeightFromHeadline`,
`planCta`) and is enforced for every engine by `lib/pillRule.ts`:

1. `k` = master pill height ÷ master headline type size (Get Ready: 0.30
   portrait, 0.29 wide — the studio holds it constant).
2. pill = `k` × the headline type size as built in this size.
3. floor = the pill that still gives an 18px label at the master's label
   share (26px for a search pill), never under the studio / designer
   minimum (24px); ceiling = 40% of the panel. Strips are the exception:
   their heading is set by the strip's height, so the pill takes the
   recipe's share of that height. An approved piece's measured pill share
   still leads when one exists.
4. label = pill × the master's label share (0.66–0.68 search pill, 0.42
   DV360 button); when the zone is too narrow the label takes the largest
   size that fits on ONE line with the icon.
5. the label's cap height is centred on the pill's centre line
   (`baselineFit: "cap"` frame) — PNG, editor and HTML5 agree to <1px.
6. icon = 0.74 × pill, concentric in the right-hand round end, centred on
   the same line.

Sub-line and message sizes hang off the heading the same way: the master's
own sub : headline and message : headline ratios (0.29 / 0.27 on Get Ready),
unless an approved piece measured different ones.

`applyPillRule` runs in `adaptOne` after whichever engine built the piece
(not on the designer's own InDesign sizes): it re-centres label and icon and
adds a "Check:" note when the pill's size against the heading has drifted
more than 30% from the original. It never resizes (neighbours would move).

## HTML5 export (2026-09-19)

- Pill, label and icon are one `.cta-unit` group with one entrance, last of
  the copy. As separate layers the icon arrived first.
- Artwork = the photo (and a cut-out). Bands, lockups and the pill icon are
  not artwork: a Ken Burns preset used to zoom the lockup and the icon.
- Panels, scrims and bands are still from the first frame; the stage wears
  the artwork's ground colour. No white flash.
- Cap-height copy frames use an inline-block strut so the baseline lands on
  the frame bottom in any font.
- Weight: cover-fit photos are cropped to the part on the canvas (+5% for
  motion) before the 2× resize; opaque RGBA goes JPEG; only the National 2
  weights a banner sets are packaged. 160×600 went 572KB → 136KB.
