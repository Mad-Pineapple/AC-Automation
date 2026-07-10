---
name: orval codegen drift
description: Why regenerating the orval client can silently drop types and break the frontend, and how to recover.
---

In this monorepo the generated React Query client (`lib/api-client-react/src/generated/`) is committed to git. `lib/api-spec/openapi.yaml` is hand-maintained and is the single source of truth for codegen (`pnpm --filter @workspace/api-spec run codegen`).

The committed client had **drifted**: it contained types/paths that were never described in `openapi.yaml` (hand-edited or from an older spec). A faithful regeneration rebuilds strictly from the spec and therefore **drops** anything not present, which breaks `brand-studio` typecheck wherever the frontend relied on those dropped types.

**Why:** codegen output is a build artifact derived only from the spec. Anything the frontend imports must exist in `openapi.yaml`, or the next regen deletes it.

**How to apply:** before running codegen, diff the committed generated client against the spec for anything the frontend uses. If you find drift, restore the missing schemas/paths into `openapi.yaml` first, then regenerate. After codegen, the `typecheck:libs` step may exit nonzero due to an unrelated pre-existing error in `lib/integrations-openai-ai-react` (missing `react` types) - the orval generation itself still succeeds; verify by inspecting the generated files.
