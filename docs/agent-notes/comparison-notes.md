---
name: Comparison notes feature
description: How shared-comparison notes are stored and keyed in Brand Studio.
---

Teammates can leave notes on a shared comparison (the ?compare=A,B overlay in the Approve screen).

- Notes are tied to an **unordered asset pair**, stored normalized as `(assetIdLow, assetIdHigh)` = `(min, max)`. So a note added on the A,B comparison also shows on B,A (and survives the Swap button).
- API: `GET /api/comparison-notes?assetA=&assetB=` (optionalAuth — readable on shared links) and `POST /api/comparison-notes` (requireAuth). Server snapshots `authorName` from `req.user.name` at write time.

**Why:** comparison is symmetric; keying by the raw (A,B) tuple would split notes across two rows. Snapshotting author name keeps notes readable even if a user is later removed (authorId is `on delete set null`).
