---
name: Brand Creative Studio Architecture
description: Key decisions for the Brand Creative Studio platform (api-server + brand-studio)
---

## Architecture

- **API server**: `artifacts/api-server` at port 8080 → external port 80. Routes registered at `/api/*`.
- **Brand Studio frontend**: `artifacts/brand-studio` at port 25611 → external port 3000. Vite proxy forwards `/api` to `localhost:8080`.
- **OpenAI**: Use `@workspace/integrations-openai-ai-server` - do NOT import `openai` directly in api-server (not in its deps).
- **DB schema**: `lib/db/src/schema/` - brands, briefs (templateSizes as JSON string), assets tables.

## Why
- `openai` package lives only in `@workspace/integrations-openai-ai-server`, not in api-server deps.
- Vite proxy (in `vite.config.ts`) is required for the frontend to reach the API in dev.
- Brief `templateSizes` stored as `JSON.stringify`/`JSON.parse` string in postgres.

## How to apply
- Any new API routes: add to `artifacts/api-server/src/routes/`, register in `routes/index.ts`, then restart api-server workflow.
- OpenAI calls: import from `@workspace/integrations-openai-ai-server`, use `gpt-4o-mini` for chat, `gpt-image-1` for images.
