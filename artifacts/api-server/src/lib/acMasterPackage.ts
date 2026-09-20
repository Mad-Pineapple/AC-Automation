/** Import the lossless interchange package produced by AC-InDesign-Bridge.idjs. */
import type JSZip from "jszip";
import { ObjectStorageService } from "./objectStorage";
import { normalizeFreeformConfig, type FreeformConfig, type SlotRole } from "./freeform";
import type { ImportedPackageAsset } from "./indesignPackage";
import { constraintsFromAnchors } from "./authoritativeAdapt";
import { sanitizeConstraints } from "./liquid";

export const AC_MASTER_SCHEMA = "nz.govt.auckland.artwork-master/v1";

type ManifestElement = {
  id?: unknown; layerName?: unknown; role?: unknown; slot?: unknown; block?: unknown;
  anchorX?: unknown; anchorY?: unknown; scaleMode?: unknown;
  kind?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown;
  assetPath?: unknown; fit?: unknown; locked?: unknown; opacity?: unknown;
  text?: unknown; fontSize?: unknown; fontWeight?: unknown; fontFamily?: unknown;
  color?: unknown; align?: unknown; lineHeight?: unknown; letterSpacing?: unknown;
};
type ManifestPage = { name?: unknown; width?: unknown; height?: unknown; masterFamily?: unknown; elements?: unknown };
type Manifest = { schema?: unknown; campaign?: unknown; pages?: unknown };

export interface AcMasterLayout {
  name: string;
  width: number;
  height: number;
  config: FreeformConfig;
  variant: string | null;
}

