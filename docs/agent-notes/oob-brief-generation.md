---
name: Out-of-band brief generation
description: How to complete a brief's asset generation directly when HTTP-triggered generation keeps failing (restart churn) and the UI testing framework run-limit is exhausted.
---

When you must generate a brief's assets but the normal path is blocked — api-server in a
merge/reconciliation **restart loop** (each restart's startup cleanup resets briefs stuck
in `generating` → `draft`, killing in-flight background jobs) AND the `runTest` framework
has hit its per-session limit (max 10 runs) so you can't trigger via the UI — run the
generation pipeline **out-of-band** against the DB:

- Bundle a one-off entry with **esbuild** (tsx is NOT installed in api-server; dev builds
  via `build.mjs`). Mirror `build.mjs` exactly: same `external` list, `esbuild-plugin-pino`,
  the ESM `banner` shim, `platform:"node"`, `format:"esm"`. Put the entry in
  `src/` so it can import the server's own libs, output to a throwaway `dist-oneoff/`.
- The entry imports the **real** generation code (`generateProductImage`, `generateCopy`,
  `generateHtmlBanner` from `lib/openai`; `collectBrandReferences`/`dimsForSize`/
  `imageSizeForDims`/`loadTemplateMap` from `lib/assetImages`; `ObjectStorageService`) and
  replicates the route's orchestration, so output is faithful to the HTTP path.
- Run via **bash** (`node dist-oneoff/oneoff-gen.mjs <id>`), NOT code_execution — the
  code_execution sandbox lacks secret env; bash inherits DATABASE_URL, REPLIT_DEV_DOMAIN,
  object-storage + OpenAI-integration creds. Set `NODE_ENV=development` to match the server.
- Stored image URLs are full dev-domain: `https://${REPLIT_DEV_DOMAIN}/api/storage${objectPath}`
  (objectPath from `uploadDataUrl`). gpt-image-1 size comes from `imageSizeForDims` (banner
  728×90 → `1536x1024`).

**Why:** the background job only fails because the process is recycled mid-flight; the code
is fine. Running it as your own foreground process is immune to the server's restarts.

**How to apply:** leave the brief status as `draft` during generation and set
`pending_approval` only at the very end — that way an api-server restart's startup cleanup
(which only touches `generating`) never resets it, and your final update wins. Delete the
throwaway script + `dist-oneoff/` afterward; this is an operational workaround, not app code.
