---
name: Running one-off TS/MTS scripts
description: How to execute a throwaway integration/test script in this repo when tsx wrappers fail.
---

To run a one-off `.ts`/`.mts` script (e.g. a quick integration test that imports server libs), invoke
the tsx CLI **directly**:

```
node node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs path/to/script.mts
```

**Why:** `pnpm exec tsx <file>` and `node --import tsx <file>` both FAIL in this environment (resolution
/ loader issues). The bundled tsx `cli.mjs` works and resolves workspace packages + project references.

**How to apply:** use this for ad-hoc verification that needs real services (object storage, db). Glob
for the exact cli path (the `tsx@*` version segment changes). Delete the script when done.

## Long-running live tests must run in the foreground

A live test that calls a slow external service (e.g. an OpenAI image edit takes ~50-60s) must be run
**synchronously in the foreground of a single bash call**, with the tool timeout set high enough
(≤120s, the max).

**Why:** detached background launches (`nohup … &`, `setsid`, writing a PID and polling later) get
reaped when the launching bash tool call returns — the process dies before the slow call finishes, so
you never see the result. There is no persistent background shell across tool calls.

**How to apply:** size the work to fit one ≤120s bash call and block on it. If it genuinely needs more
than 120s, split it into resumable steps that each persist their output to a file, rather than
backgrounding one long process.
