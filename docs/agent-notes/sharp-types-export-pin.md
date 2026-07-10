---
name: sharp version pin (types export)
description: Why api-server pins sharp to 0.34.x instead of 0.35.x — a TS resolution break.
---

api-server pins `sharp` to the **0.34.x** line. Do not bump it to 0.35.0 without checking the types.

**Why:** sharp 0.35.0 added an `exports` map that omits the `types` condition. Under TS
`moduleResolution: "bundler"` (what this repo uses), that makes `tsc` unable to find sharp's type
declarations, so `import sharp from "sharp"` fails typecheck. The 0.34.x line has **no** `exports`
field, so TS falls back to the top-level `"types"` entry and resolves fine. 0.35.1 (which may fix it)
was blocked at the time by pnpm's `minimumReleaseAge` gate.

**How to apply:** if you must upgrade sharp, first confirm the new version's `package.json` `exports`
includes a `types`/`import` types condition (or that a top-level `types` still resolves under bundler
resolution). Otherwise keep the 0.34.x pin. Runtime behavior of 0.34.x is fine (smoke-tested).
