---
name: Auth auto-provision vs user removal
description: Why hard-deleting a user row does not revoke access under the Clerk auto-provisioning auth model, and the blocklist pattern that fixes it.
---

Deleting a row from `users` does NOT durably remove a member. `resolveUser()` in
the api-server auth middleware auto-creates a `users` row for any valid Clerk
session whose `clerkId` has no row yet — so a "removed" member silently
re-provisions (as role `user`) on their next request and regains access.

**Rule:** Any durable revocation must outlive the user row. Removal records the
member's `clerkId` in a `blocked_users` table; `resolveUser` checks that
blocklist before auto-provisioning and returns null (→ 403 "deactivated" path /
401) if blocked. Deactivation (reversible) uses `users.deactivatedAt` instead.

**Why:** auth auto-provisions unknown-but-authenticated Clerk identities by
design (first user → admin, rest → user). A deny decision therefore cannot live
only in the row being deleted.

**How to apply:** any feature that "bans"/"removes"/"permanently revokes" a user
must persist a clerkId-keyed denial that the auto-provision path consults, not
just delete the row. Reversible disabling should set a flag on the row instead.
