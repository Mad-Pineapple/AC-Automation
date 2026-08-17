# Brand Creative Studio

AI-assisted brand creative studio for Auckland Council: manage brands and brand guidelines, generate on-brand creative assets (banners, social tiles, animated formats) from briefs with OpenAI, review/approve them with automated brand-compliance checks, and export the final deliverables.

## Architecture

pnpm monorepo, Node.js 24, TypeScript.

- `artifacts/api-server` — Express 5 API (`/api/*`), also serves the built frontend in production. Port 8080 by default.
- `artifacts/brand-studio` — React 19 + Vite frontend (Tailwind, Radix, TanStack Query, wouter).
- `lib/db` — PostgreSQL via Drizzle ORM (`pg` driver). Schema in `lib/db/src/schema/`.
- `lib/api-spec` / `lib/api-zod` / `lib/api-client-react` — OpenAPI spec + generated Zod schemas and React Query hooks (Orval).
- `lib/integrations-openai-ai-server` — OpenAI client (chat: `gpt-4o-mini`, images: `gpt-image-1`).
- Auth: Clerk (`@clerk/express` + `@clerk/react`). First signed-in user becomes admin. Reads are public, writes require auth.
- File storage: local filesystem (`OBJECT_STORAGE_DIR`, default `./data/objects`) or Vercel Blob (auto-selected when `BLOB_READ_WRITE_TOKEN` is set). Both use the same keys, so `/objects/...` paths in the DB are backend-agnostic. Uploads flow through `/api/storage/*` either way.
- `docs/agent-notes/` — architecture and feature decision notes.

## Environment variables

### API server (runtime)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `OPENAI_API_KEY` | yes | OpenAI API key (creative + image generation, compliance checks) |
| `OPENAI_BASE_URL` | no | Override OpenAI endpoint (proxy/gateway); defaults to api.openai.com |
| `CLERK_PUBLISHABLE_KEY` | for auth | Clerk publishable key |
| `CLERK_SECRET_KEY` | for auth | Clerk secret key |
| `SEED_DEMO_BRAND` | no | `0` = skip the Auckland Council demo-brand seed (white-label install: the app starts with a neutral skin and takes on the first brand you create) |
| `DEV_AUTH_BYPASS` | no | `1` = treat every request as a local admin, ONLY honoured when Clerk keys are absent. Local dev/preview only — never set in production |
| `PORT` | no | Defaults to 8080 |
| `OBJECT_STORAGE_DIR` | no | Uploaded/generated file storage dir (fs driver), defaults to `./data/objects` — must be a persistent volume in production |
| `BLOB_READ_WRITE_TOKEN` | on Vercel | Vercel Blob store token; its presence switches file storage to the Blob driver |
| `STORAGE_DRIVER` | no | Force the storage backend: `fs` or `vercel-blob` (default: auto by token presence) |
| `BLOB_STORE_BASE_URL` | no | Blob store public base URL; only needed if it can't be derived from the token |
| `CRON_SECRET` | no | If set, `/api/cron/*` routes require `Authorization: Bearer <secret>` (Vercel Cron sends it automatically) |
| `FRONTIFY_PORTAL_URL` | no | Public Frontify portal to sync the library from (defaults to the AC portal) |
| `FRONTIFY_SYNC_MAX_NEW` | no | Max new assets fetched per `/api/cron/frontify-sync` run (default 40) |
| `FRONTIFY_SYNC_SOURCES` | no | Comma-separated folder allowlist for the sync (e.g. `Logos,Illustrations`); default all |
| `FRONTIFY_BRAND_NAME` | no | Brand whose library the sync targets (default `Auckland Council`) |
| `STATIC_DIR` | no | Frontend build dir; defaults to `../brand-studio/dist/public` relative to the server bundle |
| `LOG_LEVEL` | no | pino log level |

### Frontend (build time)

| Variable | Required | Description |
|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | yes | Same Clerk publishable key, baked in at `vite build` |
| `VITE_CLERK_PROXY_URL` | no | Only if proxying Clerk's frontend API through your domain |
| `BASE_PATH` | no | Base URL path, defaults to `/` |

Clerk is optional: with no keys the app runs read-only (no sign-in, writes 401). Add `DEV_AUTH_BYPASS=1` to use the full app locally as an auto-provisioned admin without Clerk.

## Develop

```sh
pnpm install
DATABASE_URL=postgres://localhost:5432/brand_studio pnpm --filter @workspace/db run push   # create/update schema
pnpm --filter @workspace/api-server run dev    # API on :8080 (env vars above)
pnpm --filter @workspace/brand-studio run dev  # Vite dev server on :25611, proxies /api to :8080
```

`pnpm run typecheck` — full typecheck. `pnpm run build` — typecheck + build everything.

After changing the OpenAPI spec: `pnpm --filter @workspace/api-spec run codegen`, then rebuild libs (`pnpm run typecheck:libs`).

## Deploy

### Vercel

