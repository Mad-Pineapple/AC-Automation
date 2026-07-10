---
name: Knowledge feature (learned creatives)
description: How "learned creatives" are modeled and reused; the brand-size-gating bypass rule for knowledge templates in briefs.
---

# Knowledge feature

A "learned creative" (Knowledge tab) is just a freeform template row: `templatesTable`,
`config.kind:"freeform"`, `category:"knowledge"`, plus a `sourceImageUrl` (the original
artwork, stored as `/api/storage<objectPath>` like every other upload). It is produced by
vision-dissecting an uploaded image (POST /templates/dissect-image, admin-only) into
role-tagged FreeformElements (image elements get `src:null` + a role), which the existing
TemplateRenderer fills with new copy + imagery at brief time. No new render path was needed.

**Surfacing rule:** `category==="knowledge"` is the single discriminator. Knowledge tab lists
only those; the regular Templates tab filters them OUT. Both read the same `useListTemplates`.

## Brand-size-gating bypass (the non-obvious rule)
Briefs gate selectable sizes by `brand.supportedTemplateSizes`. Learned creatives are NOT in
any brand's supported list, so they MUST be whitelisted explicitly in briefs/New.tsx and
briefs/Edit.tsx — in both `availableSizeOptions` and the prune effect — via
`knowledgeKeys.has(key)`.

**Why:** a learned creative is brand-agnostic by design (reuse a layout across brands), so
tying it to supportedTemplateSizes would make it unselectable everywhere.

**How to apply:** any future change to brief size-option filtering must keep the
`|| knowledgeKeys.has(...)` escape hatch. Also: the prune effect must wait for
`customTemplates` to load (`if (!selectedBrand || !customTemplates) return;` + customTemplates
in deps) — otherwise on a cold load a preselected knowledge size (e.g. from
`/briefs/new?template=tpl_<id>`) is silently dropped before knowledgeKeys is populated.

## Learn page is a multi-upload review queue
The Knowledge "Learn" page accepts several images at once: it uploads + vision-dissects them
sequentially into a queue, and you review/name/save each (or "Save all").

**Why FreeformEditor needs a key:** FreeformEditor seeds its internal element state via
`useState(initialElements)` — it only re-seeds on MOUNT, never on prop change. So the review
editor MUST be keyed by something that changes when you want fresh seed data
(`key={\`${item.id}:${item.editorKey}\`}`): switching the active queue item changes the id
(remount with that item's working copy, so edits don't bleed between items), and "Revert"
bumps editorKey to remount with the original dissection. If you ever drop that key, edits leak
across items or revert silently no-ops. The same pattern applies anywhere FreeformEditor is
reused for multiple targets in one mounted screen.
