/**
 * One door for example artwork, whatever form it arrives in.
 *
 * Campaign examples turn up as whatever the studio had to hand: a packaged
 * InDesign folder, a bare IDML, a print PDF, a layered Photoshop file, or a
 * flat JPEG of the final ad. Each carries a different amount of structure,
 * and the amount of structure decides how well other sizes can be built
 * from it — but every one of them can serve as a master.
 *
 *   packaged InDesign (.zip)  live text, real fonts, designer crops, per-page
 *                             variants — the richest source
 *   IDML (.idml)              same structure minus the linked images
 *   PDF (.pdf)                artwork recreated faithfully; layered PDFs also
 *                             give live text lifted off the page
 *   Photoshop (.psd/.psb)     flattened to its composite, artwork preserved
 *   flat art (.jpg/.png/…)    artwork preserved; reflows by re-cropping
 *
 * The artwork itself is never modified — flat sources import as one faithful
 * image with a detected hero box so adaptation re-crops around the subject
 * rather than redrawing anything.
 */
import JSZip from "jszip";
import sharp from "sharp";
import { ObjectStorageService } from "./objectStorage";
import { parseIdmlToLayouts, type IdmlSpreadLayout } from "./idmlParse";
import { importInDesignPackage } from "./indesignPackage";
import { dissectPdfToTemplate } from "./pdfDissect";
import { detectHeroBox } from "./heroBox";
import { normalizeFreeformConfig, type FreeformConfig } from "./freeform";
import { reconstructGwdBanners } from "./gwdImport";
import { findAcMasterManifest, parseAcMasterPackage } from "./acMasterPackage";

const objectStorageService = new ObjectStorageService();

export type ExampleKind = "package" | "idml" | "pdf" | "psd" | "image";

export interface ExampleLayout {
  name: string;
  width: number;
  height: number;
  config: FreeformConfig;
  /** Variant label when the source carried several (multi-page documents). */
  variant: string | null;
}

export interface ExampleImportResult {
  kind: ExampleKind;
  layouts: ExampleLayout[];
  warnings: string[];
  /** Library assets salvaged from a package (images, fonts). */
  assets: { name: string; objectPath: string; contentType: string; kind: "image" | "file" | "font" }[];
  folder: string | null;
}

export function exampleKindFor(fileName: string): ExampleKind | null {
  const n = fileName.toLowerCase();
  if (n.endsWith(".zip")) return "package";
  if (n.endsWith(".idml")) return "idml";
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".psd") || n.endsWith(".psb")) return "psd";
  if (/\.(jpe?g|png|webp|gif|tiff?)$/.test(n)) return "image";
  return null;
}

/** Faithful single-image master: the artwork drawn as-is at full bleed, with
 * the subject located so adapted sizes crop around it. Nothing is redrawn. */
async function faithfulImageLayout(
  bytes: Buffer,
  contentType: string,
  name: string,
): Promise<ExampleLayout> {
  const meta = await sharp(bytes).metadata();
  const width = Math.max(16, meta.width ?? 0);
  const height = Math.max(16, meta.height ?? 0);
  const storedPath = await objectStorageService.uploadBytes(bytes, contentType);
  const box = await detectHeroBox(bytes);
  const config = normalizeFreeformConfig({
    kind: "freeform",
    elements: [
      {
        id: "kv_artwork",
        type: "image",
        role: "product",
        src: `/api/storage${storedPath}`,
        fit: "cover",
        x: 0,
        y: 0,
        w: width,
        h: height,
        locked: true,
        ...(box
          ? { focusBox: box, focusX: box.x + box.w / 2, focusY: box.y + box.h / 2, focusSource: "attention" as const }
          : {}),
      },
    ],
  });
  return { name, width, height, config, variant: null };
}

function layoutsFromIdml(spreads: IdmlSpreadLayout[], baseName: string): ExampleLayout[] {
  return spreads.map((s) => ({
    name: spreads.length > 1 && s.label ? `${baseName} — ${s.label}` : baseName,
    width: s.width,
    height: s.height,
    config: normalizeFreeformConfig({ kind: "freeform", elements: s.elements }),
    variant: spreads.length > 1 ? s.label : null,
  }));
}

