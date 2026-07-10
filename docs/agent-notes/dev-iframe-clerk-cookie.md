---
name: Dev embedded-iframe Clerk cookie 401
description: Why requireAuth endpoints 401 (and admin-only UI hides) when the app runs inside the embedded Replit preview/Canvas iframe in dev.
---

# Symptom
Signed-in user (Clerk client shows them logged in) gets 401 from every
`requireAuth` endpoint (`/api/me`, `/api/storage/uploads/request-url`,
`/brands/:id/analyze-guideline`, etc.). Effects: `isAdmin` resolves false →
admin-only UI (e.g. Brand Details PDF uploader) renders read-only / hidden, and
uploads "don't seem to work."

# Root cause
The app is being used **inside the embedded Replit preview / Canvas iframe**. That
is a third-party (cross-site) browsing context, so the browser refuses to send the
Clerk `__session` cookie to the api-server. The client session works (Clerk keeps
it client-side) but `getAuth(req).userId` is null server-side → 401.

**Why:** Clerk dev (pk_test, no proxy) sets a first-party `__session` cookie on the
app's own domain; that cookie is only sent when the app is the **top-level**
document, not when it's iframed.

# How to confirm / not waste time
- The wiring is NOT the bug: ClerkProvider (App.tsx), server `clerkMiddleware`
  (app.ts), `clerkProxyMiddleware` (prod-only), and the Vite `/api` proxy all
  match canonical. Don't keep diffing them.
- Public reads are `optionalAuth` so they 200/304 regardless — they tell you
  nothing about auth.
- Server-side auth genuinely works in a normal browser tab (the `users` table has
  real rows; first authed user = admin).
- Proven via the `testing` skill with `testClerkAuth: true`: sign in, capture the
  DB id from `GET /api/me`, `[DB] UPDATE users SET role='admin' WHERE id=<that id>`,
  reload → uploader visible, `request-url` 200, real PDF upload + analysis works.
  (Promoting "newest row" is flaky — promote the exact id `/api/me` returns.)

# Fix
Open the app in a **dedicated top-level browser tab** (preview "Open in new tab"),
not the embedded iframe. Production is unaffected: the deployed app uses the Clerk
proxy and is visited top-level, so cookies are first-party.

**Do NOT** add Bearer/`getToken`/`setAuthTokenGetter` to the web client to "fix"
this — the clerk-auth skill forbids it; it's an environment context issue, not a
token issue.

# In-app safety net (so the failure isn't silent)
The global `Layout` shows a "session unrecognized" banner with an "Open in new tab"
button when `clerkLoaded && isSignedIn && meFetched && meData === null` — i.e. Clerk
client says signed-in but `/api/me` returned 401. It's presentational only.

**Invariant:** `useMe`'s queryFn must return `null` **only on HTTP 401**, and throw
on other non-OK statuses. **Why:** the banner keys off `meData === null`; if `useMe`
mapped 500/502 (e.g. api-server restart/EADDRINUSE) to `null`, the iframe-specific
banner would false-positive in a healthy top-level tab where "Open in new tab"
wouldn't help. Don't loosen it back to `if (!res.ok) return null`.
