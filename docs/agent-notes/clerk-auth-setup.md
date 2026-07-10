---
name: Clerk Auth Setup
description: Durable decisions and constraints for Clerk auth in Brand Studio.
---

## Role model decisions

- First authenticated user → admin; all subsequent users → user. No UI for role changes yet.
- Admins: full CRUD on brands + can mutate any brief/asset.
- Users: read all briefs/assets (team collaboration), mutate only their own (by `briefs.created_by`).
- Brand nav is hidden for non-admins in the sidebar.

**Why:** Team of up to 10 sharing brand assets - full isolation would break collaboration. Ownership enforced on mutations only.

## Public read / protected write model

- The app is intentionally browsable WITHOUT signing in: all GET (read) endpoints use `optionalAuth`; every POST/PATCH/DELETE keeps `requireAuth`/`requireAdmin`.
- `optionalAuth` (in `requireAuth.ts`) attaches `req.user`/`req.clerkUserId` when a valid session exists, else calls `next()` without 401. Both it and `requireAuth` share a `resolveUser(req)` helper.
- Any user-scoped read filter (e.g. `?mine=true` on `/briefs`, `/stats/*`) MUST guard on `req.clerkUserId` being present, or a guest request builds `eq(col, undefined)`.
- Frontend has NO forced login gate; `App.tsx` renders routes for everyone, `Layout.tsx` shows a "Sign in" CTA for guests. `/me` returns 401 for guests and `useMe` handles null gracefully.

**Why:** User wanted the tool visible without a login wall while keeping data safe to modify. Keep this read-public/write-protected split whenever adding endpoints.

## Authorization pattern

- `requireAuth` middleware JIT-provisions a `users` row from Clerk session claims on first login. Sets `req.clerkUserId` and `req.user` on Express Request.
- `canMutate(brief, req)` helper: `req.user.role === 'admin' || brief.createdBy === req.clerkUserId`.
- Asset mutations check parent brief ownership.
- Express types extended via `src/types/express.d.ts` - do NOT use `any` casts for `req.clerkUserId` or `req.user`.

**Why:** Type declaration prevents future regressions where auth context is silently ignored.

## Key constraint: generated API client

- `useGetDashboardStats` / `useGetRecentActivity` from `@workspace/api-client-react` do NOT accept custom query params like `?mine=true`.
- Dashboard uses raw `fetch` + `useQuery` directly. Do NOT try to pass params through the generated hooks.

**Why:** Generated from OpenAPI spec - adding params there requires a codegen pass, which is a separate task.

## CSS / Vite constraint

- `@layer theme, base, clerk, components, utilities;` must appear before `@import "tailwindcss"` in `index.css`.
- `tailwindcss({ optimize: false })` in `vite.config.ts` is required - Clerk CSS layers get reordered in prod builds without it.
