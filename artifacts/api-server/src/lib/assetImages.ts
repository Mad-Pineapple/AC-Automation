import { db, brandAssetsTable, templatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import sharp from "sharp";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";
import { pickLibraryImageAsset, type ProductImageSize } from "./openai";

const objectStorageService = new ObjectStorageService();

export type TemplateRow = typeof templatesTable.$inferSelect;

/** Built-in template dimensions (mirrors the client TemplateRenderer SIZE_CONFIGS)
 *  so the server can pick a generated-image orientation per requested size. */
export const BUILTIN_DIMS: Record<string, { width: number; height: number }> = {
  social_square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  banner: { width: 728, height: 90 },
  print_a4: { width: 2480, height: 3508 },
  animated_social: { width: 1080, height: 1080 },
  html_banner: { width: 970, height: 250 },
};

/** Map canvas dimensions to the closest gpt-image-1 size so the generated image
 *  fills (covers) the canvas instead of being cropped from a square. */
export function imageSizeForDims(width: number, height: number): ProductImageSize {
  if (width > height * 1.1) return "1536x1024";
  if (height > width * 1.1) return "1024x1536";
  return "1024x1024";
}

/** Resolve a template size key (built-in name or `tpl_<id>`) to its pixel dims. */
export function dimsForSize(
  size: string,
  tplById: Map<string, TemplateRow>,
): { width: number; height: number } {
  if (BUILTIN_DIMS[size]) return BUILTIN_DIMS[size];
  const t = tplById.get(size);
  if (t) return { width: t.width, height: t.height };
  return { width: 1080, height: 1080 };
}

/** Load every template keyed by its `tpl_<id>` size token. */
export async function loadTemplateMap(): Promise<Map<string, TemplateRow>> {
  const all = await db.select().from(templatesTable);
  return new Map(all.map((t) => [`tpl_${t.id}`, t] as const));
}

/** Strip any `/api/storage` prefix or absolute origin so a stored image URL can
 *  be resolved by ObjectStorageService.getObjectEntityFile (expects `/objects/...`). */
export function toObjectEntityPath(url: string): string | null {
  const idx = url.indexOf("/objects/");
  return idx === -1 ? null : url.slice(idx);
}

/** Reject a promise if it does not settle within `ms` so one slow object-storage
 *  read can never stall the whole image generation. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/** Download a stored image and downscale it to a small JPEG. Best-effort:
 *  returns null on any failure (incl. timeout) so a single bad/slow reference
 *  never aborts or stalls the whole generation. Downscaling is essential —
 *  source brand/template assets can be 50MB+ print-resolution files which exceed
 *  the image API's input limits and would otherwise make every edit call slow or
 *  fail. A 1024px JPEG conveys the visual style at a fraction of the payload. */
async function downloadReferenceImage(
  url: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const objectPath = toObjectEntityPath(url);
  if (!objectPath) return null;
  try {
    return await withTimeout(
      (async () => {
        const file = await objectStorageService.getObjectEntityFile(objectPath);
        const [raw] = await file.download();
        const buffer = await sharp(raw)
          .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        return { buffer, mimeType: "image/jpeg" };
      })(),
      25_000,
      "reference image",
    );
  } catch (err) {
    logger.warn({ err, url }, "Reference image download/resize failed or timed out");
    return null;
  }
}

/** Try to satisfy a brief's imagery from the brand library before generating:
 *  an art-director model matches the brief's subject against asset names and
 *  returns a real approved image (or null → caller falls back to AI). Logos,
 *  patterns and template folders are never offered as hero imagery. */
export async function pickLibraryImage(
  brandId: number,
  briefText: string,
): Promise<{ objectPath: string; name: string; folder: string | null } | null> {
  if (!briefText.trim()) return null;
  const assets = await db
    .select()
    .from(brandAssetsTable)
    .where(and(eq(brandAssetsTable.brandId, brandId), eq(brandAssetsTable.kind, "image")))
    .orderBy(brandAssetsTable.id);
  const candidates = assets
    .filter((a) => !/template|pattern|logo/i.test(a.folder ?? ""))
    .map((a) => ({ id: a.id, name: a.name, folder: a.folder }));
  if (candidates.length === 0) return null;
  try {
    const { assetId, reason } = await pickLibraryImageAsset({ briefText, candidates });
    if (assetId == null) {
      logger.info({ brandId, reason }, "No library image matched; will generate");
      return null;
    }
    const match = assets.find((a) => a.id === assetId);
    if (!match) return null;
    logger.info({ brandId, asset: match.name, reason }, "Using library image for brief");
    return { objectPath: match.objectPath, name: match.name, folder: match.folder };
  } catch (err) {
    logger.warn({ err, brandId }, "Library image pick failed; falling back to generation");
    return null;
  }
}

/** Folder-name patterns, in priority order, for picking style references from
 *  the brand library. Illustrations and kotahitanga patterns define the flat
 *  vector look generated artwork must follow; icons and photography round out
 *  the style. Folders that don't match any pattern (and unfiled uploads) are
 *  still used as a fallback. */
const REFERENCE_FOLDER_PRIORITY = [/illustration/i, /pattern/i, /icon/i, /photo/i];

/** Gather up to 3 reference images so generated art follows the brand's own
 *  images and the template's image. Preference order: the template's product
 *  image (the real final creative), then a style sample drawn across the
 *  brand's library folders (illustrations first), then any other images. */
export async function collectBrandReferences(
  brandId: number,
  sizes: string[],
  tplById: Map<string, TemplateRow>,
): Promise<{ buffer: Buffer; mimeType: string }[]> {
  const candidatePaths: string[] = [];

  for (const size of sizes) {
    const t = tplById.get(size);
    if (!t) continue;
    try {
      const cfg = JSON.parse(t.config || "{}");
      if (cfg?.kind === "freeform" && Array.isArray(cfg.elements)) {
        for (const el of cfg.elements) {
          if (el?.type === "image" && el?.role === "product" && typeof el.src === "string") {
            candidatePaths.push(el.src);
          }
        }
      }
    } catch {
      // ignore malformed template config
    }
  }

  const assets = await db
    .select()
    .from(brandAssetsTable)
    .where(and(eq(brandAssetsTable.brandId, brandId), eq(brandAssetsTable.kind, "image")))
    .orderBy(brandAssetsTable.id);

  // One random pick per priority folder (illustrations, patterns, icons,
  // photos), so every generation is steered by the brand's own visual system
  // with a little variety between runs; anything else fills remaining slots.
  const remaining = [...assets];
  for (const pattern of REFERENCE_FOLDER_PRIORITY) {
    const pool = remaining.filter((a) => pattern.test(a.folder ?? ""));
    if (pool.length === 0) continue;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    candidatePaths.push(pick.objectPath);
    remaining.splice(remaining.indexOf(pick), 1);
  }
  for (const a of remaining.slice(0, 6)) candidatePaths.push(a.objectPath);

  const seen = new Set<string>();
  const refs: { buffer: Buffer; mimeType: string }[] = [];
  for (const path of candidatePaths) {
    if (refs.length >= 3) break;
    const key = toObjectEntityPath(path) ?? path;
    if (seen.has(key)) continue;
    seen.add(key);
    const ref = await downloadReferenceImage(path);
    if (ref) refs.push(ref);
  }
  return refs;
}
