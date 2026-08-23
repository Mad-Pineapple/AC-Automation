/**
 * One-off check of the Adobe Firefly remove-background integration.
 * Usage: corepack pnpm --filter @workspace/scripts exec tsx src/adobe-cutout-test.ts <public-image-url> <out.png>
 * Reads ADOBE_CLIENT_ID / ADOBE_CLIENT_SECRET from the repo's .env.local.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, "../../.env.local");
const env = await fsp.readFile(envPath, "utf8").catch(() => "");
for (const line of env.split("\n")) {
  const m = /^([A-Z_]+)=("?)(.*)\2$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[3];
}

const { isAdobeConfigured, removeBackground } = await import("../../artifacts/api-server/src/lib/adobeFirefly.ts");
if (!isAdobeConfigured()) {
  console.error("ADOBE_CLIENT_ID / ADOBE_CLIENT_SECRET not set in .env.local");
  process.exit(1);
}
const [url, out] = process.argv.slice(2);
console.log("requesting cut-out for", url);
const t0 = Date.now();
const { png } = await removeBackground(url);
await fsp.writeFile(out, png);
console.log(`ok: ${png.length} bytes in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}`);
