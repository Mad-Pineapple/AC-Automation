---
name: Server-side image upload for AI product images
description: How AI-generated images become short http URLs for HTML banners/assets, and why base64 must never reach a prompt.
---

# Server-side image upload (AI product images)

`generateProductImage` returns a base64 `data:` URL. That string must NEVER be
injected into an LLM prompt (multi-MB → context-limit overflow) and bloats the DB.

**Rule:** before using a product image, if it starts with `data:`, upload it via
`ObjectStorageService.uploadDataUrl()` and reference the returned short URL.

**How to apply:**
- `objectStorage.ts` provides `uploadBytes(buffer, contentType)` and
  `uploadDataUrl(dataUrl)`. They write to the private dir under `uploads/<uuid>`
  (same convention as the presigned flow), set a public ACL, and return the
  normalized `/objects/uploads/<id>` path.
- Build an absolute serving URL as `<base>/api/storage<objectPath>` where base is
  derived from request headers (x-forwarded-proto/host). The GET
  `/api/storage/objects/*` route is public (auth commented out), so the browser
  iframe (banner srcDoc) can load it.
- `generateHtmlBanner` only emits an `<img>` tag when `imageUrl` matches
  `^https?://`. Passing the short http URL restores the product visual; on upload
  failure pass null so no base64 leaks and no broken img is rendered.

**Why:** an earlier fix stopped banners crashing by not referencing the base64
image at all, which dropped the product visual. Uploading first restores imagery
without reintroducing the context overflow.
