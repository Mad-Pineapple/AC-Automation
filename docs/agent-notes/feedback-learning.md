---
name: Designer feedback as a learning signal
description: How Right/Wrong verdicts survive WIP clearing, reach the adapt engines, and what the 2026-09-06 batch taught.
---

# Feedback learning

`routes/feedback.ts` stores Right/Wrong verdicts. `lib/feedbackLearning.ts` makes them useful:

- **Snapshots.** Every row records what it was about at insert time (`subject_name`,
  `subject_width/height`, `format_class`, `adapt_method`, `source_template_id`); rows that
  predate the columns are back-filled on boot while their template still exists. Clearing
  WIP (`POST /templates/clear-wip`, the "Clear all" button) therefore never loses a lesson.
- **Per-class summary.** `feedbackForFormat(class)` counts verdicts on *adapted* pieces of
  that class (imports excluded) and collects the incorrect notes. The adapt route appends
  "Designer feedback on wide formats: 6 right, 1 wrong. Wrong because: …" to every new
  piece's `adaptNotes`, so the reviewer of the next one sees it.
- **Prompts.** `recentIncorrectNotes` still feeds the generation prompts.
- **No automatic tuning.** Recipe numbers change only when a person reads the notes and
  edits `lib/recipes.ts`. A stray thumbs-down must not move the whole system.

## What the 2026-09-06 batch (59 verdicts) taught, and what changed

| Verdict | Lesson | Change |
|---|---|---|
| "Pill size is wrong" on 768×256 and 300×250 | The 43px display floor swallows a short panel. Shipped 960×256 OOH pill is 32px (12.5%). | `recipes.ts`: wide `ctaFloorPx` 32 / `ctaHeightFrac` 0.125; small budgets cap the floor (32, squares 28) and pill width (62%). |
| "Logos placement is wrong" on 2160×3840 | A centred stack leaves the lockup floating mid-panel on a tall panel; shipped OOH puts message + pill high and the lockup at the bottom. | `recompose.ts`: when the panel has ≥ 60% spare room, the lockup anchors to the bottom and message + pill centre on the upper part. |
| Flat JPG of a shipped ad re-cropped to 4:5, 9:16, 1080×1920 all wrong ("just the image, no brand collateral, cropped in the wrong place") | Baked-copy artwork must never be rebuilt into another shape. | `slots.isFlatArtwork`; adapt route returns 422 for other-shape targets; build planner skips those sizes with the reason. |
| Image-only GWD working file rebuilt to 300×600 wrong (glyph image cropped) | No live headline → nothing to re-set. | `recomposeToFormat` returns null without a headline slot; the flat gate then applies. |
| 14 Get Ready rebuilds (portrait, wide, landscape) marked right | The stack/columns recipes are sound. | None. |
| Brand-layout imports: earlier "AdobeStock …" spreads wrong, later "Page N" spreads right (one identical pair split) | Import-version noise, not a layout lesson. | None. |
