---
name: api-client type resolution & ReturnType quirk
description: How brand-studio resolves the api-client package for typecheck, and a TS quirk where query-hook data types collapse to {}.
---

`lib/api-client-react/tsconfig.json` is `composite: true` + `emitDeclarationOnly` → emits declarations to `lib/api-client-react/dist`. Consumers like `brand-studio` list it under tsconfig `references`, so **TypeScript resolves api-client types through the built `dist/*.d.ts`**, even though `package.json` `exports` point at `./src/index.ts` (that path is what esbuild/runtime bundles from). This mirrors `db-project-references.md` for `@workspace/db`.

So after a codegen/schema change you MUST rebuild the lib (`tsc --build`, which root `pnpm run typecheck` runs first) before the consumer typecheck is accurate. A per-artifact `pnpm --filter ... run typecheck` does NOT build libs first, so it reads stale `dist/*.d.ts`.

**Why:** observed phantom errors — `Brief` fields (`approvedByName`, etc.) reported missing in `brand-studio` even though the generated `src` had them — because the composite `dist/*.d.ts` was stale; `tsc --build` cleared them. Do NOT assume "the src has it, so the consumer sees it."

**TS generic-default quirk:** deriving a type as
`NonNullable<ReturnType<typeof useSomeGetQuery>["data"]>`
collapses to `{}`. The orval hooks are generic with a default `TData = Awaited<ReturnType<typeof getFn>>`; when you take `ReturnType<typeof hook>` with no explicit type arg, TypeScript does NOT apply that default, so `data` resolves to `{}`. This is independent of whether the underlying schema is correct (`getFn` itself returns the right type).

**Why:** TS instantiates an un-applied generic's return type without its default, yielding an empty object type.

**How to apply:** for a prop/variable type, import and use the generated schema type directly (e.g. `type Brand` from `@workspace/api-client-react`) instead of the `ReturnType<typeof useXQuery>["data"]` pattern.
