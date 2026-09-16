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
import { guidelineLogoPlacement } from "./logoRules";
import { STRIP_MAX_HEIGHT } from "./formatCatalog";
import { inferSlots } from "./slots";
import { prepareMeasurement, wrapText, measureLine, type FontSpec } from "./textMeasure";
import { planCta } from "./ctaPlan";
import type { RuleLayer } from "./partRulesLayer";
import type { FreeformConfig, FreeformElement, FreeformImage, FreeformRect, FreeformText, KvTextBlock } from "./freeform";

const objectStorageService = new ObjectStorageService();

export interface KvBrandInfo {
  logoUrl: string | null;
  strapline: string | null;
  /** The campaign's part rules (floors); studio defaults when absent. */
  rules?: RuleLayer;
}

const MIN_HEADLINE_PX_DEFAULT = 13;
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

/** Average colour of the artwork's outer border, as a hex string. Used as the
 * field colour when whole artwork has to be shown on a canvas of a different
 * shape — sampled from the design itself, never invented. */
async function sampleEdgeColor(src: string, imgW: number, imgH: number): Promise<string | null> {
  const buffer = await loadArtwork(src);
  if (!buffer) return null;
  const band = Math.max(1, Math.round(Math.min(imgW, imgH) * 0.04));
  const strips = [
    { left: 0, top: 0, width: imgW, height: Math.min(band, imgH) },
    { left: 0, top: Math.max(0, imgH - band), width: imgW, height: Math.min(band, imgH) },
    { left: 0, top: 0, width: Math.min(band, imgW), height: imgH },
    { left: Math.max(0, imgW - band), top: 0, width: Math.min(band, imgW), height: imgH },
  ];
  try {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const s of strips) {
      const stats = await sharp(buffer).extract(s).stats();
      r += stats.channels[0].mean;
      g += stats.channels[1].mean;
      b += stats.channels[2].mean;
      n++;
    }
    if (n === 0) return null;
    const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v / n))).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return null;
  }
}

/** Luminance (0-255) and busyness (mean channel std-dev) of the artwork
 * behind a canvas-space box — the "what is behind the type" measurement. */
