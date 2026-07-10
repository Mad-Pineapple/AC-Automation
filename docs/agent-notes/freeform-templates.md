---
name: Freeform templates (PDF import)
description: How freeform/dissected templates are stored and rendered, and the overrideConfig gotcha that silently renders them as preset.
---

Freeform templates (e.g. dissected from a PDF) are stored INSIDE `templates.config` JSON as a
soft-discriminated shape: `{ kind: 'freeform', elements: FreeformElement[] }` (preset templates omit
`kind`/`elements`). No separate DB column. Coordinates are top-left origin, 1pt==1px, z-order = array
index. Image elements store `src='/api/storage/objects/...'` (bytes live in object storage, never inline).

`TemplateRenderer`/`TemplateThumbnail` branch to `FreeformCanvas` only when the *resolved* config has
`kind==='freeform'` AND `elements`. Text is filled by role at render time: role `headline` ← `headline`
prop, `body`/`subhead` ← `bodyText`, `cta` ← `callToAction`, image role `product` ← `imageUrl`.

**Gotcha (caused a real bug):** when you pass `overrideConfig` to the renderer/thumbnail, it REPLACES
the registry lookup — so you must include `kind` and `elements` in `overrideConfig`, or a freeform
template silently renders as a preset BrandCanvas. Render paths that pass only `templateSize={key}`
(no overrideConfig) are fine because they resolve via the registry, which `registerTemplateConfigs`
populates with `kind`/`elements`.

**Why:** the List thumbnail passed `overrideConfig` with only `layout`, dropping `kind`/`elements`,
so dissected templates looked like presets in the grid even though briefs rendered them correctly.

**How to apply:** any new call site that builds `overrideConfig` by hand must carry `kind` +
`elements` for freeform support. Prefer relying on the registry (pass just the key) when possible.

Server validation (`normalizeFreeformConfig` in api-server) runs on create, patch AND read
(parseConfig) — caps element count, whitelists colors/src schemes, clamps font props — so hand-edited
or legacy rows are sanitized on the way out too. Dissection is page-1-only (v1).

**Editor↔renderer fidelity contract:** `FreeformEditor` (the visual drag/resize editor used by
ImportPdf + Edit) MUST mirror `FreeformCanvas` so the editor preview matches the exported asset.
- Both import the SAME shared style helpers from TemplateRenderer (`freeformBaseStyle`,
  `freeformTextStyle`, `freeformRectStyle`, `freeformImageStyle`, `defaultImageFit`). Never re-inline
  element styling in the editor — that reintroduces drift.
- The editor paints a WHITE page background (`#ffffff`) to match FreeformCanvas, which always renders
  white (a PDF page is white by default; any colour is captured as a rect element). Do NOT use
  `brand.backgroundColor` for the editor canvas.
- **Key split:** the brief RENDERER fills text/image by role (`fillRoleText`/`fillRoleSrc`, falling back
  to captured values); the EDITOR shows RAW `el.text`/`el.src`. Don't make the editor role-fill.
**Why:** the feature's whole value is faithful *editable* rebuild — WYSIWYG between editor and output.

## Only role `product` images auto-fill; list preview injects sample copy
`fillRoleSrc` auto-fills ONLY image role `product` from the brief's generated `imageUrl` (falling back
to `el.src`). `logo`/`decoration` images are NOT injected — they render `el.src` only, so a template
that must show a logo has to bake the logo URL into `el.src`. (Note: a brand's `logo_url` may actually
point to a photo, not a transparent logo — check before using it as a logo `src`.) Separately, the
Templates LIST preview injects sample copy (headline = template NAME, plus sample body + "Shop Now")
that overrides `el.text` for roles `headline`/`body`/`subhead`/`cta`; role `other` always shows raw
`el.text` (use it for a fixed wordmark/label). So preview text ≠ your stored placeholders for those roles.
