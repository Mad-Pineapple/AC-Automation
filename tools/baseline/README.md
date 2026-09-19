# Layout baseline

Locks in what the layout engines build today so a change that is meant to be
neutral can be PROVEN neutral.

```bash
node tools/baseline/baseline.mjs compare          # rebuild 80 sizes, report anything that moved > 1px
node tools/baseline/baseline.mjs record           # lock in today's results
node tools/baseline/baseline.mjs compare --accept # after an INTENDED change has been looked at
```

Runs against the local server (`--base http://localhost:8081`) through
`POST /api/templates/:id/adapt { dryRun: true }` — the real engines and the
real masters, nothing saved to WIP. Masters are rows in the local database
(`families.json`); re-record after re-importing one.

Rule: run `compare` before shipping any change to an engine, a recipe, a
learned layout or the knowledge base. On 2026-09-20 it stopped two changes
that looked harmless: learning a tall and a wide master together (squares
went to the interpolating engine: band across the photo), and combining
every layout of a campaign (old test masters took over builds).
