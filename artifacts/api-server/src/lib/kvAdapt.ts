/**
 * Brand-aware recomposition of key-visual masters (the designer's adapt).
 *
 * A poster is a composition, not a picture: only the artwork may be cropped;
 * the brand furniture — headline, strapline, pōhutukawa tile — must be RE-SET
 * on each output format's own grid. Rules encoded from the AC Brand
 * Guidelines (June 2025, docs/brand-guidelines-distilled.md):
 *
 *  - Tile grid: tile = shortest axis / 6 (app convention for digital);
 *    page margin = tile / 3. Strip formats (height <= 120) use a full-height
 *    tile flush right, as in the shipped GWD banners.
 *  - Logo: white tile, mark inset 1/8, flush bottom-right, never cropped.
 *    1080x1080 social tiles carry NO logo (the pōhutukawa is the profile
 *    picture), and straplines are not required on social statics.
 *  - Strapline: te reo first, two lines, ~1/3 tile in height, on the margin.
 *  - Type is never cropped and never microscopic: headline has a floor size.
 *  - The artwork layer keeps a focal point so cover crops frame the hero,
 *    and its pixels are never modified.
 */
import sharp from "sharp";
import { ObjectStorageService } from "./objectStorage";
import type { FreeformConfig, FreeformElement, FreeformImage, KvTextBlock } from "./freeform";

const objectStorageService = new ObjectStorageService();

export interface KvBrandInfo {
  logoUrl: string | null;
  strapline: string | null;
}

const STRIP_MAX_HEIGHT = 120;
const MIN_HEADLINE_PX = 13;
/** White copy needs a treatment when the artwork behind it is lighter than
 * this (0-255 luminance) — same threshold the compliance checker uses. */
const SCRIM_LUMINANCE_THRESHOLD = 140;
const SCRIM_COLOR = "#11263d"; // Ocean, per the guidelines' colour/opacity effect
const SCRIM_OPACITY = 0.55;

// One-entry cache so adapting several sizes of the same master downloads the
// artwork once per process, not once per target.
let artworkCache: { src: string; buffer: Buffer } | null = null;

async function loadArtwork(src: string): Promise<Buffer | null> {
  if (artworkCache?.src === src) return artworkCache.buffer;
  try {
    const objectPath = src.replace(/^\/api\/storage/, "");
    const file = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(file);
    const buffer = Buffer.from(await response.arrayBuffer());
    artworkCache = { src, buffer };
    return buffer;
  } catch {
    return null;
  }
}

/** Mean luminance (0-255) of the artwork region behind a canvas-space box,
 * or null when it can't be sampled (missing artwork, box off-image). */
async function sampleLuminanceBehind(
  src: string,
  imgW: number,
  imgH: number,
  art: { x: number; y: number; w: number; h: number },
  box: { x: number; y: number; w: number; h: number },
): Promise<number | null> {
  const buffer = await loadArtwork(src);
  if (!buffer) return null;
  const s = art.w / imgW; // canvas px per source px
  const left = Math.round((box.x - art.x) / s);
  const top = Math.round((box.y - art.y) / s);
  const width = Math.round(box.w / s);
  const height = Math.round(box.h / s);
  const cl = Math.max(0, Math.min(imgW - 1, left));
  const ct = Math.max(0, Math.min(imgH - 1, top));
  const cw = Math.max(1, Math.min(imgW - cl, width - (cl - left)));
  const ch = Math.max(1, Math.min(imgH - ct, height - (ct - top)));
  try {
    const stats = await sharp(buffer).extract({ left: cl, top: ct, width: cw, height: ch }).stats();
    const [r, g, b] = stats.channels;
    return 0.299 * r.mean + 0.587 * g.mean + 0.114 * b.mean;
  } catch {
    return null;
  }
}

/** The KV master shape: first element is a locked, full-bleed cover image. */
export function findKvBackground(config: FreeformConfig, srcW: number, srcH: number): FreeformImage | null {
  const first = config.elements[0];
  if (!first || first.type !== "image" || !first.src) return null;
  const img = first as FreeformImage;
  const fullBleed = img.x <= 0 && img.y <= 0 && img.w >= srcW * 0.98 && img.h >= srcH * 0.98;
  return fullBleed && (img.fit ?? "cover") === "cover" ? img : null;
}

function pickBlock(kvText: KvTextBlock[], role: string): KvTextBlock | undefined {
  const byRole = kvText.filter((t) => t.role === role);
  if (byRole.length > 0) return byRole.sort((a, b) => b.fontSize - a.fontSize)[0];
  return undefined;
}

