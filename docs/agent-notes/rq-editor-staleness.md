---
name: React Query uncontrolled-editor staleness
description: Uncontrolled editors seeded from a React Query cache show stale data after save+reload unless keyed by updatedAt.
---

An uncontrolled editor/form that seeds its internal `useState` from a React
Query result will show STALE (pre-edit) data after save → navigate away →
navigate back, even though the DB and the server response are correct.

**Why:** After a mutation we invalidate the detail query and navigate away, so
its observer unmounts before the refetch fires — the cache keeps the old value
(only marked stale). On return, React Query serves the cached old value first;
the editor's `useState` captures it once; the background refetch then updates
the query data but `useState` never re-syncs → stale UI. Caught via e2e: the DB
held the edit but the editor still showed the original text.

**How to apply:** For any uncontrolled editor initialized from a fetched
entity, key the wrapper component by the entity's `updatedAt` (or a version) so
fresh data forces a remount + re-init, and set the detail query's
`refetchOnMount: "always"` so entering an edit screen always reads the latest.
Brand Studio reference: artifacts/brand-studio/src/pages/templates/Edit.tsx
(FreeformEditSection keyed by template.updatedAt).
