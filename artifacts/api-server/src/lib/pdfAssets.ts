/**
 * Extract brand ASSETS (embedded images + font names) from an uploaded PDF.
 *
 * Complements the text-only guideline analysis: walks the document, resolves
 * placed raster images, dedupes near-duplicates (the same logo repeated across
 * pages), and persists each unique image to object storage. Also collects the
 * distinct font families actually used, resolved to their real names via pdfjs
 * `commonObjs` (the text-layer `styles` only report generic families such as
 * "sans-serif" for embedded/subset fonts).
 *
 * Best-effort: any per-page / per-image failure is skipped, never thrown, so a
 * partially-broken PDF still yields whatever could be recovered.
 */
import { ObjectStorageService } from "./objectStorage";
import { getImageObject, encodeImageToPng, cleanFontFamily } from "./pdfDissect";

const objectStorageService = new ObjectStorageService();

const MAX_PAGES = 60; // parsing is cheap (~0.1s/page); walk deep for coverage
const MAX_IMAGES = 12; // uploaded (unique) images to return
const MAX_IMAGES_PER_PAGE = 3; // spread the set across pages (logos + imagery)
const MAX_RESOLVES = 80; // hard cap on image decodes to bound work
const MIN_IMAGE_SIDE = 32; // px; skip bullets / hairline rules
const MAX_IMAGE_PIXELS = 16_000_000; // ~16MP; pure-JS PNG encode is slow above this
const MAX_FONTS = 12;
const TIME_BUDGET_MS = 45_000; // overall wall-clock safety valve

const GENERIC_FONTS = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
]);

// Trailing weight / style tokens stripped to collapse a font to its family
// (e.g. "National2-Regular" / "National2-Bold" -> "National2").
const WEIGHT_STYLE = new Set([
  "thin",
  "hairline",
  "extralight",
  "ultralight",
  "light",
  "regular",
  "normal",
  "book",
  "roman",
  "text",
  "medium",
  "semibold",
  "demibold",
  "demi",
  "bold",
  "extrabold",
  "ultrabold",
  "xbold",
  "xlight",
  "heavy",
  "black",
  "italic",
  "oblique",
  "bolditalic",
  "semibolditalic",
  "lightitalic",
  "mediumitalic",
  "boldoblique",
  "blackitalic",
  "regularit",
  "boldit",
  "lightit",
  "mediumit",
  "semiboldit",
  "blackit",
  "xboldit",
]);

export interface ExtractedImage {
  url: string;
  objectPath: string;
  width: number;
  height: number;
}

export interface PdfAssets {
  images: ExtractedImage[];
  fonts: string[];
}

/** Collapse a raw font name (e.g. "ABCDEF+National2-Bold") to its family. */
function toFontFamily(rawName: string): string | undefined {
  const cleaned = cleanFontFamily(rawName);
  if (!cleaned) return undefined;
  const parts = cleaned.split(/[-\s]+/).filter(Boolean);
  while (parts.length > 1 && WEIGHT_STYLE.has(parts[parts.length - 1].toLowerCase())) {
    parts.pop();
  }
  const family = parts.join(" ").trim();
  return family.length > 0 ? family : cleaned;
}

/** Sum every ~1024th raw byte — a cheap content signature for dedup. */
function sparseSignature(data: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1024) sum += data[i];
  return sum;
}

export async function extractPdfAssets(objectPath: string): Promise<PdfAssets> {
  const file = await objectStorageService.getObjectEntityFile(objectPath);
  const response = await objectStorageService.downloadObject(file);
  const arrayBuffer = await response.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // useSystemFonts:false keeps the parsed font objects (with their real names)
  // instead of substituting system fallbacks; disableFontFace avoids DOM APIs.
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: false, disableFontFace: true });
  const doc = await loadingTask.promise;

  const pending: { png: Buffer; width: number; height: number }[] = [];
  const seenImages = new Set<string>();
  const fonts = new Map<string, string>(); // lowercase key -> display name
  let resolves = 0;
  const deadline = Date.now() + TIME_BUDGET_MS;

  try {
    const numPages = Math.min(doc.numPages, MAX_PAGES);
    const OPS = pdfjs.OPS;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (pending.length >= MAX_IMAGES || Date.now() > deadline) break;

      let page: any;
      try {
        page = await doc.getPage(pageNum);
      } catch {
        continue;
      }

      // --- Operator list first: loads fonts into commonObjs + lists images ---
      const objIds = new Set<string>();
      try {
        const opList = await page.getOperatorList();
        for (let i = 0; i < opList.fnArray.length; i++) {
          if (opList.fnArray[i] === OPS.paintImageXObject) {
            const args = opList.argsArray[i] as unknown[];
            objIds.add(String(args[0]));
          }
        }
      } catch {
        /* still try fonts below */
      }

      // --- Fonts: real names of the typefaces actually used on this page ---
      try {
        const content = await page.getTextContent();
        const styles = content.styles ?? {};
        const loaderIds = new Set<string>();
        for (const item of content.items) {
          if (!("str" in item) || !item.str || !item.str.trim()) continue;
          if (item.fontName) loaderIds.add(item.fontName);
        }
        for (const lid of loaderIds) {
          let name = "";
          try {
            const obj = page.commonObjs.has(lid) ? page.commonObjs.get(lid) : null;
            if (obj?.name) name = obj.name as string;
          } catch {
            /* font not resolvable via commonObjs */
          }
          if (!name) name = (styles[lid]?.fontFamily as string | undefined) ?? lid;
          const family = toFontFamily(name);
          if (!family) continue;
          const key = family.toLowerCase();
          if (GENERIC_FONTS.has(key)) continue;
          if (!fonts.has(key)) fonts.set(key, family);
        }
      } catch {
        /* ignore text failures for this page */
      }

      // --- Images: unique paintImageXObject placements on this page ---
      let perPage = 0;
      for (const objId of objIds) {
        if (
          pending.length >= MAX_IMAGES ||
          perPage >= MAX_IMAGES_PER_PAGE ||
          resolves >= MAX_RESOLVES ||
          Date.now() > deadline
        ) {
          break;
        }
        resolves++;
        try {
          const img = await getImageObject(page, objId);
          if (!img || !img.width || !img.height || !img.data) continue;
          const w = img.width as number;
          const h = img.height as number;
          if (w < MIN_IMAGE_SIDE || h < MIN_IMAGE_SIDE) continue;
          if (w * h > MAX_IMAGE_PIXELS) continue;

          // Dedup BEFORE encoding (same logo/photo repeated across pages).
          const sig = `${w}x${h}:${img.data.length}:${sparseSignature(img.data)}`;
          if (seenImages.has(sig)) continue;
          seenImages.add(sig);

          const png = encodeImageToPng(pdfjs, img);
          if (!png) continue;
          pending.push({ png, width: w, height: h });
          perPage++;
        } catch {
          /* skip this image */
        }
      }
    }
  } finally {
    await loadingTask.destroy();
  }

  // Persist unique images to object storage in parallel (uploads dominate the
  // wall-clock time; the parse itself is cheap).
  const uploaded = await Promise.all(
    pending.map(async (p) => {
      try {
        const storedPath = await objectStorageService.uploadBytes(p.png, "image/png");
        return {
          url: `/api/storage${storedPath}`,
          objectPath: storedPath,
          width: p.width,
          height: p.height,
        } satisfies ExtractedImage;
      } catch {
        return null;
      }
    }),
  );

  return {
    images: uploaded.filter((x): x is ExtractedImage => x !== null),
    fonts: Array.from(fonts.values()).slice(0, MAX_FONTS),
  };
}