const safeName = (v: unknown, fallback: string) => typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : fallback;
const finite = (v: unknown, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const family = (v: unknown): FreeformConfig["masterFamily"] =>
  v === "portrait" || v === "landscape" || v === "slim-portrait" || v === "slim-landscape" ? v : undefined;
const slotForRole = (role: string): SlotRole => ({
  background: "photo", hero: "photo", headline: "headline", subheadline: "subheadline",
  body: "message", cta: "cta", logo: "logo", decoration: "band", legal: "other",
  // Key-visual roles: the anther is the shaped picture; title, badge,
  // strapline and credit are found by their layoutBlock.
  anther: "cutout", scrim: "scrim", title: "other", badge: "other", strapline: "other", credit: "other",
} as Record<string, SlotRole>)[role] ?? "other";

export function findAcMasterManifest(zip: JSZip): JSZip.JSZipObject | null {
  return Object.values(zip.files).find((entry) => !entry.dir && /(^|\/)ac-master\.json$/i.test(entry.name)) ?? null;
}

export async function parseAcMasterPackage(
  zip: JSZip,
  storage = new ObjectStorageService(),
): Promise<{ layouts: AcMasterLayout[]; imported: ImportedPackageAsset[]; warnings: string[] }> {
  const entry = findAcMasterManifest(zip);
  if (!entry) throw new Error("AC master manifest not found");
  let manifest: Manifest;
  try { manifest = JSON.parse(await entry.async("string")) as Manifest; }
  catch { throw new Error("The InDesign bridge manifest is not valid JSON."); }
  if (manifest.schema !== AC_MASTER_SCHEMA) throw new Error("Unsupported InDesign bridge package version.");
  if (!Array.isArray(manifest.pages) || manifest.pages.length < 1 || manifest.pages.length > 16) throw new Error("The InDesign bridge package has no valid master pages.");

  const imported: ImportedPackageAsset[] = [];
  const assetPaths = new Set<string>();
  for (const page of manifest.pages as ManifestPage[]) {
    if (!Array.isArray(page.elements)) continue;
    for (const raw of page.elements as ManifestElement[]) if (typeof raw.assetPath === "string" && raw.assetPath) assetPaths.add(raw.assetPath.replace(/^\/+/, ""));
  }
  const stored = new Map<string, string>();
  for (const assetPath of assetPaths) {
    const asset = zip.file(assetPath);
    if (!asset) throw new Error(`The InDesign package is missing ${assetPath}.`);
    const bytes = Buffer.from(await asset.async("arraybuffer"));
    if (bytes.length > 30 * 1024 * 1024) throw new Error(`${assetPath} is over the 30MB layer limit.`);
    const ext = assetPath.split(".").pop()?.toLowerCase();
    const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
    const objectPath = await storage.uploadBytes(bytes, contentType);
    stored.set(assetPath, `/api/storage${objectPath}`);
    imported.push({ name: assetPath.split("/").pop() ?? assetPath, objectPath, contentType, kind: "image" });
  }

  const campaign = safeName(manifest.campaign, "InDesign masters");
  const warnings: string[] = [];
  const layouts: AcMasterLayout[] = [];
  for (let pageIndex = 0; pageIndex < manifest.pages.length; pageIndex++) {
    const page = manifest.pages[pageIndex] as ManifestPage;
    const width = finite(page.width), height = finite(page.height);
    if (!(width >= 16 && height >= 16 && width <= 12000 && height <= 12000) || !Array.isArray(page.elements)) {
      warnings.push(`Master ${pageIndex + 1} was skipped because its page geometry was invalid.`);
      continue;
    }
    const elements: Record<string, unknown>[] = [];
    for (let i = 0; i < Math.min(page.elements.length, 200); i++) {
      const raw = page.elements[i] as ManifestElement;
      const role = typeof raw.role === "string" ? raw.role.toLowerCase() : "decoration";
      const common = {
        id: safeName(raw.id, `bridge_${pageIndex}_${i}`).replace(/[^\w:.-]/g, "_").slice(0, 64),
        x: finite(raw.x), y: finite(raw.y), w: Math.max(1, finite(raw.w, 1)), h: Math.max(1, finite(raw.h, 1)),
        layerName: safeName(raw.layerName, `art:${role}`),
        slot: typeof raw.slot === "string" ? raw.slot : slotForRole(role),
        layoutBlock: safeName(raw.block, role).replace(/[^\w:.-]/g, "_").slice(0, 80),
        anchorX: raw.anchorX, anchorY: raw.anchorY, scaleMode: raw.scaleMode,
        // One vocabulary: the bridge's pins (v2 manifests carry them; v1
        // anchors are mapped) become the same constraints the editor edits.
        ...((() => { const c = sanitizeConstraints((raw as { constraints?: unknown }).constraints) ?? constraintsFromAnchors({ anchorX: typeof raw.anchorX === "string" ? raw.anchorX : undefined, anchorY: typeof raw.anchorY === "string" ? raw.anchorY : undefined, scaleMode: typeof raw.scaleMode === "string" ? raw.scaleMode : undefined }); return c ? { constraints: c } : {}; })()),
        ...(raw.locked === true ? { locked: true } : {}),
      };
      if (raw.kind === "text") {
        // An empty frame left inside a group is not copy.
        if (!String(raw.text ?? "").trim()) continue;
        elements.push({
          ...common, type: "text",
          role: role === "headline" ? "headline" : role === "subheadline" ? "subhead" : role === "cta" ? "cta" : role === "body" || role === "legal" ? "body" : "other",
          text: String(raw.text ?? "").slice(0, 2000),
          fontSize: Math.max(1, finite(raw.fontSize, 16)),
          fontWeight: finite(raw.fontWeight, 400) >= 600 || (typeof raw.fontFamily === "string" && /\t.*(bold|black|heavy|semibold)/i.test(raw.fontFamily)) ? 700 : 400,
          // InDesign names a face "Family<TAB>Style" ("National 2 Condensed\tBold").
          fontFamily: typeof raw.fontFamily === "string" ? raw.fontFamily.split("\t")[0].trim() : undefined,
          color: typeof raw.color === "string" ? raw.color : "#11263d",
          align: raw.align === "center" || raw.align === "right" ? raw.align : "left",
          lineHeight: Math.max(0.5, finite(raw.lineHeight, 1.2)),
          letterSpacing: finite(raw.letterSpacing, 0),
          ...(raw.opacity !== undefined ? { opacity: Math.max(0, Math.min(1, finite(raw.opacity, 1))) } : {}),
        });
      } else {
        const assetPath = typeof raw.assetPath === "string" ? raw.assetPath.replace(/^\/+/, "") : "";
        const src = stored.get(assetPath);
        if (!src) continue;
        // A wide logo is a LOCK-UP (wordmark + pōhutukawa), not the square tile:
        // the tile's minimum size does not apply to it.
        if (role === "logo" && common.w / Math.max(1, common.h) > 1.5) (common as { slot: string }).slot = "lockup";
        elements.push({
          ...common, type: "image",
          role: role === "logo" ? "logo" : role === "hero" || role === "background" || role === "anther" ? "product" : "decoration",
          src,
          fit: raw.fit === "cover" ? "cover" : "contain",
          ...(raw.opacity !== undefined ? { opacity: Math.max(0, Math.min(1, finite(raw.opacity, 1))) } : {}),
        });
      }
    }
    if (!elements.length) { warnings.push(`Master ${pageIndex + 1} contained no usable tagged artwork.`); continue; }
    const name = safeName(page.name, `${campaign} ${pageIndex + 1}`);
    layouts.push({
      name,
      width: Math.round(width), height: Math.round(height),
      variant: family(page.masterFamily) ?? null,
      config: normalizeFreeformConfig({
        kind: "freeform", elements,
        sourceMode: "indesign-bridge", authoritativeGeometry: true,
        masterFamily: family(page.masterFamily),
        adaptMethod: "indesign-master",
        adaptNotes: ["Exact layer geometry and semantic blocks supplied by the Auckland Artwork InDesign bridge."],
      }),
    });
  }
  if (!layouts.length) throw new Error("The InDesign bridge package had no usable master layouts.");
  const fonts = [...new Set(layouts.flatMap((l) => l.config.elements.filter((e): e is Extract<typeof e, { type: "text" }> => e.type === "text").map((e) => e.fontFamily).filter((f): f is string => !!f)))];
  if (fonts.length) warnings.push(`Fonts used: ${fonts.join(", ")}. Copy is measured with these faces only when they are in the Library; add them there if they are not.`);
  warnings.unshift(`Authoritative InDesign package: ${layouts.length} master${layouts.length === 1 ? "" : "s"} imported. Generic recipe guessing is disabled for this family.`);
  return { layouts, imported, warnings };
}
