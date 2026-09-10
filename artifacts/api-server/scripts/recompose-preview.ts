/**
 * Recomposer preview: render masters at every awkward size to PNGs so the
 * recipes can be judged against shipped creative on a contact sheet.
 *
 *   pnpm --filter @workspace/api-server run recompose:preview <outDir> <masters.json> [WxH,WxH]
 *
 * masters.json: [{ id, name, width, height, config }] — e.g.
 *   psql -d brand_studio -Atc "select json_agg(json_build_object('id',id,'name',name,'width',width,'height',height,'config',config::json)) from templates where id in (474,477)" > masters.json
 * Reads images and package fonts from local object storage (data/objects).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { recomposeToFormat } from "../src/lib/recompose";
import { normalizeFreeformConfig } from "../src/lib/freeform";
import { renderFreeformToPng } from "../src/lib/renderFreeform";
import { registerFontFromBytes } from "../src/lib/freeformFonts";
import { checkLayout } from "../src/lib/layoutCheck";
import { inferSlots } from "../src/lib/slots";

// The runner bundles this file into artifacts/api-server and runs it there.
const ROOT = path.resolve(process.cwd(), "../..");
const OBJECTS = path.join(ROOT, "artifacts/api-server/data/objects");
const PUBLIC = path.join(ROOT, "artifacts/brand-studio/public");
const OUT = path.resolve(process.argv[2] ?? "./out");
mkdirSync(OUT, { recursive: true });

function localPath(src: string): string | null {
  if (src.startsWith("/api/storage/objects/")) return path.join(OBJECTS, src.replace("/api/storage/objects/", ""));
  if (src.startsWith("/")) return path.join(PUBLIC, src);
  return null;
}
async function loadImage(src: string): Promise<Buffer | null> {
  const p = localPath(src);
  if (!p || !existsSync(p)) return null;
  const b = readFileSync(p);
  return b.length > 0 ? b : null;
}
async function loadImageSize(src: string) {
  const b = await loadImage(src);
  if (!b || b.length === 0) return null;
  try {
    const m = await sharp(b).metadata();
    return m.width && m.height ? { w: m.width, h: m.height } : null;
  } catch { return null; }
}

const masters = JSON.parse(readFileSync(path.resolve(process.argv[3] ?? "./masters.json"), "utf8")) as {
  id: number; name: string; width: number; height: number; config: unknown;
}[];
const targets: [number, number][] = [
  [384, 592], [960, 256], [300, 600], [970, 250], [728, 90], [160, 600], [1920, 1080], [1080, 1080], [2160, 3840], [320, 50], [2688, 672], [1440, 480],
];
const only = process.argv[4] ? process.argv[4].split(",").map((s) => s.split("x").map(Number) as [number, number]) : targets;

async function main() {
  // Register the package fonts (DS-Digital etc.) like the server does.
  for (const m of masters) {
    const cfg = m.config as { sourceAssets?: { kind: string; objectPath: string }[] };
    for (const a of cfg.sourceAssets ?? []) {
      if (a.kind !== "font") continue;
      const p = path.join(OBJECTS, a.objectPath.replace(/^\/objects\//, ""));
      if (existsSync(p)) console.log("font", registerFontFromBytes(readFileSync(p)));
    }
  }
  for (const m of masters) {
    const config = normalizeFreeformConfig(m.config);
    const sem = inferSlots(config, m.width, m.height);
    console.log(`\n=== master ${m.id} ${m.name} ${m.width}x${m.height} axis=${sem.axis} cta=${sem.ctaKind}`);
    console.log("   slots:", sem.elements.map((e) => `${e.id}:${e.slot}`).join(" "));
    for (const [w, h] of only) {
      const res = await recomposeToFormat(config, m.width, m.height, w, h, { brand: { logoUrl: "/auckland-council-logo.png" }, loadImageSize });
      if (!res) { console.log(`  ${w}x${h}: null`); continue; }
      const issues = checkLayout(res.config, w, h);
      const png = await renderFreeformToPng(res.config, w, h, { scale: 1, loadImage });
      const file = path.join(OUT, `m${m.id}-${w}x${h}.png`);
      writeFileSync(file, png);
      writeFileSync(file.replace(/\.png$/, ".json"), JSON.stringify(res.config, null, 1));
      console.log(`  ${w}x${h} [${res.formatClass}/${res.budget}] review=${res.needsReview}`);
      for (const n of res.notes) console.log("     - " + n);
      for (const i of issues) console.log("     ! " + i.severity + ": " + i.message);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
