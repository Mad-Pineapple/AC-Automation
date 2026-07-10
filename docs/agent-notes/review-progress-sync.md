---
name: Review progress server sync
description: How reviewed-asset progress is persisted server-side per brief+user, with localStorage as offline fallback
---

Review progress (which assets a reviewer has previewed) on the Review Assets page is persisted server-side per `(briefId, userId)` with a unique constraint, exposed via `GET`/`PUT /briefs/{id}/review-progress`.

**Rule:** the server is the source of truth; localStorage is only an offline cache/fallback. On hydrate, if the server query succeeds use its ids (filtered to currently-existing asset ids); only fall back to localStorage when the server is unreachable. On every change, write localStorage *and* fire the save mutation (failures non-fatal).

**Why:** progress used to be localStorage-only — private to one browser/device and invisible to teammates on shared reviews.

**How to apply:** reviewed ids are stored JSON-stringified in a `text` column (matching the codebase's array-as-text convention, e.g. briefs.templateSizes), not a pg array/jsonb. The PUT upserts via `onConflictDoUpdate` on the brief+user unique constraint. In the dev preview iframe the auth cookie 401s, so the query errors and localStorage fallback kicks in — test server sync in a real authenticated tab.
