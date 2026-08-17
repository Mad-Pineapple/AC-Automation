// Committed placeholder: Vercel validates the `functions` pattern in
// vercel.json at clone time, before buildCommand runs, so this file must
// exist in git. `pnpm run build:vercel` overwrites it with the real esbuild
// bundle of artifacts/api-server/src/vercel.ts during the deploy.
export default function handler(_req, res) {
  res.statusCode = 503;
  res.setHeader("content-type", "text/plain");
  res.end("API bundle was not built — run `pnpm run build:vercel`.");
}
