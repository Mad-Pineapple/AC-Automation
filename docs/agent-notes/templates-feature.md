---
name: Templates feature - config resolution & key model
description: How custom creative-format templates resolve their layout/dimensions and why assets are not snapshotted in Brand Creative Studio.
---

# Custom templates: live-render model

Brand Creative Studio renders assets **live** from current config, not from a per-asset
snapshot. Built-in sizes resolve from `SIZE_CONFIGS`; brand edits already re-render existing
assets. Custom templates follow the same rule.

- A template's stable key is **derived** in the API as `tpl_<id>` (there is no `key` column).
  Assets store only this key in `assets.template_size`.
- The frontend resolves a key's dimensions/layout from a **module-level reactive registry**
  in `TemplateRenderer.tsx` (`registerTemplateConfigs` via `useSyncExternalStore`;
  `getTemplateConfig`/`getTemplateLabel` for non-React code like gif/zip export).
  `TemplateRegistry` (mounted in AppRoutes) loads templates once and registers them.

**Why no snapshot:** edit-drift (an edited template re-rendering old assets) is *by-design*
here because the whole app already live-renders from current brand/size config. Adding a
per-asset config snapshot would be inconsistent with that and is out of scope.

**Why delete is protected:** built-ins can never be deleted, so deletion is the only *new*
failure mode - a deleted custom template would make `getTemplateConfig` fall back to
`social_square` (wrong dims). So `DELETE /templates/:id` returns **409** if any asset
references `tpl_<id>`.

**How to apply:** if you ever need true historical fidelity, snapshot the resolved config
onto the asset at generation time and resolve from that first, registry second - but only if
the product requirement changes. Keep create/edit/delete admin-gated (mirror brands pages:
`useMe` → `role === "admin"`, redirect non-admins).

## Creating/editing templates programmatically (agent path)
`POST`/`PATCH /templates` are `requireAdmin` (Clerk), so the reliable agent path (no token) is a
direct `templates` row insert/update. Store `config` as JSON `{ kind: "freeform", elements: [...] }`
(or a preset config object). `parseConfig` runs `normalizeFreeformConfig` on READ, so slightly-off
stored JSON is sanitized on the way out — but still match the FreeformElement shape. The running
api-server needs no restart (reads per request); the client picks it up on the next Templates fetch.
