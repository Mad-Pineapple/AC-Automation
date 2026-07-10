---
name: object-storage-web composite tsconfig
description: Why the object-storage-web lib must be a composite project and built before consuming artifacts typecheck
---

When a web artifact (e.g. brand-studio) adds a TS project reference to a workspace
lib, that lib's `tsconfig.json` must set `composite: true` (plus `declarationMap`,
`emitDeclarationOnly`) and be built (`tsc --build`) so its `dist/*.d.ts` exist.

**Why:** The object-storage-web lib was copied in without composite settings;
referencing it from brand-studio failed with TS6306 ("must have setting composite:
true") and then TS6305 ("output file has not been built from source") until the lib
was built. Pure source-only libs work via the `exports`→`./src/index.ts` map for
Vite/runtime, but TS project references require emitted declarations.

**How to apply:** Mirror the existing lib tsconfigs (e.g. api-client-react): add
`composite/declarationMap/emitDeclarationOnly`, then run
`pnpm --filter @workspace/<lib> exec tsc --build` before typechecking the artifact.