The repo is pre-configured for Vercel ([vercel.json](vercel.json)): the frontend is served as static files from Vercel's CDN, and all `/api/*` + `/track/*` traffic is handled by a single serverless function (`api/index.mjs`, an esbuild bundle of the Express app built from `artifacts/api-server/src/vercel.ts`).

One-time setup:

1. **PostgreSQL** — any serverless-friendly provider (Neon, Supabase, Vercel Postgres). Push the schema once: `DATABASE_URL=... pnpm --filter @workspace/db run push`.
2. **Vercel Blob store** — create one in the Vercel dashboard (Storage → Blob) and connect it to the project; that sets `BLOB_READ_WRITE_TOKEN`, which switches file storage to Blob automatically.
3. **Project env vars** (Settings → Environment Variables): `DATABASE_URL`, `OPENAI_API_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` (build-time, same value as the publishable key), and optionally `CRON_SECRET`.
4. Deploy: `npx vercel` from the repo root (or connect a Git repo). Install/build commands and output directory come from vercel.json.
5. **Migrate existing local files** (if you have data in `artifacts/api-server/data/objects`): `BLOB_READ_WRITE_TOKEN=... pnpm --filter @workspace/scripts run migrate:blob`. Migrate the database rows with your Postgres tool of choice (`pg_dump`/`pg_restore`).

Vercel-specific behavior to know about:

- **Generation runs inside the request's function invocation** (kept alive after the response via `waitUntil`), capped by `maxDuration` — 300 s in vercel.json. A brief with many sizes can exceed that; the cron route resets briefs stuck in "generating" for 15+ min back to draft so they can be retried. On the Pro plan you can raise `maxDuration` to 800.
- **Scheduled dispatch** has no 30-second poller. Due briefs are dispatched by an opportunistic check on API traffic (at most once per minute per instance) plus a Vercel Cron backstop (`/api/cron/dispatch`, daily in vercel.json — Hobby plan allows only daily crons; tighten the schedule on Pro).
- **Uploads go direct to the Blob store** — when storage is Vercel Blob, `/api/storage/uploads/request-url` tells the client to upload via `@vercel/blob/client` (token handshake at `/api/storage/uploads/client-token`), bypassing Vercel's ~4.5 MB request-body limit. Cap is 500 MB per file. The server-relayed PUT route still exists for filesystem deployments.

### Any Node host (single service)

The API server serves the built frontend:

```sh
pnpm install
VITE_CLERK_PUBLISHABLE_KEY=pk_... pnpm run build
node artifacts/api-server/dist/index.mjs   # with runtime env vars set
```

Requirements:

1. **PostgreSQL** — any provider (RDS, Azure Database, Neon, Supabase, …). Run the drizzle push once against it.
2. **Clerk application** — create at https://dashboard.clerk.com, configure sign-in providers, copy both keys.
3. **OpenAI API key** — from https://platform.openai.com.
4. **Persistent disk** for `OBJECT_STORAGE_DIR` (uploaded brand assets and generated images live there). On ephemeral/autoscale platforms, mount a volume, a persistent path — or set `BLOB_READ_WRITE_TOKEN` to use Vercel Blob storage from any host.

## How generation works

1. **Upload a brief** (Word/PDF) on New Brief — the server extracts the text and pre-fills campaign name, copy direction, and **campaign notes** (objective, audience, key messages, mandatories). AI copy stays ON so artwork is generated too; extracted copy acts as direction, not verbatim.
2. **Generate** — per selected size: AI copy (grounded in the notes), AI background imagery (one per orientation, steered by brand reference images + palette), HTML5 banners for `html_banner`/`animated_social`. Every asset passes a brand-compliance gate (deterministic colour/font parse for HTML, GPT-4o vision for images) with one automatic retry on failure.
3. **Review & edit** — assets are editable in the tool (HTML source editor for banners, freeform canvas editor for templates); edits re-run the compliance check.
4. **Dispatch** — ZIP export ships HTML5 banners as real `.html` creatives plus a static PNG fallback; hosted ad tags (iframe snippet sized to the creative) track impressions/clicks via `/track/*`.

### HTML5 ad tagging

Generated banners are finalized deterministically (`artifacts/api-server/src/lib/htmlBanner.ts`), so regardless of model output they always carry:
- `<meta name="ad.size" content="width=X,height=Y">`
- standard CM360/DV360-compatible `clickTag` wiring (global var + full-size click layer)
- no external requests (webfont imports are stripped; ad servers reject them)

The hosted `/track/serve/:token` route resolves `window.clickTag` to the click-tracking redirect, exactly like an ad server does.

Colour compliance honours every hex listed in the brand's `guidelines` text (the extended palette), not just the five brand colour fields.

## Gotchas

- `tailwindcss({ optimize: false })` in the frontend vite config is required — Clerk CSS layers get reordered in prod builds without it.
- `@layer theme, base, clerk, components, utilities;` must appear before `@import "tailwindcss"` in `index.css`.
- Brief `templateSizes` is stored as a JSON string in Postgres.
- Image uploads must go through object storage (`/api/storage/...`), never inline base64 (1 MB JSON body cap).
- Pin `sharp` to 0.34.x (0.35.0 breaks TS resolution).
