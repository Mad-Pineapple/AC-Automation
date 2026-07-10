---
name: db lib type resolution via project references
description: Why api-server tsc errors about missing @workspace/db exports/columns are usually stale dist, not real schema problems
---

# @workspace/db types resolve through `dist/*.d.ts`, not `src`

`lib/db/tsconfig.json` is `composite: true` + `emitDeclarationOnly` → emits declarations to `lib/db/dist`. Consumers like `artifacts/api-server` list it under tsconfig `references`, so **TypeScript resolves db types through `lib/db/dist/*.d.ts`**, even though `package.json` `exports` point at `./src/index.ts` (that path is what esbuild/runtime bundles from).

**Why this matters:** If the schema source changes (new table/column) but `dist` is not rebuilt, `tsc` reports phantom errors like "Module '@workspace/db' has no exported member 'usersTable'" or "Property 'createdBy' does not exist". These are NOT real schema problems - the runtime works fine because esbuild bundles from `src`. They are stale declaration output. Downstream cascade: broken db types make inferred params `any`, which then trips `noImplicitAny` (TS7006) in unrelated route files.

**How to apply:** After any change to `lib/db/src/schema/*`, rebuild the db declarations before trusting (or before a clean) typecheck:
- `pnpm exec tsc --build lib/db/tsconfig.json --force` (the `--force` matters; a stale `.tsbuildinfo` can make `--build` skip re-emitting `index.d.ts`, leaving TS6305 "Output file has not been built from source").
- Then typecheck consumers with `tsc --build` (NOT `tsc --noEmit`) so project references are honored, e.g. `pnpm exec tsc --build artifacts/api-server/tsconfig.json`.
- Symptom that confirms staleness: orphan files in `lib/db/dist/schema` (e.g. tables no longer in `src`) - safe to `rm -rf lib/db/dist .tsbuildinfo` and force-rebuild.
