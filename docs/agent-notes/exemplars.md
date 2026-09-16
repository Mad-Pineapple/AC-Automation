---
name: Approved pieces as the reference (exemplars)
description: The schema behind "fix one size, mark it Right, and Redo makes the others follow it".
---

# Exemplars

**Rule.** In a family (a master and the pieces built from it), any piece whose latest designer
verdict is Right is an *exemplar*. Anything built or redone in that family afterwards follows the
exemplar, not the generic recipe.

## Schema (`lib/exemplars.ts`)

```
Exemplar {
  id, name, width, height, formatClass,
  config            // the approved layout as saved (manual edits included)
  measured: Partial<Recipe>   // proportions read off that layout:
     axis, photoFrac, bandFrac,
     ctaHeightFrac, ctaFloorPx, ctaMaxWidthFrac,
     lockupHeightFrac, lockupMaxWidthFrac,
     headlineWidthFrac, headlineMaxHeightFrac, headlineCentreFrac,
     subheadRatio, messageMaxRatio
  approvedAt
}
Reference = chooseReference(exemplars, width, height, excludeId)
  → same format class first, then closest shape (aspect distance);
  → distance ≤ 0.08: SCALE the exemplar itself       (method "scaled:approved")
  → otherwise:        REBUILD from the master with exemplar.measured overriding the class recipe
```

Nothing is stored beyond the verdict: exemplars are derived at adapt/redo time from `feedback`
(latest verdict per template) and the family link (`templates.source_template_id`).

## Where it applies

- `POST /templates/:id/redo` — the piece being redone is excluded from the candidates, so the
  approved sibling (or the approved master) leads. The response carries
  `redo.reference {id, name, width, height, scaled, note}` (null when nothing in the family is
  marked Right) and the editor toast names that piece. The Redo artwork button lives in the canvas
  toolbar beside Proportional and Guides.
- `POST /templates/:id/adapt` — new sizes follow approved siblings too.
- The reviewer sees it: `adaptNotes` gets "Follows the approved «name» (W×H): photo 57%, pill 12%
  of short axis, lockup 18%…" or "Scaled from the approved …".

## Limits (honest)

- Overrides cover proportions. A correction that is a *position* choice the recipe has no field
  for (e.g. moving the lockup to the top-left) does not transfer; the layout check and a Wrong
  will still catch it.
- An exemplar of a different axis family cannot dictate a strip's one-row layout.
- Only Right verdicts count; edits saved without a Right are not a reference.

## 2026-09-16 (audit fix P7)

- The reference is the layout that was **approved**: `approvedExemplars` builds the exemplar from the
  Right row's `subject_config` snapshot (live config only as a fallback for old verdicts).
- Only whole-piece verdicts count (`element_id IS NULL`); a Wrong filed as "fix next time" is a note,
  not a retraction.
- `measureRecipe` no longer exports an absolute `ctaFloorPx`; headline fractions are measured against
  the visible photo zone (clipped to canvas and seam), not the spilled element.
- Axis-bound overrides (axis, photo/band shares, headline position/size) apply only when the approved
  piece lays out along the same axis as the target class; pill/lockup/copy ratios always carry.
- Redo never follows the piece itself or a duplicate of its layout under another id.
- A structured Wrong moves geometry: `too_small` + "N px" sets the part's `minPx` on the campaign
  profile; `missing` / `cut_off` sets `dropWhenTight: false`. The response carries `ruleUpdated`.
- Approved-sibling scaling is skipped outside 0.5×–2× of the sibling's short side (rebuild instead).
