/**
 * InDesign package ingestion (Stage 1: use all the assets).
 *
 * A packaged InDesign folder (File → Package, zipped) carries the original
 * placed assets in `Links/`, usually a print/interactive PDF of the document,
 * an IDML, and licensed fonts. This walks the zip and salvages everything
 * usable into object storage for the brand library:
 *
 *  - png/jpg/gif/webp/svg links: stored as-is.
 *  - tiff links: converted to PNG via sharp (originals often CMYK print TIFFs).
 *  - ai / pdf links: first page rendered to PNG (AI files are PDF-compatible).
 *  - psd/eps/indd and anything unconvertible: stored raw as a downloadable
 *    file so nothing in the package is lost.
 *  - The document PDF (largest PDF outside Links/) is stored and returned so
 *    the import flow can feed it straight into Recreate-artwork.
 *  - Document fonts are skipped (licensed; National 2 is already self-hosted).
 */
import JSZip from "jszip";
import sharp from "sharp";
import { ObjectStorageService } from "./objectStorage";
import { parseIdmlToLayouts, type IdmlParseResult, type IdmlSpreadLayout } from "./idmlParse";
import { stripPdfText } from "./pdfStripText";

/** Flatten a PSD to PNG via ag-psd's embedded composite (designers save with
 * Maximize Compatibility, so the flattened image is in the file). Renders
 * through @napi-rs/canvas; throws if the PSD has no composite. */
async function psdToPng(bytes: Buffer): Promise<Buffer> {
  const { readPsd, initializeCanvas } = await import("ag-psd");
  const { createCanvas } = await import("@napi-rs/canvas");
  initializeCanvas(createCanvas as any);
  const psd = readPsd(bytes, { skipLayerImageData: true, skipThumbnail: true, useImageData: false });
  const canvas = psd.canvas as unknown as { toBuffer(mime: string): Buffer } | undefined;
  if (!canvas) throw new Error("PSD has no flattened composite");
  return canvas.toBuffer("image/png");
}

const objectStorageService = new ObjectStorageService();

const MAX_ENTRIES = 200;
const MAX_RAW_FILE_BYTES = 50 * 1024 * 1024;
/** Largest Links/ file we will inflate and convert (the biggest thing a
 *  3GB serverless function can hold alongside sharp/pdfjs working memory). */
const LINK_INFLATE_MAX_BYTES = 150 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export interface ImportedPackageAsset {
  name: string;
  objectPath: string;
  contentType: string;
  kind: "image" | "file" | "font";
}

export interface PackageImportResult {
  imported: ImportedPackageAsset[];
  skipped: { name: string; reason: string }[];
  /** Object path of the document PDF, ready for the Recreate-artwork flow. */
  documentPdfPath: string | null;
  idmlFound: boolean;
  fontsSkipped: number;
  /** Parsed layout from the package's IDML (Stage 2): the designer's exact
   * text, colours, frames and stacking order, ready to become a template.
   * First spread, kept for back-compat — see idmlLayouts for all variants. */
  idmlLayout: IdmlParseResult | null;
  /** Every spread of the document as its own layout (one message variant per
   * spread in real campaign masters, e.g. Storms / Quakes / Tsunami). */
  idmlLayouts: IdmlSpreadLayout[];
  idmlError: string | null;
}

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