export async function importExample(
  objectPath: string,
  fileName: string,
  brandLogoUrl: string | null,
  paletteHexes: string[] = [],
): Promise<ExampleImportResult> {
  const kind = exampleKindFor(fileName);
  if (!kind) throw new Error("Unsupported file type");
  const baseName = fileName.replace(/\.[^.]+$/, "").trim().slice(0, 80) || "Example";

  if (kind === "package") {
    // Packages made by the InDesign bridge carry an explicit semantic
    // manifest. It is the source of truth and must bypass IDML inference.
    const bridgeFile = await objectStorageService.getObjectEntityFile(objectPath);
    const bridgeBytes = Buffer.from(await (await objectStorageService.downloadObject(bridgeFile)).arrayBuffer());
    const bridgeZip = await JSZip.loadAsync(bridgeBytes);
    if (findAcMasterManifest(bridgeZip)) {
      const bridge = await parseAcMasterPackage(bridgeZip);
      return { kind, layouts: bridge.layouts, warnings: bridge.warnings, assets: bridge.imported, folder: `InDesign Bridge — ${baseName}` };
    }
    const res = await importInDesignPackage(objectPath, brandLogoUrl);
    if (res.idmlLayouts.length > 0) {
      return {
        kind,
        layouts: layoutsFromIdml(res.idmlLayouts, baseName),
        warnings: [...new Set([...res.idmlLayouts.flatMap((l) => l.warnings), ...res.skipped.map((k) => `Link "${k.name}": ${k.reason}.`)])],
        assets: res.imported,
        folder: `Package — ${baseName}`,
      };
    }
    // No IDML: fall back to the package's document PDF, recreated faithfully.
    if (res.documentPdfPath) {
      const dissected = await dissectPdfToTemplate(res.documentPdfPath, 1, paletteHexes, "keyVisual");
      return {
        kind,
        layouts: [{ name: baseName, width: dissected.width, height: dissected.height, config: dissected.config, variant: null }],
        warnings: [
          "No IDML in the package. The .indd file cannot be read outside InDesign, so your layers, live text and positions were NOT imported — the PDF was placed as one flat picture, and only same-shape sizes can be made from it. Fix: in InDesign choose File > Package and tick \"Include IDML\" (or File > Export > InDesign Markup (IDML) and add that file to the folder), zip the folder and import it again.",
          ...dissected.warnings,
        ],
        assets: res.imported,
        folder: `Package — ${baseName}`,
      };
    }
    // Neither IDML nor a document PDF.
    const zipFile = await objectStorageService.getObjectEntityFile(objectPath);
    const zipBytes = Buffer.from(await (await objectStorageService.downloadObject(zipFile)).arrayBuffer());
    const zip = await JSZip.loadAsync(zipBytes);

    // Google Web Designer working files: each banner folder is ONE complete
    // artwork whose HTML records exact layer geometry — reconstruct each as a
    // single faithful piece rather than importing its layers separately.
    const gwd = await reconstructGwdBanners(zip, baseName);
    if (gwd.length > 0) {
      return {
        kind,
        layouts: gwd,
        warnings: [
          `Google Web Designer package: ${gwd.length} complete banner${gwd.length === 1 ? "" : "s"} reconstructed from the working files, layer positions preserved.`,
          "Animation is not carried over, and animated lettering (countdown digits, cycling letters) is left out — headlines are set live from the campaign brief instead of being baked into artwork.",
        ],
        assets: res.imported,
        folder: `Package — ${baseName}`,
      };
    }

    // Otherwise treat the zip as a folder of flat artwork. Full-size images
    // become WIP artwork; small pieces (glyphs, icons) stay library assets.
    const candidates: { name: string; bytes: Buffer; contentType: string; area: number }[] = [];
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir || /__MACOSX|\.DS_Store/i.test(path)) continue;
      const ext = /\.(jpe?g|png|webp)$/i.exec(path)?.[1]?.toLowerCase();
      if (!ext) continue;
      const bytes = Buffer.from(await entry.async("uint8array"));
      const meta = await sharp(bytes).metadata().catch(() => null);
      if (!meta?.width || !meta.height) continue;
      // Artwork threshold: filters out letter glyphs, icons and UI slices.
      if (Math.min(meta.width, meta.height) < 200 || meta.width * meta.height < 150_000) continue;
      // Skip mostly-transparent layers (text overlays, cut-outs) — artwork
      // is opaque. Alpha mean below ~40% coverage means an overlay, not art.
      if (meta.hasAlpha) {
        const stats = await sharp(bytes).stats().catch(() => null);
        const alpha = stats?.channels?.[stats.channels.length - 1];
        if (alpha && alpha.mean < 100) continue;
      }
      const base = path.split("/").pop()!.replace(/\.[^.]+$/, "");
      candidates.push({
        name: base,
        bytes,
        contentType: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg",
        area: meta.width * meta.height,
      });
    }
    candidates.sort((a, b) => b.area - a.area);
    // The same artwork often repeats across subfolders (per-phase packages) —
    // one card per distinct name is enough.
    const seenNames = new Set<string>();
    const picks = candidates
      .filter((c) => (seenNames.has(c.name.toLowerCase()) ? false : (seenNames.add(c.name.toLowerCase()), true)))
      .slice(0, 12);
    if (picks.length === 0) {
      throw new Error("That zip has no IDML, no document PDF, and no full-size artwork images.");
    }
    const flatLayouts: ExampleLayout[] = [];
    for (const c of picks) {
      flatLayouts.push(await faithfulImageLayout(c.bytes, c.contentType, `${baseName} — ${c.name}`));
    }
    return {
      kind,
      layouts: flatLayouts,
      warnings: [
        `No InDesign document in the zip — its ${picks.length} full-size artwork image${picks.length === 1 ? "" : "s"} were imported as work-in-progress instead (small support files went to the library).`,
        ...(candidates.length > picks.length
          ? [`${candidates.length - picks.length} further large images were skipped (12 max per import).`]
          : []),
      ],
      assets: res.imported,
      folder: `Package — ${baseName}`,
    };
  }

  const file = await objectStorageService.getObjectEntityFile(objectPath);
  const bytes = Buffer.from(await (await objectStorageService.downloadObject(file)).arrayBuffer());

  if (kind === "idml") {
    const spreads = await parseIdmlToLayouts(await JSZip.loadAsync(bytes), new Map(), brandLogoUrl);
    // A bare IDML has no document PDF, so vector-art regions have no pixels
    // to be reproduced from — drop them rather than leave gaps in the layout.
    let droppedRegions = 0;
    for (const s of spreads) {
      const before = s.elements.length;
      s.elements = s.elements.filter((el) => el.type !== "rasterRegion");
      droppedRegions += before - s.elements.length;
      s.warnings = s.warnings.filter((w) => !w.includes("reproduced from the original document's pixels"));
    }
    return {
      kind,
      layouts: layoutsFromIdml(spreads, baseName),
      warnings: [
        "Imported from a bare IDML: placed photography is missing because the linked files aren't included. Upload the packaged folder (File → Package) to bring the images in.",
        ...(droppedRegions > 0
          ? ["Pattern bands and vector lockups were left out — they need the packaged folder or a PDF of the document."]
          : []),
        ...new Set(spreads.flatMap((s) => s.warnings)),
      ],
      assets: [],
      folder: null,
    };
  }

  if (kind === "pdf") {
    const dissected = await dissectPdfToTemplate(objectPath, 1, paletteHexes, "keyVisual");
    return {
      kind,
      layouts: [{ name: baseName, width: dissected.width, height: dissected.height, config: dissected.config, variant: null }],
      warnings: dissected.warnings,
      assets: [],
      folder: null,
    };
  }

  if (kind === "psd") {
    let png: Buffer;
    try {
      const { readPsd, initializeCanvas } = await import("ag-psd");
      const { createCanvas } = await import("@napi-rs/canvas");
      initializeCanvas(createCanvas as any);
      const psd = readPsd(bytes, { skipLayerImageData: true, skipThumbnail: true, useImageData: false });
      const canvas = psd.canvas as unknown as { toBuffer(mime: string): Buffer } | undefined;
      if (!canvas) throw new Error("no composite");
      png = canvas.toBuffer("image/png");
    } catch {
      throw new Error(
        "That Photoshop file has no flattened composite. Re-save it with 'Maximize Compatibility' on, or export a PNG.",
      );
    }
    const layout = await faithfulImageLayout(png, "image/png", baseName);
    return {
      kind,
      layouts: [layout],
      warnings: [
        "Photoshop artwork imported flattened — its layers become one faithful image, so other sizes are produced by re-cropping rather than re-setting type.",
      ],
      assets: [],
      folder: null,
    };
  }

  // Flat art. TIFFs (print originals) convert to PNG so browsers can show them.
  const isTiff = /\.tiff?$/i.test(fileName);
  const finalBytes = isTiff ? await sharp(bytes).png().toBuffer() : bytes;
  const contentType = isTiff
    ? "image/png"
    : /\.png$/i.test(fileName)
      ? "image/png"
      : /\.webp$/i.test(fileName)
        ? "image/webp"
        : /\.gif$/i.test(fileName)
          ? "image/gif"
          : "image/jpeg";
  const layout = await faithfulImageLayout(finalBytes, contentType, baseName);
  return {
    kind: "image",
    layouts: [layout],
    warnings: [
      "Flat artwork imported as one faithful image — other sizes are produced by re-cropping around the subject; the artwork itself is never altered.",
    ],
    assets: [],
    folder: null,
  };
}
