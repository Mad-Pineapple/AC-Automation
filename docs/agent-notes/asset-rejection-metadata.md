---
name: Asset rejection metadata
description: Where rejection who/when/reason lives on assets and how it is cleared, so display and capture stay in sync.
---

Assets carry `rejectedBy` (clerkId), `rejectedAt`, and `rejectionReason`. The reject
endpoint stamps who + when, and already accepts an optional `reason` in the request
body — so a "capture a reason" UX only needs to send that field, not add schema or
endpoint plumbing. The review summary resolves `rejectedByName` by joining the users
table (aliased) in the list endpoint; single-asset responses look the name up in
`formatAsset`.

**Why:** rejection display and rejection-reason capture were split across two tasks;
storing/clearing was done once so they don't both add the same column.

**How to apply:** approve and regenerate must clear all three fields in lockstep, or
a re-approved/regenerated asset keeps showing as rejected on the summary. The only
reject *trigger* in the frontend is the compare view (AssetCompare.tsx); it opens an
optional-reason dialog and sends `{ id, data: { reason } }`. There is no per-card
reject on the review grid.

**Gotcha:** the rejection fields (rejectedBy/rejectedByName/rejectedAt/
rejectionReason on Asset, plus AssetRejectInput) can be present in the api-client-react
*source* generated files but missing from the committed built `dist/*.d.ts`. Consumers
typecheck against dist, so brand-studio fails with "Property 'rejectionReason' does not
exist on type 'Asset'". Fix by rebuilding: `tsc --build lib/api-client-react/tsconfig.json`
(root `typecheck:libs` currently dies early on integrations-openai-ai-react missing react).