export async function importInDesignPackage(
  objectPath: string,
  brandLogoUrl: string | null = null,
): Promise<PackageImportResult> {
  const file = await objectStorageService.getObjectEntityFile(objectPath);
  const response = await objectStorageService.downloadObject(file);
  const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));

  const result: PackageImportResult = {
    imported: [],
    skipped: [],
    documentPdfPath: null,
    idmlFound: false,
    fontsSkipped: 0,
    idmlLayout: null,
    idmlLayouts: [],
    idmlError: null,
  };

  // The largest PDF outside Links/ is taken as the document PDF.
  let docPdf: { name: string; bytes: Buffer } | null = null;
  let idmlBytes: Buffer | null = null;
  // Original link filename -> stored asset, for matching IDML image frames.
  const linksByName = new Map<string, { objectPath: string; kind: string }>();

  const entries = Object.values(zip.files)
    .filter((e) => !e.dir)
    .filter((e) => !e.name.includes("__MACOSX") && !baseName(e.name).startsWith("."))
    .slice(0, MAX_ENTRIES);

  for (const entry of entries) {
    const name = baseName(entry.name);
    const e = ext(name);
    const inLinks = /(^|\/)links\//i.test(entry.name);
    const inFonts = /(^|\/)(document )?fonts\//i.test(entry.name);

    if (inFonts) {
      // Campaign fonts (Document fonts/) are needed to render the imported
      // layouts with the designer's type — store TTF/OTF under the real
      // family name so the renderer can register them.
      if ((e === ".ttf" || e === ".otf") && !name.startsWith(".")) {
        try {
          const bytes = Buffer.from(await entry.async("arraybuffer"));
          if (bytes.length <= 20 * 1024 * 1024) {
            const { woffToSfnt, readSfntFamilyName } = await import("./freeformFonts");
            const family = readSfntFamilyName(woffToSfnt(new Uint8Array(bytes)));
            const contentType = e === ".otf" ? "font/otf" : "font/ttf";
            const storedPath = await objectStorageService.uploadBytes(bytes, contentType);
            result.imported.push({
              name: family ? `${family} (${name})` : name,
              objectPath: storedPath,
              contentType,
              kind: "font",
            });
            continue;
          }
        } catch {
          // fall through to the skip counter
        }
      }
      result.fontsSkipped++;
      continue;
    }
    if (e === ".idml") {
      result.idmlFound = true;
      idmlBytes = Buffer.from(await entry.async("arraybuffer"));
      continue;
    }
    if (e === ".pdf" && !inLinks) {
      const bytes = Buffer.from(await entry.async("arraybuffer"));
      if (!docPdf || bytes.length > docPdf.bytes.length) docPdf = { name, bytes };
      continue;
    }
    // Everything else only matters when it's a linked asset (or a stray image).
    if (
      !inLinks &&
      !(e in IMAGE_TYPES) &&
      e !== ".tif" &&
      e !== ".tiff" &&
      e !== ".ai" &&
      e !== ".pdf" &&
      e !== ".psd" &&
      e !== ".psb"
    ) {
      continue;
    }

    try {
      // Check the size from the zip index BEFORE inflating: a 1.4GB layered
      // PSD in Links/ (real AEM packages carry these) cannot be unpacked in a
      // serverless function's memory or time budget. Skip it by name so the
      // designer knows what to flatten; the IDML parser falls back to the
      // frame's pixels in the document PDF so the master still imports.
      const declaredSize = Number((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0);
      if (declaredSize > LINK_INFLATE_MAX_BYTES) {
        result.skipped.push({
          name,
          reason: `${Math.round(declaredSize / 1048576)}MB — too large to import; flatten it to a JPEG/PNG in Links and re-package`,
        });
        continue;
      }
      const bytes = Buffer.from(await entry.async("arraybuffer"));
      // An empty or unreadable link is a missing link. Slimmed packages ship
      // 0-byte placeholders in Links/; storing one gave a master whose photo
      // was a blank frame, and every size built from it had no photograph.
      // Skipped here, the IDML parser crops the frame from the document PDF.
      if (bytes.length === 0) {
        result.skipped.push({ name, reason: "empty file (0 bytes) — its frame was reproduced from the document PDF instead; re-package with the real link for full quality" });
        continue;
      }
      if (e in IMAGE_TYPES && e !== ".svg") {
        try {
          const meta = await sharp(bytes).metadata();
          if (!meta.width || !meta.height) throw new Error("no dimensions");
        } catch {
          result.skipped.push({ name, reason: "could not be read as an image — its frame was reproduced from the document PDF instead" });
          continue;
        }
      }

      if (e in IMAGE_TYPES) {
        const storedPath = await objectStorageService.uploadBytes(bytes, IMAGE_TYPES[e]);
        result.imported.push({ name, objectPath: storedPath, contentType: IMAGE_TYPES[e], kind: "image" });
        linksByName.set(name, { objectPath: storedPath, kind: "image" });
      } else if (e === ".tif" || e === ".tiff") {
        const png = await sharp(bytes).png().toBuffer();
        const storedPath = await objectStorageService.uploadBytes(png, "image/png");
        result.imported.push({
          name: name.replace(/\.tiff?$/i, ".png"),
          objectPath: storedPath,
          contentType: "image/png",
          kind: "image",
        });
        linksByName.set(name, { objectPath: storedPath, kind: "image" });
      } else if (e === ".psd" || e === ".psb") {
        // Flatten via the PSD's embedded composite; falls back to a raw file
        // in the catch below if the composite is missing.
        try {
          const png = await psdToPng(bytes);
          const storedPath = await objectStorageService.uploadBytes(png, "image/png");
          result.imported.push({
            name: name.replace(/\.psb?d?$/i, ".png"),
            objectPath: storedPath,
            contentType: "image/png",
            kind: "image",
          });
          linksByName.set(name, { objectPath: storedPath, kind: "image" });
        } catch {
          if (bytes.length <= MAX_RAW_FILE_BYTES) {
            const storedPath = await objectStorageService.uploadBytes(bytes, "application/octet-stream");
            result.imported.push({ name, objectPath: storedPath, contentType: "application/octet-stream", kind: "file" });
            linksByName.set(name, { objectPath: storedPath, kind: "file" });
          } else {
            result.skipped.push({ name, reason: "PSD could not be flattened and is over 50MB" });
          }
        }
      } else if (e === ".ai" || e === ".pdf") {
        // AI files are PDF-compatible in practice; render the first page.
        const { renderPdfPageToPng } = await import("./pdfRender");
        const { png } = await renderPdfPageToPng(new Uint8Array(bytes), 1);
        const storedPath = await objectStorageService.uploadBytes(png, "image/png");
        result.imported.push({
          name: name.replace(/\.(ai|pdf)$/i, ".png"),
          objectPath: storedPath,
          contentType: "image/png",
          kind: "image",
        });
        linksByName.set(name, { objectPath: storedPath, kind: "image" });
      } else if (bytes.length <= MAX_RAW_FILE_BYTES) {
        // psd / eps / indd and friends: keep the original as a downloadable file.
        const storedPath = await objectStorageService.uploadBytes(bytes, "application/octet-stream");
        result.imported.push({ name, objectPath: storedPath, contentType: "application/octet-stream", kind: "file" });
        linksByName.set(name, { objectPath: storedPath, kind: "file" });
      } else {
        result.skipped.push({ name, reason: "over 50MB" });
      }
    } catch (err) {
      result.skipped.push({
        name,
        reason: err instanceof Error ? err.message.slice(0, 120) : "could not convert",
      });
    }
  }

  if (docPdf) {
    result.documentPdfPath = await objectStorageService.uploadBytes(docPdf.bytes, "application/pdf");
  }

  // Stage 2: parse the IDML into the designer's exact layouts — one per
  // spread, since campaign masters carry one message variant per page.
  if (idmlBytes) {
    try {
      const idmlZip = await JSZip.loadAsync(idmlBytes);
      result.idmlLayouts = await parseIdmlToLayouts(idmlZip, linksByName, brandLogoUrl);
      result.idmlLayout = result.idmlLayouts[0] ?? null;

      // Vector art the parser can't recreate (pattern bands, lockups, the
      // anther) is reproduced pixel-perfect: crop each marked region out of
      // the package's own document PDF. Spread N = PDF page N.
      //
      // Crops come from a TEXT-FREE copy of the PDF: live type is removed from
      // the content streams first, so a crop never bakes in copy that the
      // layout also draws as a live text element (ghosted/doubled headlines).
      let cropPdf: { bytes: Buffer; removed: number; softMaskedImages: number[]; outlinedRemoved?: number } | null = null;
      if (docPdf) {
        try {
          // The IDML's text frames, per spread, in PDF coordinates: any
          // outlined type the export left as vector paths inside them is
          // stripped along with the text objects.
          const typeFrames = new Map<number, Array<{ x0: number; y0: number; x1: number; y1: number }>>();
          for (const lay of result.idmlLayouts) {
            const frames = lay.elements
              .filter((el) => el.type === "text")
              .map((el) => ({ x0: Number(el.x), y0: lay.height - (Number(el.y) + Number(el.h)), x1: Number(el.x) + Number(el.w), y1: lay.height - Number(el.y) }));
            typeFrames.set(lay.spreadIndex, frames);
          }
          cropPdf = await stripPdfText(docPdf.bytes, { typeFrames });
        } catch {
          cropPdf = { bytes: docPdf.bytes, removed: 0, softMaskedImages: [] };
        }
      }
      for (let i = 0; i < result.idmlLayouts.length; i++) {
        const layout = result.idmlLayouts[i];
        const regions = layout.elements.filter((el) => el.type === "rasterRegion");
        if (regions.length === 0) continue;
        if (docPdf) {
          try {
            const { renderPdfPageToPng } = await import("./pdfRender");
            // pdfjs detaches the buffer it's given — copy per render.
            const pdfBytes = cropPdf ? cropPdf.bytes : docPdf.bytes;
            const textFree = (cropPdf?.removed ?? 0) > 0 || (cropPdf?.outlinedRemoved ?? 0) > 0;
            const rendered = await renderPdfPageToPng(Uint8Array.from(pdfBytes), layout.spreadIndex + 1);
            // Photo frames whose link was missing or too large are taken from
            // the PDF too. With the text objects stripped the crop is clean;
            // if nothing could be stripped (outlined type), hide type layers
            // where the PDF has them, else the copy is baked in.
            let renderedNoType: typeof rendered | null = null;
            if (regions.some((r) => r.photoFallback)) {
              if (!textFree) {
                try {
                  renderedNoType = await renderPdfPageToPng(Uint8Array.from(pdfBytes), layout.spreadIndex + 1, { hideTextLayers: true });
                } catch {
                  renderedNoType = null;
                }
              }
              const hid = renderedNoType?.hiddenLayers?.length ?? 0;
              layout.warnings.push(
                textFree || hid > 0
                  ? "A placed photo was reproduced from the document PDF (its Links file was missing, too large, or in a shaped frame); the crop was taken with the type removed."
                  : "A placed photo was reproduced from the document PDF (its Links file was missing or too large). Its copy could not be separated, so any copy over that photo is baked into its pixels — re-package with a flattened JPEG/PNG for fully re-settable sizes.",
              );
            }
            const scale = rendered.width / layout.width;
            for (const region of regions) {
              const source = region.photoFallback && renderedNoType ? renderedNoType : rendered;
              const left = Math.max(0, Math.round(Number(region.x) * scale));
              const top = Math.max(0, Math.round(Number(region.y) * scale));
              const width = Math.min(source.width - left, Math.max(1, Math.round(Number(region.w) * scale)));
              const height = Math.min(source.height - top, Math.max(1, Math.round(Number(region.h) * scale)));
              if (width < 1 || height < 1) continue;
              const crop = await sharp(source.png).extract({ left, top, width, height }).png().toBuffer();
              const storedPath = await objectStorageService.uploadBytes(crop, "image/png");
              region.type = "image";
              region.src = `/api/storage${storedPath}`;
              region.fit = "cover";
              if (region.photoFallback) {
                region.role = "product";
                region.locked = false;
                // Stripping the text objects cleans the crop of the type
                // itself. What survives is InDesign's type EFFECTS (outer
                // glow, drop shadow), exported as soft-masked images — a faint
                // ghost of the headline. So: copy overlapping this frame only
                // bakes in when the page carries such effects, or when no text
                // could be stripped at all (outlined type). Then the master
                // still imports, but size builds are refused (adapt route).
                const rx = Number(region.x), ry = Number(region.y), rw = Number(region.w), rh = Number(region.h);
                const overlapsText = layout.elements.some((t) => {
                  if (t.type !== "text") return false;
                  const tx = Number(t.x), ty = Number(t.y), tw = Number(t.w), th = Number(t.h);
                  return tx < rx + rw && tx + tw > rx && ty < ry + rh && ty + th > ry;
                });
                const effectsOnPage = (cropPdf?.softMaskedImages[layout.spreadIndex] ?? 0) > 0;
                // Copy is baked in only when the type could not be stripped
                // (outlined type). Type effects left behind are a faint ghost
                // at most: warn, but let sizes be built.
                if (overlapsText && !textFree) region.bakedCopy = true;
                else if (overlapsText && effectsOnPage) layout.warnings.push("The photo was cropped from the document PDF with the type removed; a faint ghost of the type's glow or shadow may remain — check the photo zone.");
                delete region.maskedFrame;
                delete region.photoFallback;
              } else {
                region.locked = true;
              }
            }
          } catch {
            layout.warnings.push("Vector-art regions could not be reproduced from the document PDF.");
          }
        } else {
          layout.warnings.push("No document PDF in the package — vector-art regions were dropped.");
        }
        // Anything still unrasterized has no faithful representation.
        layout.elements = layout.elements.filter((el) => el.type !== "rasterRegion");
      }
      // Pre-crop placed photos to the designer's in-frame window (srcRect):
      // the stored asset then IS what the designer showed, and cover-fit,
      // adaptation and the editor all reproduce it with no extra state.
      const cropCache = new Map<string, string>();
      const srcBytesCache = new Map<string, Buffer>();
      for (const layout of result.idmlLayouts) {
        for (const el of layout.elements) {
          const rect = el.srcRect as { x: number; y: number; w: number; h: number } | undefined;
          if (el.type !== "image" || !rect || typeof el.src !== "string") continue;
          delete el.srcRect;
          try {
            const objPath = String(el.src).replace(/^\/api\/storage/, "");
            const key = `${objPath}|${rect.x.toFixed(3)},${rect.y.toFixed(3)},${rect.w.toFixed(3)},${rect.h.toFixed(3)}`;
            let croppedPath = cropCache.get(key);
            if (!croppedPath) {
              let src = srcBytesCache.get(objPath);
              if (!src) {
                const file = await objectStorageService.getObjectEntityFile(objPath);
                src = Buffer.from(await (await objectStorageService.downloadObject(file)).arrayBuffer());
                srcBytesCache.set(objPath, src);
              }
              const meta = await sharp(src).metadata();
              const iw = meta.width ?? 0;
              const ih = meta.height ?? 0;
              if (iw < 2 || ih < 2) continue;
              const left = Math.min(iw - 1, Math.max(0, Math.round(rect.x * iw)));
              const top = Math.min(ih - 1, Math.max(0, Math.round(rect.y * ih)));
              const width = Math.max(1, Math.min(iw - left, Math.round(rect.w * iw)));
              const height = Math.max(1, Math.min(ih - top, Math.round(rect.h * ih)));
              const pipeline = sharp(src).extract({ left, top, width, height });
              const jpeg = meta.format === "jpeg";
              const out = jpeg ? await pipeline.jpeg({ quality: 95 }).toBuffer() : await pipeline.png().toBuffer();
              croppedPath = await objectStorageService.uploadBytes(out, jpeg ? "image/jpeg" : "image/png");
              cropCache.set(key, croppedPath);
            }
            el.src = `/api/storage${croppedPath}`;
          } catch {
            // keep the uncropped source — cover-fit is the closest stand-in
          }
        }
      }

      // Hero box on each layout's main artwork, so adapted crops frame the
      // subject. Cached per object path — spreads often share imagery.
      const heroCache = new Map<string, { x: number; y: number; w: number; h: number } | null>();
      for (const layout of result.idmlLayouts) {
        const images = layout.elements.filter(
          (e) => e.type === "image" && e.role !== "logo" && typeof e.src === "string",
        );
        const main = images.sort((a, b) => Number(b.w) * Number(b.h) - Number(a.w) * Number(a.h))[0];
        if (!main) continue;
        try {
          const objPath = String(main.src).replace(/^\/api\/storage/, "");
          let box = heroCache.get(objPath);
          if (box === undefined) {
            const file = await objectStorageService.getObjectEntityFile(objPath);
            const bytes = Buffer.from(await (await objectStorageService.downloadObject(file)).arrayBuffer());
            const { detectHeroBox } = await import("./heroBox");
            box = await detectHeroBox(bytes);
            heroCache.set(objPath, box);
          }
          if (box) {
            main.focusBox = box;
            main.focusSource = "attention";
            // The designer's own in-frame crop (parsed from the IDML) wins;
            // detection only fills the gaps.
            if (main.focusX === undefined) main.focusX = box.x + box.w / 2;
            if (main.focusY === undefined) main.focusY = box.y + box.h / 2;
          }
        } catch {
          // hero detection is best-effort
        }
      }
    } catch (err) {
      result.idmlError = err instanceof Error ? err.message.slice(0, 160) : "IDML could not be parsed";
    }
  }

  return result;
}