export async function composeKeyVisualAdaptation(
  master: FreeformConfig,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  brand: KvBrandInfo,
): Promise<FreeformConfig | null> {
  const bg = findKvBackground(master, srcW, srcH);
  if (!bg) return null;

  const short = Math.min(dstW, dstH);
  const isStrip = dstH <= STRIP_MAX_HEIGHT;
  const isWide = dstW / dstH > 2.5;
  // Social squares carry no logo and no strapline per the guidelines.
  const isSocialSquare = Math.abs(dstW - dstH) < 2 && dstW >= 600;

  const tile = isStrip ? dstH : Math.max(24, Math.round(short / 6));
  const margin = Math.max(6, Math.round(tile / 3));
  const showLogo = !isSocialSquare && !!brand.logoUrl;
  const showStrapline = !isSocialSquare && !isStrip && !isWide && dstH >= 400 && !!brand.strapline;

  const elements: FreeformElement[] = [];

  // 1. Artwork: untouched pixels, cropped like a designer would — the element
  //    is drawn at the image's natural aspect and positioned so the CLEAN
  //    band (above the baked copy) fills the canvas; the baked type stays
  //    outside the frame instead of being sliced through.
  const kvTextAll = bg.kvText ?? [];
  const textTop = kvTextAll.length > 0 ? Math.min(...kvTextAll.map((t) => t.y)) : srcH;
  // Only trust the clean band when the copy sits in the lower part of the
  // design; text at the top means there is no clean band to zoom into.
  const cleanH = textTop > srcH * 0.35 ? textTop : srcH;
  const s = Math.max(dstW / srcW, dstH / cleanH);
  const artW = Math.round(srcW * s);
  const artH = Math.round(srcH * s);
  const visibleRows = dstH / s;
  // Centre the visible window on the hero (the stored focal point), clamped
  // so it never slides past the clean band into the baked copy.
  const heroCentre = (bg.focusY ?? 0.45) * srcH;
  const srcYOffset = Math.min(
    Math.max(0, heroCentre - visibleRows / 2),
    Math.max(0, cleanH - visibleRows),
  );
  const artX = Math.round((dstW - artW) * (bg.focusX ?? 0.5));
  const artY = -Math.round(srcYOffset * s);
  elements.push({
    ...bg,
    id: "kv_background",
    x: artX,
    y: artY,
    w: artW,
    h: artH,
    fit: "cover",
    locked: true,
  });

  // ---- Assess the original design ------------------------------------------
  // The master is the design authority: measure its type scale, copy position
  // and alignment, then reproduce those proportions on every format, bounded
  // by the guideline grid. No arbitrary constants.
  const kvText = bg.kvText ?? [];
  const headline = pickBlock(kvText, "headline") ?? kvText.slice().sort((a, b) => b.fontSize - a.fontSize)[0];
  const subhead = pickBlock(kvText, "subhead");
  const srcShort = Math.min(srcW, srcH);

  // Type scale as designed: headline px relative to the master's short axis.
  const headlineRatio = headline ? headline.fontSize / srcShort : 0.05;
  const subheadRatio = subhead ? subhead.fontSize / srcShort : headlineRatio * 0.5;
  // Where the designer put the copy (fraction of canvas height), and how wide.
  const headlineCentreYFrac = headline ? (headline.y + headline.h / 2) / srcH : 0.72;
  const headlineWidthFrac = headline ? Math.min(1, headline.w / srcW) : 0.86;
  // Alignment as designed: a block whose centre sits mid-canvas is centred.
  const headlineCentred = headline
    ? Math.abs((headline.x + headline.w / 2) / srcW - 0.5) < 0.08
    : true;

  const longestLineChars = (text: string) =>
    Math.max(...text.split("\n").map((l) => l.trim().length), 1);

  // 2. Strapline re-set whole on the bottom margin (never cropped). Sized by
  //    the master's own subhead scale when it carried one.
  let straplineTopY = dstH;
  if (showStrapline) {
    const lines = (brand.strapline as string).split("\n").filter(Boolean).slice(0, 2);
    const fontSize = Math.max(10, Math.round(subheadRatio * short));
    const estH = Math.round(lines.length * fontSize * 1.3);
    straplineTopY = dstH - margin - estH;
    elements.push({
      id: "kv_strapline",
      type: "text",
      role: "other",
      text: lines.join("\n"),
      x: margin,
      y: straplineTopY,
      w: Math.max(40, dstW - (showLogo ? tile + margin : 0) - margin * 2),
      h: estH,
      fontSize,
      fontWeight: 700,
      color: subhead?.color ?? "#ffffff",
      align: "left",
      lineHeight: 1.3,
      locked: true,
    } as FreeformElement);
  }

  // 3. Headline: the master's own words at the master's own scale, placed at
  //    the master's own height fraction — clamped to the format's grid.
  if (headline) {
    const text = isStrip ? headline.text.replace(/\n+/g, " ") : headline.text;
    const lines = text.split("\n").length;
    const wAvail = dstW - margin * 2 - (isStrip || isWide ? tile + margin : 0);

    // Target scale = the design's own ratio. Bounds = what physically fits:
    // the longest line across the available width, and the line count within
    // the format's height band. Wide/strip formats are display media, so when
    // the design ratio comes out unreadably small they size up to fit instead.
    const fitToWidth = wAvail / (longestLineChars(text) * 0.58);
    const fitToHeight = (dstH - margin * 2) / (lines * 1.3);
    const fitCap = Math.min(fitToWidth, fitToHeight);
    const designSize = headlineRatio * short;
    const fontSize = Math.round(
      Math.max(
        MIN_HEADLINE_PX,
        Math.min(fitCap, isStrip || isWide ? Math.max(designSize, fitCap * 0.8) : designSize),
      ),
    );

    const estH = Math.round(lines * fontSize * 1.25);
    let y: number;
    if (isStrip || isWide) {
      y = Math.max(margin, Math.round((dstH - estH) / 2)); // centred beside the tile
    } else {
      // The designer's height fraction, clamped inside margins and above the
      // strapline/logo furniture.
      const bottomLimit = showStrapline ? straplineTopY - margin : dstH - (showLogo ? tile : margin) - margin;
      const target = Math.round(headlineCentreYFrac * dstH - estH / 2);
      y = Math.min(Math.max(margin, target), Math.max(margin, bottomLimit - estH));
    }

    const w = Math.max(40, Math.min(wAvail, Math.round(headlineWidthFrac * dstW)));
    const x = headlineCentred && !isStrip && !isWide ? Math.round((dstW - w) / 2) : margin;
    elements.push({
      id: "kv_headline",
      type: "text",
      role: "headline",
      text,
      x,
      y,
      w,
      h: estH,
      fontSize,
      fontWeight: 700,
      color: headline.color ?? "#ffffff",
      align: headlineCentred && !isStrip && !isWide ? "center" : "left",
      lineHeight: 1.25,
    } as FreeformElement);
  }

  // 4. Pōhutukawa tile: white tile, mark inset 1/8, flush bottom-right.
  if (showLogo) {
    const inset = Math.round(tile / 8);
    elements.push({
      id: "kv_logo_tile",
      type: "rect",
      fill: "#ffffff",
      x: dstW - tile,
      y: dstH - tile,
      w: tile,
      h: tile,
      locked: true,
    } as FreeformElement);
    elements.push({
      id: "kv_logo",
      type: "image",
      role: "logo",
      src: brand.logoUrl,
      fit: "contain",
      x: dstW - tile + inset,
      y: dstH - tile + inset,
      w: tile - inset * 2,
      h: tile - inset * 2,
      locked: true,
    } as FreeformElement);
  }

  // 5. Readability (guidelines: backgrounds behind copy get a colour/opacity
  //    effect and must pass contrast). Sample the actual artwork behind each
  //    copy block; where white type would fail, slide an Ocean panel between
  //    artwork and type. The artwork itself stays untouched underneath.
  if (bg.src) {
    const art = { x: artX, y: artY, w: artW, h: artH };
    const copyElements = elements.filter(
      (el): el is FreeformElement & { type: "text" } =>
        el.type === "text" && (el.id === "kv_headline" || el.id === "kv_strapline"),
    );
    const scrims: FreeformElement[] = [];
    for (const el of copyElements) {
      const lum = await sampleLuminanceBehind(bg.src, srcW, srcH, art, el);
      if (lum !== null && lum >= SCRIM_LUMINANCE_THRESHOLD) {
        const pad = Math.round(margin / 2);
        scrims.push({
          id: `${el.id}_scrim`,
          type: "rect",
          fill: SCRIM_COLOR,
          opacity: SCRIM_OPACITY,
          radius: Math.min(12, pad),
          x: el.x - pad,
          y: el.y - pad,
          w: el.w + pad * 2,
          h: el.h + pad * 2,
          locked: true,
        } as FreeformElement);
      }
    }
    // z-order: artwork, then scrims, then everything else.
    elements.splice(1, 0, ...scrims);
  }

  return { kind: "freeform", elements };
}
