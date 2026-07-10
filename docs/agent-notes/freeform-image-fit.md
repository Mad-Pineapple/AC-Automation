---
name: Freeform image fit (cover/contain)
description: How/why freeform template image elements choose objectFit, and the anti-drift rule.
---

# Freeform image fit

Image elements in freeform templates choose `objectFit` via `defaultImageFit(role)` in
TemplateRenderer.tsx: role "logo" → `contain` (never crop a logo), everything else → `cover`
(fills the area). An explicit per-element `fit` ("cover"|"contain") always overrides the default.

**Why:** logos rendered with `cover` get cropped/distorted → unpolished artwork; users asked that
imagery "fit the image area." Role-aware defaults make output polished without per-asset fiddling,
while the explicit `fit` toggle (editor image inspector) gives manual control.

**How to apply:** the default expression lives ONLY in `defaultImageFit` and is shared by the
renderer (`freeformImageStyle`) and the FreeformEditor toggle's active-state. Do NOT re-inline the
`role === "logo" ? …` check anywhere — renderer and editor must not drift. `fit` is double-validated
(server sanitizer in freeform.ts + renderer guard) down to the two literals before it lands in a
style attribute.
