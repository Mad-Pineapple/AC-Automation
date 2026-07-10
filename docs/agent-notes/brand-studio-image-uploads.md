---
name: Brand Studio image uploads
description: How image file uploads must be handled in brand-studio forms (object storage, not base64 in JSON bodies).
---

Image file uploads in brand-studio forms (brief product image, brand assets, brand logo, PDF guideline) must go through `useUpload()` from `@workspace/object-storage-web`: call `uploadFile(file)` → returns `{ objectPath }`, then store the value as `/api/storage${objectPath}`.

**Why:** That URL format matches what the brand-assets API returns (`url: /api/storage${objectPath}`) and what the LibraryImagePicker stores, so previews and server-side rendering treat uploaded and library-picked images identically. Inlining the file as a base64 data URL (`reader.readAsDataURL`) into a field that is sent in a JSON request body overflows `express.json()` (capped at 1mb in api-server `app.ts`) and the request fails with 413 PayloadTooLargeError. This was the root cause of a "brief creation failing" report (POST /api/briefs → 413).

**How to apply:** In any new/edited form field that accepts an image file destined for a JSON request body, never use `readAsDataURL`. Use `uploadFile` and store the `/api/storage/...` URL; gate the submit button on `isUploading`.

Note: `briefs/Dispatch.tsx` intentionally still uses `readAsDataURL` — that path converts an image to a data URL for client-side export/attachment, not for a JSON request body, so leave it alone.

**Form validation gotcha:** any brand form field that holds an uploaded image URL (e.g. BrandForm `logoUrl`) must accept `/`-prefixed relative paths, not just `z.string().url()`. The stored value is `/api/storage/...` (relative), so a strict `.url()` refine silently rejects a just-uploaded/extracted logo and blocks Save. Accept `!v || v.startsWith("/") || /^https?:\/\//i.test(v)`.
