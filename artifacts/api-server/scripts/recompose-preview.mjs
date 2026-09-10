// Bundles and runs recompose-preview.ts (no ts runner in this workspace).
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../.recompose-preview.mjs");
await build({
  entryPoints: [path.resolve(here, "recompose-preview.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  logLevel: "warning",
  external: ["sharp", "@napi-rs/canvas", "pdfjs-dist", "playwright", "pg-native", "@vercel/blob", "mammoth"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
const env = {
  ...process.env,
  FREEFORM_FONT_DIR: process.env.FREEFORM_FONT_DIR ?? path.resolve(here, "../../brand-studio/public/fonts"),
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://localhost:5432/brand_studio",
};
const r = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { stdio: "inherit", env, cwd: path.resolve(here, "..") });
rmSync(out, { force: true });
process.exit(r.status ?? 1);
