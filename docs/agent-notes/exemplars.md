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
