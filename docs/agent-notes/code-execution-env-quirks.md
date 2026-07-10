---
name: Running server-context one-off jobs (sandbox vs shell)
description: How to host an object/run server-style code outside the api-server process, and the env/import gotchas that block it.
---

# Running server-context one-off jobs

When you need to do something the api-server normally does (e.g. upload bytes to
object storage, hit the Replit sidecar, touch the DB) but from a one-off job,
mind these environment quirks — each one cost a failed attempt:

- **The `code_execution` sandbox does NOT inherit the repl's secret env vars.**
  `process.env.PRIVATE_OBJECT_DIR` (and other secrets) are undefined there. The
  **bash/shell tool DOES** have them injected. So run server-style jobs that need
  secret env as a plain `node /tmp/foo.mjs` in bash, not in the sandbox.
- **`viewEnvVars` cannot return secret VALUES** (only existence). Don't try to
  read a secret's value to pass into the sandbox — just run in the shell instead.
- **Sandbox bare imports resolve from the workspace ROOT**, where artifact-local
  deps aren't hoisted. `await import("@google-cloud/storage")` fails. Use
  `createRequire("/home/runner/workspace/artifacts/api-server/package.json")` and
  `require("@google-cloud/storage")` anchored at the package that owns the dep.
- **`pnpm exec tsx` / `node --import tsx` both fail here** (no direct tsx bin;
  api-server is esbuild-bundled). To run a one-off either use the documented tsx
  path in `running-oneoff-scripts.md`, or write a plain `.mjs` and run with
  `node`, using `createRequire` to load the artifact's deps.

**Object storage upload recipe (replicates `ObjectStorageService.uploadBytes`):**
build a `@google-cloud/storage` client with the sidecar external_account creds
(token_url/credential at `http://127.0.0.1:1106`), save bytes to
`${PRIVATE_OBJECT_DIR}/uploads/<uuid>`, set custom metadata
`custom:aclPolicy = {owner:"system",visibility:"public"}`, then reference it as
`/api/storage/objects/uploads/<uuid>`. The `GET /storage/objects/*` route serves
public objects with NO auth/ACL gate (the check is commented out), so the path
loads from the browser directly.

**Why:** brand logos / hosted images must be same-origin (`/api/storage/...`), not
hotlinked externals — asset export uses html-to-image DOM capture, which a
cross-origin image taints, breaking export.