async function sampleRegionStats(
  src: string,
  imgW: number,
  imgH: number,
  art: { x: number; y: number; w: number; h: number },
  box: { x: number; y: number; w: number; h: number },
): Promise<{ lum: number; busy: number; whiteContrast: number } | null> {
  const buffer = await loadArtwork(src);
  if (!buffer) return null;
  const s = art.w / imgW;
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
    const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const rel = 0.2126 * lin(r.mean) + 0.7152 * lin(g.mean) + 0.0722 * lin(b.mean);
    return {
      lum: 0.299 * r.mean + 0.587 * g.mean + 0.114 * b.mean,
      busy: (r.stdev + g.stdev + b.stdev) / 3,
      // WCAG ratio of white type against this ground.
      whiteContrast: 1.05 / (rel + 0.05),
    };
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

function pickBlock<T extends KvTextBlock>(kvText: T[], role: string): T | undefined {
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
  await prepareMeasurement();

  const MIN_HEADLINE_PX = brand.rules?.floor("headline") ?? MIN_HEADLINE_PX_DEFAULT;
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
  let layoutOptions: FreeformConfig["layoutOptions"] = undefined;

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
  // The hero box (detected at import / set in the editor) is the authority
  // on what the crop must contain; fall back to the focal point.
  const heroCentre = (bg.focusBox ? bg.focusBox.y + bg.focusBox.h / 2 : (bg.focusY ?? 0.45)) * srcH;
  const srcYOffset = Math.min(
    Math.max(0, heroCentre - visibleRows / 2),
    Math.max(0, cleanH - visibleRows),
  );
  // Structured masters carry no focal point: the hero sits opposite the copy
  // column (copy right of centre => hero left, and vice versa).
  const liveHeadline = master.elements
    .filter((el): el is FreeformText => el.type === "text")
    .sort((a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0))[0];
  const inferredFocusX =
    bg.focusX ?? (liveHeadline ? ((liveHeadline.x + liveHeadline.w / 2) / srcW > 0.5 ? 0.28 : 0.72) : 0.5);
  // Horizontal window: centre on the hero box (or focal point), clamped so
  // the artwork still covers the canvas.
  const visibleCols = dstW / s;
  const heroCentreX = (bg.focusBox ? bg.focusBox.x + bg.focusBox.w / 2 : inferredFocusX) * srcW;
  const srcXOffset = Math.min(Math.max(0, heroCentreX - visibleCols / 2), Math.max(0, srcW - visibleCols));
  const artX = -Math.round(srcXOffset * s);
  const artY = -Math.round(srcYOffset * s);

  // Flat artwork carries its copy in the pixels: there is nothing to re-set,
  // so a crop at a materially different shape would slice through the
  // headline. Show the whole design instead, on a field sampled from its own
  // edges — the safe automated answer when the source has no structure.
  const hasResettableCopy =
    kvTextAll.length > 0 || master.elements.some((el) => el.type === "text");
  const shapeShift = Math.abs(Math.log(dstW / dstH / (srcW / srcH)));
  if (!hasResettableCopy && shapeShift > 0.22) {
    const fit = Math.min(dstW / srcW, dstH / srcH);
    const fitW = Math.round(srcW * fit);
    const fitH = Math.round(srcH * fit);
    const field = (bg.src ? await sampleEdgeColor(bg.src, srcW, srcH) : null) ?? "#11263d";
    elements.push({
      id: "kv_field",
      type: "rect",
      fill: field,
      x: 0,
      y: 0,
      w: dstW,
      h: dstH,
      locked: true,
    } as FreeformElement);
    elements.push({
      ...bg,
      id: "kv_background",
      x: Math.round((dstW - fitW) / 2),
      y: Math.round((dstH - fitH) / 2),
      w: fitW,
      h: fitH,
      fit: "contain",
      locked: true,
    });
    return {
      kind: "freeform",
      elements,
      ...(layoutOptions ? { layoutOptions } : {}),
    };
  }

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
  // Copy blocks come from kvText metadata (flat-PDF masters) or, for
  // structured masters (IDML import), from the master's own live text
  // elements — carrying their real fonts, weights and alignment.
  type Block = KvTextBlock & { fontFamily?: string; fontWeight?: number; align?: string };
  const liveText: Block[] = master.elements
    .filter((el): el is FreeformText => el.type === "text")
    .map((el) => ({
      text: el.text,
      x: el.x,
      y: el.y,
      w: el.w,
      h: el.h,
      fontSize: el.fontSize ?? 16,
      ...(el.color ? { color: el.color } : {}),
      ...(el.role ? { role: el.role } : {}),
      ...(el.fontFamily ? { fontFamily: el.fontFamily } : {}),
      ...(el.fontWeight ? { fontWeight: el.fontWeight } : {}),
      ...(el.align ? { align: el.align } : {}),
    }));
  const kvText: Block[] = bg.kvText && bg.kvText.length > 0 ? bg.kvText : liveText;
  const bySize = (a: Block, b: Block) => b.fontSize - a.fontSize;
  const headline = pickBlock(kvText, "headline") ?? kvText.slice().sort(bySize)[0];
  const subhead =
    pickBlock(kvText, "subhead") ?? (headline ? kvText.filter((b) => b !== headline).sort(bySize)[0] : undefined);
  const srcShort = Math.min(srcW, srcH);
  // Where the designer put the copy column (fraction of width).
  const headlineXFrac = headline ? headline.x / srcW : 0;

  // The master's call-to-action (pill or button with its label) travels with
  // the copy: sized by its share of the master's short side, never under
  // 24px, wide enough for its label. Strips carry it at the right of the
  // row; every other shape stacks it under the copy.
  const sem = inferSlots(master, srcW, srcH);
  const ctaSrc = sem.cta && sem.ctaLabel ? sem.cta : null;
  const ctaPlan = ctaSrc && sem.ctaLabel
    ? (() => {
        // The pill is sized from its measured label at the master's own
        // label-to-pill ratio (lib/ctaPlan.ts) — no character-count estimate.
        const labelEl = sem.ctaLabel!;
        const spec: FontSpec = { family: labelEl.fontFamily, weight: labelEl.fontWeight === 700 ? 700 : 400, letterSpacing: labelEl.letterSpacing };
        const p = planCta({
          label: labelEl.text,
          spec,
          master: { ctaH: ctaSrc.h, ctaW: ctaSrc.w, labelFontSize: labelEl.fontSize, labelText: labelEl.text, labelSpec: spec, hasIcon: !!sem.ctaIcon },
          targetH: (ctaSrc.h / srcShort) * short,
          minH: brand.rules?.floor("cta") ?? 24,
          maxH: Math.max(brand.rules?.floor("cta") ?? 24, short * 0.16),
          maxW: dstW - margin * 2,
          icon: false,
          allowTwoLines: dstW < 200,
        });
        const pill = ctaSrc.type === "rect" && (ctaSrc.radius ?? 0) >= ctaSrc.h / 2 - 1;
        return { label: p.lines.join("\n"), lines: p.lines.length, h: p.h, w: p.w, fs: p.fontSize, padX: p.padX, pill, fill: ctaSrc.type === "rect" ? ctaSrc.fill : "#ffffff", color: labelEl.color ?? "#11263d", fontFamily: labelEl.fontFamily, fontWeight: labelEl.fontWeight ?? 700 };
      })()
    : null;
  const subLine = !isStrip && sem.subheadline && sem.subheadline.text.trim() ? sem.subheadline : null;

  // A translucent/gradient panel behind the copy in the master (a scrim) is
  // part of the design's readability system — carry it into every output.
  const masterScrim = headline
    ? master.elements.find(
        (el): el is FreeformRect =>
          el.type === "rect" &&
          ((el as FreeformRect).gradient !== undefined || ((el as FreeformRect).opacity ?? 1) < 1) &&
          el.x < headline.x + headline.w &&
          el.x + el.w > headline.x &&
          el.y < headline.y + headline.h &&
          el.y + el.h > headline.y,
      )
    : undefined;

  // Type scale as designed: headline px relative to the master's short axis.
  const headlineRatio = headline ? headline.fontSize / srcShort : 0.05;
  const subheadRatio = subhead ? subhead.fontSize / srcShort : headlineRatio * 0.5;
  // Where the designer put the copy (fraction of canvas height), and how wide.
  const headlineCentreYFrac = headline ? (headline.y + headline.h / 2) / srcH : 0.72;
  const headlineWidthFrac = headline ? Math.min(1, headline.w / srcW) : 0.86;
  // Alignment as designed: a block whose centre sits mid-canvas is centred.
  // The designer's alignment when the master carries it; a full-width block
  // whose centre happens to sit mid-canvas is not "centred" if it is set left.
  const headlineCentred = headline
    ? headline.align
      ? headline.align === "center"
      : Math.abs((headline.x + headline.w / 2) / srcW - 0.5) < 0.08
    : true;

  const longestLineChars = (text: string) =>
    Math.max(...text.split("\n").map((l) => l.trim().length), 1);
  // Lines the copy will actually occupy once wrapped into a box of width w
  // (avg glyph ≈ 0.58em for National 2 Bold), so boxes snap to the copy's end.
  // Copy boxes hug their words: after wrapping, shrink the box to the widest
  // actual line (keeping alignment anchored) instead of leaving zone-wide
  // boxes around short copy. Boxes stay full-size only when the text needs it.
  // Copy is measured with the real face (the same measurement the renderer
  // and the layout check use), so boxes, wraps and stacking match what is
  // drawn — an estimate here is what let a sub-line run into the button.
  const specOf = (family?: string, weight?: number): FontSpec => ({ family, weight: weight === 700 ? 700 : 400 });
  const hlSpec = specOf(headline?.fontFamily, headline?.fontWeight ?? 700);
  const fitTextBox = (el: { text: string; x: number; y: number; w: number; fontSize: number; align: string }, spec: FontSpec = hlSpec) => {
    const lines = el.text.split("\n").flatMap((l) => wrapText(l, el.w, spec, el.fontSize));
    if (lines.length === 0) return;
    const widest = Math.max(...lines.map((l) => measureLine(l, spec, el.fontSize)), 0);
    const fitted = Math.min(el.w, Math.ceil(widest) + Math.ceil(el.fontSize * 0.3));
    if (fitted >= el.w) return;
    if (el.align === "center") el.x += Math.round((el.w - fitted) / 2);
    else if (el.align === "right") el.x += el.w - fitted;
    el.w = fitted;
  };

  const wrappedLines = (text: string, fontSize: number, w: number, spec: FontSpec = hlSpec) =>
    text.split("\n").reduce((n, line) => n + Math.max(1, wrapText(line, Math.max(1, w), spec, fontSize).length), 0);
  const boxHeight = (text: string, fontSize: number, w: number, lineHeight: number, spec: FontSpec = hlSpec) =>
    Math.round(wrappedLines(text, fontSize, w, spec) * fontSize * lineHeight + fontSize * 0.25);

  // 2. Strapline re-set whole on the bottom margin (never cropped). Sized by
  //    the master's own subhead scale when it carried one.
  let straplineTopY = dstH;
  if (showStrapline) {
    const lines = (brand.strapline as string).split("\n").filter(Boolean).slice(0, 2);
    const fontSize = Math.max(10, Math.round(subheadRatio * short));
    const wStrap = Math.max(40, dstW - (showLogo ? tile + margin : 0) - margin * 2);
    const estH = boxHeight(lines.join("\n"), fontSize, wStrap, 1.3);
    straplineTopY = dstH - margin - estH;
    const strapBox = { text: lines.join("\n"), x: margin, y: straplineTopY, w: wStrap, fontSize, align: "left" };
    fitTextBox(strapBox);
    elements.push({
      id: "kv_strapline",
      type: "text",
      role: "other",
      text: lines.join("\n"),
      x: strapBox.x,
      y: straplineTopY,
      w: strapBox.w,
      h: estH,
      fontSize,
      fontWeight: subhead?.fontWeight ?? 700,
      color: subhead?.color ?? "#ffffff",
      align: "left",
      lineHeight: 1.3,
      ...(subhead?.fontFamily ? { fontFamily: subhead.fontFamily } : {}),
      locked: true,
    } as FreeformElement);
  }

  // 3. Headline placement — decided from the artwork, the way a designer
  //    decides: candidate zones around the hero (right / left / below /
  //    above), the designer's own column, and the bottom band are each sized
  //    for the copy, then scored on collision with the subject, busyness and
  //    tone of the pixels behind the type, and achievable type size. The
  //    best zone wins; runners-up are kept as selectable layout options.
  if (headline) {
    const text = isStrip ? headline.text.replace(/\n+/g, " ") : headline.text;
    const lines = text.split("\n").length;
    const designSize = headlineRatio * short;
    const tileReserve = (showLogo ? tile + margin : 0) + (isStrip && ctaPlan ? ctaPlan.w + margin : 0);
    // Room the sub-line and the stacked CTA will need under the headline.
    const subSize = subLine ? Math.max(10, Math.round((subLine.fontSize / srcShort) * short)) : 0;
    const subSpec = subLine ? specOf(subLine.fontFamily, subLine.fontWeight ?? 400) : hlSpec;
    const subReserve = subLine ? boxHeight(subLine.text, subSize, Math.round(dstW * 0.8), 1.25, subSpec) + Math.round(margin / 2) : 0;
    const ctaReserve = ctaPlan && !isStrip ? ctaPlan.h + margin : 0;
    // Strips carry the tile at full height on the RIGHT (reserved
    // horizontally via tileReserve), so it must not also eat the row's
    // height — that used to push bottomLimit negative and clamp every
    // strip headline to the floor size.
    const bottomLimit = (showStrapline ? straplineTopY - margin : dstH - (showLogo && !isStrip ? tile : margin) - margin) - subReserve - ctaReserve;

    // Hero box projected into the output canvas (art placement known).
    const fb = bg.focusBox ?? { x: Math.max(0, inferredFocusX - 0.25), y: 0.15, w: 0.5, h: 0.7 };
    const hero = {
      x: artX + fb.x * artW,
      y: artY + fb.y * artH,
      w: fb.w * artW,
      h: fb.h * artH,
    };
    const heroRight = hero.x + hero.w;
    const heroBottom = hero.y + hero.h;
    const designerSide: "left" | "right" | "below" | "centre" =
      headlineCentred ? "centre" : headlineXFrac > 0.5 ? "right" : headlineCentreYFrac > 0.6 ? "below" : "left";

    type Candidate = { label: string; x: number; y: number; w: number; h: number; fontSize: number; align: "left" | "center" | "right"; color: string; score: number; zone: string };
    const fitFont = (w: number, hAvail: number) => {
      const longest = Math.max(...text.split("\n").map((l) => measureLine(l.trim(), hlSpec, 100)), 1) / 100; // px per font-px
      const fitToWidth = w / Math.max(0.1, longest);
      const fitToHeight = hAvail / (lines * 1.3);
      const fitCap = Math.min(fitToWidth, fitToHeight);
      // Type fills its zone: grow to the master's own share of the canvas
      // height (never past what fits), instead of capping at the master's
      // font-to-short-axis ratio, which left headlines small on tall or
      // large canvases.
      const shareSize = headline ? ((headline.h / srcH) * dstH) / (lines * 1.3) : designSize;
      const target = Math.max(designSize, shareSize);
      return Math.round(Math.max(MIN_HEADLINE_PX, Math.min(fitCap, isStrip || isWide ? Math.max(target, fitCap * 0.8) : target)));
    };
    const mk = (label: string, zone: string, zx: number, zy: number, zw: number, zh: number, align: "left" | "center" | "right"): Candidate | null => {
      zx = Math.max(margin, zx);
      zy = Math.max(margin, zy);
      zw = Math.min(zw, dstW - margin - zx);
      zh = Math.min(zh, bottomLimit - zy);
      if (zw < dstW * 0.26 || zh < MIN_HEADLINE_PX * 2.6) return null;
      const fontSize = fitFont(zw, zh);
      const h = boxHeight(text, fontSize, zw, 1.25);
      if (h > zh + fontSize * 0.6) return null; // copy would not fit the zone
      return { label, zone, x: Math.round(zx), y: Math.round(zy), w: Math.round(zw), h, fontSize, align, color: headline.color ?? "#ffffff", score: 0 };
    };

    const candidates: Candidate[] = [];
    // Right of the hero, vertically centred on it.
    {
      const zx = heroRight + margin;
      const zw = dstW - zx - margin - tileReserve;
      const c = mk("Copy right of hero", "right", zx, hero.y, zw, Math.max(0, Math.min(heroBottom, bottomLimit) - hero.y), "left");
      if (c) { c.y = Math.max(margin, Math.min(Math.round(hero.y + hero.h / 2 - c.h / 2), bottomLimit - c.h)); candidates.push(c); }
    }
    // Left of the hero.
    {
      const zw = hero.x - margin * 2;
      const c = mk("Copy left of hero", "left", margin, hero.y, zw, Math.max(0, Math.min(heroBottom, bottomLimit) - hero.y), "left");
      if (c) { c.y = Math.max(margin, Math.min(Math.round(hero.y + hero.h / 2 - c.h / 2), bottomLimit - c.h)); candidates.push(c); }
    }
    // Below the hero, full width.
    {
      const zy = heroBottom + margin;
      const c = mk("Copy below hero", "below", margin, zy, dstW - margin * 2 - (isStrip || isWide ? tileReserve : 0), bottomLimit - zy, headlineCentred ? "center" : "left");
      if (c) candidates.push(c);
    }
    // Above the hero, full width.
    {
      const c = mk("Copy above hero", "above", margin, margin, dstW - margin * 2 - (isStrip || isWide ? tileReserve : 0), hero.y - margin * 2, headlineCentred ? "center" : "left");
      if (c) candidates.push(c);
    }
    // The designer's own column / height fraction (their intent as a prior).
    {
      const w = Math.max(40, Math.min(dstW - margin * 2 - tileReserve, Math.round(headlineWidthFrac * dstW)));
      const x = headlineCentred ? Math.round((dstW - w) / 2) : Math.min(Math.max(margin, Math.round(headlineXFrac * dstW)), dstW - margin - w);
      const fontSize = fitFont(w, dstH - margin * 2);
      const h = boxHeight(text, fontSize, w, 1.25);
      const y = Math.min(Math.max(margin, Math.round(headlineCentreYFrac * dstH - h / 2)), Math.max(margin, bottomLimit - h));
      candidates.push({ label: "Designer's position", zone: "designer", x, y, w, h, fontSize, align: headlineCentred ? "center" : "left", color: headline.color ?? "#ffffff", score: 0 });
    }
    // Bottom band, full width (the universal fallback).
    {
      const w = dstW - margin * 2 - (isStrip || isWide ? tileReserve : 0);
      const fontSize = fitFont(w, dstH - margin * 2);
      const h = boxHeight(text, fontSize, w, 1.25);
      candidates.push({ label: "Bottom band", zone: "bottom", x: margin, y: Math.max(margin, bottomLimit - h), w, h, fontSize, align: headlineCentred ? "center" : "left", color: headline.color ?? "#ffffff", score: 0 });
    }

    // Score: readable size, no collision with the subject, calm and dark
    // pixels behind white type, the designer's side as a tie-breaker.
    const overlap = (c: Candidate) => {
      const ix = Math.max(0, Math.min(c.x + c.w, heroRight) - Math.max(c.x, hero.x));
      const iy = Math.max(0, Math.min(c.y + c.h, heroBottom) - Math.max(c.y, hero.y));
      return (ix * iy) / Math.max(1, c.w * c.h);
    };
    const art = { x: artX, y: artY, w: artW, h: artH };
    for (const c of candidates) {
      const stats = bg.src ? await sampleRegionStats(bg.src, srcW, srcH, art, c) : null;
      const sizeScore = 100 * Math.min(1, c.fontSize / Math.max(MIN_HEADLINE_PX, designSize));
      const collision = 220 * overlap(c);
      const busy = stats ? Math.min(60, stats.busy * 0.9) : 0;
      const tone = stats && stats.lum > SCRIM_LUMINANCE_THRESHOLD ? Math.min(50, (stats.lum - SCRIM_LUMINANCE_THRESHOLD) * 0.6) : 0;
      const prior = c.zone === designerSide || (c.zone === "designer" && designerSide !== "centre") ? 18 : 0;
      c.score = sizeScore - collision - busy - tone + prior;
      // Very bright, calm zones take Ocean type instead of a scrim.
      if (stats && stats.lum > 190 && stats.busy < 22) c.color = "#11263d";
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const hlBox = { text, x: best.x, y: best.y, w: best.w, fontSize: best.fontSize, align: best.align };
    fitTextBox(hlBox);
    const x = hlBox.x, y = best.y, w = hlBox.w, estH = best.h, fontSize = best.fontSize;

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
      fontWeight: headline.fontWeight ?? 700,
      color: best.color,
      align: best.align,
      lineHeight: 1.25,
      ...(headline.fontFamily ? { fontFamily: headline.fontFamily } : {}),
    } as FreeformElement);

    // Sub-line directly under the headline, same column and alignment.
    let copyBottom = y + estH;
    if (subLine) {
      const sh = boxHeight(subLine.text, subSize, w, 1.25, subSpec);
      elements.push({
        id: "kv_subhead", type: "text", role: "subhead", slot: "subheadline", text: subLine.text,
        x, y: copyBottom + Math.round(margin / 2), w, h: sh, fontSize: subSize,
        fontWeight: subLine.fontWeight ?? 400, color: subLine.color ?? best.color, align: best.align, lineHeight: 1.25,
        ...(subLine.fontFamily ? { fontFamily: subLine.fontFamily } : {}),
      } as FreeformElement);
      copyBottom += Math.round(margin / 2) + sh;
    }
    // Call-to-action: under the copy, aligned with it; on a strip at the
    // right of the row before the tile, vertically centred.
    if (ctaPlan) {
      const cx = isStrip
        ? dstW - margin - (showLogo ? tile + margin : 0) - ctaPlan.w
        : best.align === "center" ? Math.round(x + (w - ctaPlan.w) / 2) : best.align === "right" ? x + w - ctaPlan.w : x;
      const cy = isStrip ? Math.round((dstH - ctaPlan.h) / 2) : Math.min(copyBottom + margin, dstH - margin - ctaPlan.h);
      elements.push({ id: "kv_cta", type: "rect", slot: "cta", fill: ctaPlan.fill, x: cx, y: cy, w: ctaPlan.w, h: ctaPlan.h, radius: ctaPlan.pill ? ctaPlan.h / 2 : Math.round(ctaPlan.h * 0.12), locked: true } as FreeformElement);
      elements.push({
        id: "kv_cta_label", type: "text", role: "cta", slot: "ctaLabel", text: ctaPlan.label,
        x: cx + ctaPlan.padX, y: cy, w: ctaPlan.w - ctaPlan.padX * 2, h: ctaPlan.h, fontSize: ctaPlan.fs,
        fontWeight: ctaPlan.fontWeight, color: ctaPlan.color, align: "center", lineHeight: ctaPlan.lines > 1 ? 1.15 : ctaPlan.h / ctaPlan.fs,
        ...(ctaPlan.fontFamily ? { fontFamily: ctaPlan.fontFamily } : {}), locked: true,
      } as FreeformElement);
      if (!isStrip) copyBottom = cy + ctaPlan.h;
    }

    // Keep the runners-up as selectable layout options (distinct positions).
    const seen = new Set<string>();
    layoutOptions = candidates
      .filter((c) => { const k = `${Math.round(c.x / 20)}:${Math.round(c.y / 20)}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 4)
      .map((c) => ({ label: c.label, x: c.x, y: c.y, w: c.w, h: c.h, fontSize: c.fontSize, align: c.align, color: c.color, score: Math.round(c.score) }));

    // Carry the master's scrim behind the copy, oriented to where the copy
    // landed: a column fade for side placements, a band fade for top/bottom.
    if (masterScrim) {
      const strength = masterScrim.gradient
        ? Math.max(...masterScrim.gradient.stops.map((s) => s.alpha))
        : (masterScrim.opacity ?? 0.65);
      const color = masterScrim.fill;
      // A solid (flat-opacity) scrim in the master is reproduced solid at the
      // same opacity behind the whole copy block; a gradient scrim fades
      // the same way it did. Copy then reads as it does on the master.
      const solid = !masterScrim.gradient;
      const mkScrim = (geom: { x: number; y: number; w: number; h: number }, angle: number): FreeformElement =>
        solid
          ? ({ id: "kv_scrim", type: "rect", fill: color, ...geom, opacity: strength, locked: true } as FreeformElement)
          : ({ id: "kv_scrim", type: "rect", fill: color, ...geom, gradient: { angle, stops: [{ color, alpha: strength, at: 0.45 }, { color, alpha: 0, at: 1 }] }, locked: true } as FreeformElement);
      const zone = best.zone === "designer" ? designerSide : best.zone;
      let scrim: FreeformElement;
      if (solid) {
        const top = Math.max(0, y - margin), bottom = Math.min(dstH, copyBottom + margin);
        scrim = zone === "above" || zone === "below" || zone === "bottom" || zone === "centre"
          ? mkScrim({ x: 0, y: zone === "above" ? 0 : top, w: dstW, h: (zone === "above" ? bottom : bottom - top) }, 0)
          : mkScrim({ x: Math.max(0, x - margin), y: top, w: Math.min(dstW, w + margin * 2), h: bottom - top }, 0);
      } else if (zone === "right") scrim = mkScrim({ x: Math.max(0, x - margin * 3), y: 0, w: dstW - Math.max(0, x - margin * 3), h: dstH }, 270);
      else if (zone === "left") scrim = mkScrim({ x: 0, y: 0, w: Math.min(dstW, x + w + margin * 3), h: dstH }, 90);
      else if (zone === "above") scrim = mkScrim({ x: 0, y: 0, w: dstW, h: Math.min(dstH, copyBottom + margin * 3) }, 180);
      else scrim = mkScrim({ x: 0, y: Math.max(0, y - margin * 3), w: dstW, h: dstH - Math.max(0, y - margin * 3) }, 0);
      elements.splice(1, 0, scrim); // directly above the artwork, below copy
    }
  }
  // 4. Pōhutukawa tile: placed by the shared guideline rules (flush
  //    bottom-right, 1/8 inset, full-height on strips, none on social).
  if (showLogo) {
    const placement = guidelineLogoPlacement(dstW, dstH);
    if (placement) {
      // The logo asset is the master tile itself — drawn as-is.
      elements.push({
        id: "kv_logo",
        type: "image",
        role: "logo",
        src: brand.logoUrl,
        fit: "contain",
        ...placement.tile,
        locked: true,
      } as FreeformElement);
    }
  }

  // 5. Readability (guidelines: backgrounds behind copy get a colour/opacity
  //    effect and must pass contrast). Sample the actual artwork behind each
  //    copy block; where white type would fail, slide an Ocean panel between
  //    artwork and type. The artwork itself stays untouched underneath.
  if (bg.src) {
    const art = { x: artX, y: artY, w: artW, h: artH };
    const carried = elements.find((el) => el.id === "kv_scrim");
    const covered = (el: { x: number; y: number; w: number; h: number }) =>
      !!carried && el.x >= carried.x - 1 && el.y >= carried.y - 1 && el.x + el.w <= carried.x + carried.w + 1 && el.y + el.h <= carried.y + carried.h + 1;
    const copyElements = elements.filter(
      (el): el is FreeformElement & { type: "text" } =>
        el.type === "text" && (el.id === "kv_headline" || el.id === "kv_subhead" || el.id === "kv_strapline") && !covered(el),
    );
    const scrims: FreeformElement[] = [];
    for (const el of copyElements) {
      // White type needs 4.5:1 (3:1 at display sizes) against the ground.
      const stats = await sampleRegionStats(bg.src, srcW, srcH, art, el);
      const floor = (el as { fontSize?: number }).fontSize && (el as { fontSize: number }).fontSize >= 18 ? 3 : 4.5;
      if (stats && stats.whiteContrast < floor) {
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

  return { kind: "freeform", elements, ...(layoutOptions && layoutOptions.length > 1 ? { layoutOptions } : {}) };
}
