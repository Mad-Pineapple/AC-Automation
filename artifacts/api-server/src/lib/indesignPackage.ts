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
import { parseIdmlToLayout, type IdmlParseResult } from "./idmlParse";

const objectStorageService = new ObjectStorageService();

const MAX_ENTRIES = 200;
const MAX_RAW_FILE_BYTES = 50 * 1024 * 1024;

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
  kind: "image" | "file";
}

export interface PackageImportResult {
  imported: ImportedPackageAsset[];
  skipped: { name: string; reason: string }[];
  /** Object path of the document PDF, ready for the Recreate-artwork flow. */
  documentPdfPath: string | null;
  idmlFound: boolean;
  fontsSkipped: number;
  /** Parsed layout from the package's IDML (Stage 2): the designer's exact
   * text, colours, frames and stacking order, ready to become a template. */
  idmlLayout: IdmlParseResult | null;
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
    if (!inLinks && !(e in IMAGE_TYPES) && e !== ".tif" && e !== ".tiff" && e !== ".ai" && e !== ".pdf") {
      continue;
    }

    try {
      const bytes = Buffer.from(await entry.async("arraybuffer"));

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

  // Stage 2: parse the IDML into the designer's exact layout.
  if (idmlBytes) {
    try {
      const idmlZip = await JSZip.loadAsync(idmlBytes);
      result.idmlLayout = await parseIdmlToLayout(idmlZip, linksByName, brandLogoUrl);
    } catch (err) {
      result.idmlError = err instanceof Error ? err.message.slice(0, 160) : "IDML could not be parsed";
    }
  }

  return result;
}
