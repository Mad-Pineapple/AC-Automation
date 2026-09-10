/**
 * Campaign font registration for server-side rendering.
 *
 * InDesign packages ship the fonts the designer actually used (Document
 * fonts/). Package import stores them as brand assets with kind "font" and
 * also lists them on each imported template's sourceAssets manifest. Before
 * rendering, every stored font is registered with the canvas under its real
 * family name so imported layouts draw with the designer's type (e.g. the
 * Get Ready digital-clock face "DS-Digital") instead of a substitute.
 *
 * The same list feeds `/api/fonts.css`, so the browser editor and previews
 * load the identical files as @font-face and match the export.
 */
import { db, brandAssetsTable, templatesTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage";
import { registerFontFromBytes } from "./freeformFonts";

const storage = new ObjectStorageService();

export interface CampaignFont {
  /** Family name as the layouts reference it (e.g. "DS-Digital"). */
  family: string;
  /** Original file name inside the package. */
  file: string;
  objectPath: string;
  contentType: string | null;
  weight: 400 | 700;
  style: "normal" | "italic";
}

/** "DS-Digital (DS-DIGIB (1).TTF)" → family + file; weight/style from the file name. */
export function fontFromAssetName(name: string, objectPath: string, contentType: string | null): CampaignFont | null {
  const m = /^(.*?)\s*\((.+)\)\s*$/.exec(name.trim());
  const family = (m ? m[1] : name.replace(/\.(ttf|otf|woff2?)$/i, "")).trim();
  const file = m ? m[2] : name;
  if (!family) return null;
  return {
    family,
    file,
    objectPath,
    contentType,
    weight: /bold|black|heavy|semibold|extrabold/i.test(file) ? 700 : 400,
    style: /italic|oblique/i.test(file) ? "italic" : "normal",
  };
}

/** Every campaign font known to the app: brand-library font assets plus the
 *  fonts listed on imported templates' package manifests (templates imported
 *  before fonts were added to the library still carry them). De-duplicated
 *  by object path. */
export async function listCampaignFonts(): Promise<CampaignFont[]> {
  const out = new Map<string, CampaignFont>();
  try {
    const rows = await db
      .select({ name: brandAssetsTable.name, objectPath: brandAssetsTable.objectPath, contentType: brandAssetsTable.contentType })
      .from(brandAssetsTable)
      .where(eq(brandAssetsTable.kind, "font"));
    for (const row of rows) {
      const f = fontFromAssetName(row.name, row.objectPath, row.contentType ?? null);
      if (f && !out.has(f.objectPath)) out.set(f.objectPath, f);
    }
  } catch {
    // db unavailable: fall through to whatever we have
  }
  try {
    const rows = await db
      .select({ config: templatesTable.config })
      .from(templatesTable)
      .where(like(templatesTable.config, '%"kind":"font"%'));
    for (const row of rows) {
      let cfg: { sourceAssets?: { name?: string; objectPath?: string; contentType?: string; kind?: string }[] };
      try {
        cfg = JSON.parse(row.config);
      } catch {
        continue;
      }
      for (const a of cfg.sourceAssets ?? []) {
        if (a.kind !== "font" || !a.name || !a.objectPath) continue;
        const f = fontFromAssetName(a.name, a.objectPath, a.contentType ?? null);
        if (f && !out.has(f.objectPath)) out.set(f.objectPath, f);
      }
    }
  } catch {
    // ignore
  }
  // One face per family/weight/style: repeated package imports store the
  // same file again under a new object id.
  const byFace = new Map<string, CampaignFont>();
  for (const f of out.values()) {
    const key = `${f.family}|${f.weight}|${f.style}`;
    if (!byFace.has(key)) byFace.set(key, f);
  }
  return [...byFace.values()];
}

// Object paths already handled this process (including failures, so a corrupt
// font isn't re-downloaded on every render).
const seen = new Set<string>();

export async function ensureBrandFontsRegistered(): Promise<void> {
  const fonts = await listCampaignFonts();
  for (const font of fonts) {
    if (seen.has(font.objectPath)) continue;
    seen.add(font.objectPath);
    try {
      const file = await storage.getObjectEntityFile(font.objectPath);
      const bytes = Buffer.from(await (await storage.downloadObject(file)).arrayBuffer());
      registerFontFromBytes(bytes);
    } catch {
      // best-effort: a missing font falls back to the brand family
    }
  }
}
