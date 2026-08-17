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
import type { FreeformConfig, FreeformElement, FreeformImage, KvTextBlock } from "./freeform";

export interface KvBrandInfo {
  logoUrl: string | null;
  strapline: string | null;
}

const STRIP_MAX_HEIGHT = 120;
const MIN_HEADLINE_PX = 13;

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

export function composeKeyVisualAdaptation(
  master: FreeformConfig,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  brand: KvBrandInfo,
): FreeformConfig | null {
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

  // 2. Strapline re-set whole on the bottom margin (never cropped).
  let straplineTopY = dstH;
  if (showStrapline) {
    const lines = (brand.strapline as string).split("\n").filter(Boolean).slice(0, 2);
    const fontSize = Math.max(10, Math.round(tile / 7));
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
      color: "#ffffff",
      align: "left",
      lineHeight: 1.3,
      locked: true,
    } as FreeformElement);
  }

  // 3. Headline: the master's own words, re-set on this format's grid.
  const kvText = bg.kvText ?? [];
  const headline = pickBlock(kvText, "headline") ?? kvText.slice().sort((a, b) => b.fontSize - a.fontSize)[0];
  if (headline) {
    const fontSize = Math.max(MIN_HEADLINE_PX, Math.round(short * (isStrip || isWide ? 0.16 : 0.055)));
    const text = isStrip ? headline.text.replace(/\n+/g, " ") : headline.text;
    const lines = text.split("\n").length;
    const estH = Math.round(lines * fontSize * 1.25);
    const wAvail = dstW - margin * 2 - (isStrip || isWide ? tile + margin : 0);
    let y: number;
    if (isStrip || isWide) {
      y = Math.max(margin, Math.round((dstH - estH) / 2)); // vertically centred beside the tile
    } else {
      const bottomLimit = showStrapline ? straplineTopY - margin : dstH - (showLogo ? tile : margin) - margin;
      y = Math.max(margin, bottomLimit - estH); // lower third, above the furniture
    }
    elements.push({
      id: "kv_headline",
      type: "text",
      role: "headline",
      text,
      x: margin,
      y,
      w: Math.max(40, wAvail),
      h: estH,
      fontSize,
      fontWeight: 700,
      color: headline.color ?? "#ffffff",
      align: isStrip || isWide ? "left" : "center",
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

  return { kind: "freeform", elements };
}
