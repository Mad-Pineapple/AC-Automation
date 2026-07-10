---
name: Brand asset upload auth policy
description: Why brand-asset uploads are gated requireAuth (not requireAdmin), while deletes stay admin-only.
---

# Brand asset / object-storage upload auth

Brand-library uploads are intentionally open to **any signed-in user**, not admin-only:
- `POST /brands/:brandId/assets` → `requireAuth`
- `POST /storage/uploads/request-url` → `requireAuth`
- `DELETE /brand-assets/:id` → `requireAdmin` (deletes stay admin-only)
- `GET /brands/:brandId/assets` → `optionalAuth`

**Why:** A later "upload-permission" change deliberately opened uploads to all signed-in users. An earlier plan draft specified `requireAdmin` for all mutations; that was superseded.

**How to apply:** Do not "tighten" the upload endpoints back to `requireAdmin` thinking it's a bug — it's a deliberate product decision. Only the destructive delete is admin-gated.
