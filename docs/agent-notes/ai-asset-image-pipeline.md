---
name: AI asset image pipeline
description: How generated asset images are steered (brand/template refs) and sized to cover the canvas.
---

Generated ad-asset images must (1) follow the brand's own images + the template's image, and
(2) cover the entire canvas. Two server routes produce them: the brief generate route and the single
asset regenerate route. Both go through the shared helper module `artifacts/api-server/src/lib/assetImages.ts`.

**Rules baked into the shared helpers:**
- Pick the gpt-image-1 output size from the canvas orientation (landscape → 1536x1024, portrait →
  1024x1536, else 1024x1024) so the image covers/fills the canvas instead of being a cropped square.
  Canvas dims come from built-in size names or a `tpl_<id>` template row.
- Steer generation with up to 3 reference images via image-to-image (OpenAI images.edit): the template's
  product-image element first, then the brand's uploaded `kind:"image"` brand_assets. If no refs or the
  edit fails, fall back to plain images.generate.
- Reference images are **downscaled** (sharp, ~1024px JPEG) before sending — raw brand/template assets
  can be tens of MB print files that exceed the API's input limits and stall every call. Downloads are
  best-effort with a timeout; a bad/slow ref is dropped, never aborts the whole generation.
- The generated base64 is persisted to object storage and stored as a `/api/storage/...` URL — never
  write a raw base64 data URL into the DB.

**Why shared module:** the two routes previously duplicated this logic; this codebase has a documented
history of duplicated render/helper logic drifting apart. Keep both routes calling assetImages.ts.

**How to apply:** any new path that generates an asset image should reuse `loadTemplateMap`,
`dimsForSize`, `imageSizeForDims`, and `collectBrandReferences` from assetImages.ts rather than
re-deriving sizes or re-collecting references.
