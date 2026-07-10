---
name: Brand compliance feature
description: How Brand Studio blocks off-brand artwork from approval/dispatch, and where the enforcement gate must stay consistent.
---

# Brand-guidelines compliance

Assets are checked against their brand's palette/guidelines and off-brand ones are
BLOCKED from approval and dispatch. Assets carry compliance columns:
`complianceStatus` (`passed`|`failed`|`skipped`|null), `complianceScore`,
`complianceIssues` (JSON string), `complianceCheckedAt`.

**The gate predicate.** An asset is blocked iff `complianceStatus === 'failed'`.
`null` means "not checked / legacy" and is ALLOWED. Server SQL uses
`complianceStatus is distinct from 'failed'` (so null passes); client uses
`complianceStatus !== 'failed'`.

**Why:** verdicts must never hard-fail generation, so any check error/timeout
becomes `skipped` (score null), which stays shippable. Legacy rows predate the
feature and must not be retroactively blocked.

## Every place the gate lives — keep them in lockstep
- Single approve: `assets.ts` returns 409 when `complianceStatus === 'failed'`.
- Bulk approve: `briefs.ts` UPDATE ... `is distinct from 'failed'`.
- Dispatch counts + scheduler: same `is distinct from 'failed'` predicate; both log a `blockedCount`.
- **Client dispatch export is the real deliverable gate.** The dispatch server
  route only counts/flips brief status; the PDF/ZIP/email bytes are generated
  client-side in `Dispatch.tsx` from `shippableAssets`. That filter MUST exclude
  `complianceStatus === 'failed'` or blocked art ships even though the server log
  says it was excluded. (This was a real bypass — the server WHERE clause alone is
  not enough.)

## Checks
- HTML assets: deterministic (`checkHtmlCompliance`) — extract colors, compare to
  palette via deltaE76 (ratio pass 0.8, tolerance 12). No AI.
- Image assets: `checkImageCompliance` gpt-4o vision (score pass 70), dominant
  colors as supporting evidence. `loadImageBytes` resolves the stored
  `/api/storage/<objectPath>` form, absolute http, or data URLs.
- Dispatcher `checkAssetCompliance` isolates each checker in try/catch + 30s
  timeout → `skipped` on any failure.

## Re-check on manual edits
Any manual edit to the artwork itself invalidates the stored verdict, so PATCH
`/assets/:id` re-runs the relevant check: `htmlContent` change → HTML check,
`imageUrl` change → image check. Text-only edits (headline/body/CTA) don't.
**Why:** a stale `passed` would let an edited-off-brand asset ship; a stale
`failed` would block a fixed one.

## Pre-generation steering
`openai.ts` injects the brand palette + any prior compliance feedback into BOTH
image and HTML generation prompts (briefs generate + assets regenerate). Generate
also does a post-gen check with one retry that keeps the better-scoring verdict;
a `skipped` retry (score 0) can't displace a real verdict.
