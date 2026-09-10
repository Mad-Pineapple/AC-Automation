/**
 * Layered image artwork: HTML5 (Google Web Designer) exports and similar
 * imports arrive as a stack of image layers and nothing else — the headline
 * is a run of glyph images, the sub-head and the CTA are pictures of text.
 * Without live text the studio would call that "flat" and refuse to build
 * other shapes. This module gives such a stack meaning and a way to adapt:
 *
 *  1. inferImageSlots — recognise layers by shape and position (photo,
 *     scrim, headline glyph run, sub-headline, cut-out, panel, CTA, logo);
 *  2. mergeGlyphRun — composite a glyph run into ONE headline image so it
 *     moves and scales as a unit;
 *  3. adaptLayered — place the slotted layers on a new canvas using the
 *     format recipe: photo covers its zone, the copy group is fitted into the
 *     photo zone's copy box, the panel group is fitted into the panel zone,
 *     the CTA is held at its legibility floor.
 *
 * Claude's check-and-fix then polishes each result against the studio's
 * Right pieces for that shape.
 */
import sharp from "sharp";
import type { FreeformConfig, FreeformElement, FreeformImage } from "./freeform";
import { classifyAspect } from "./formatCatalog";
import { RECIPES } from "./recipes";
import { guidelineLogoPlacement } from "./logoRules";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";
import type { StyleSchema } from "./styleSpecs/getReadyBurst2";

type Slot = NonNullable<FreeformElement["slot"]>;
type Img = FreeformImage;
interface Box { x: number; y: number; w: number; h: number }

const area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);
const overlap = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy;
};
const r = Math.round;

/** True when the artwork is image layers only (no live text, no rects). */
export function isImageOnly(config: FreeformConfig): boolean {
  return config.elements.length >= 3 && config.elements.every((e) => e.type === "image");
}

/** True once image layers carry composition slots (headline at least). */
export function hasLayeredSlots(config: FreeformConfig): boolean {
  return config.elements.some((e) => e.type === "image" && (e.slot === "headline" || e.slot === "cta"));
}

export interface SlotInference {
  config: FreeformConfig;
  /** Element ids that form the headline glyph run (to be merged). */
  glyphRun: string[];
  notes: string[];
}

/**
 * Recognise what each image layer is. Conservative: a layer that fits no
 * rule stays "other" (decoration) and is carried along unchanged.
 */
export function inferImageSlots(config: FreeformConfig, W: number, H: number): SlotInference {
  const notes: string[] = [];
  const elements = config.elements.map((e) => ({ ...e })) as FreeformElement[];
  const images = elements.filter((e): e is Img => e.type === "image");
  const canvas = W * H;
  const taken = new Set<string>();
  const free = (i: Img) => !taken.has(i.id) && !i.slot;
  const set = (i: Img, slot: Slot) => { i.slot = slot; taken.add(i.id); };

  // 1. Photo: the largest layer covering at least 40% of the canvas.
  const photo = images.filter(free).filter((i) => overlap(i, { x: 0, y: 0, w: W, h: H }) >= canvas * 0.4).sort((a, b) => area(b) - area(a))[0] ?? null;
  if (photo) set(photo, "photo");
  const photoBox: Box | null = photo ? { x: Math.max(0, photo.x), y: Math.max(0, photo.y), w: Math.min(W, photo.x + photo.w) - Math.max(0, photo.x), h: Math.min(H, photo.y + photo.h) - Math.max(0, photo.y) } : null;

  // 2. Logo: a small near-square layer that a brand mark would be.
  const logo = images.filter(free).filter((i) => i.role === "logo" || (Math.abs(i.w / Math.max(1, i.h) - 1) < 0.25 && area(i) < canvas * 0.06 && area(i) > canvas * 0.004)).sort((a, b) => (a.role === "logo" ? -1 : 1) - (b.role === "logo" ? -1 : 1) || area(b) - area(a))[0] ?? null;
  if (logo) set(logo, "logo");

  // 3. Panel: a full-width layer in the lower part of the canvas (tall
  //    formats) or a full-height layer at the right (wide formats).
  const panel = images.filter(free).filter((i) => (i.w >= W * 0.9 && i.h >= H * 0.18 && i.h <= H * 0.7 && i.y >= H * 0.3) || (i.h >= H * 0.9 && i.w >= W * 0.18 && i.w <= W * 0.7 && i.x >= W * 0.3)).sort((a, b) => area(b) - area(a))[0] ?? null;
  if (panel) set(panel, "panel");
  const panelBox: Box | null = panel ? { x: panel.x, y: panel.y, w: panel.w, h: panel.h } : null;

  // 4. Headline glyph run: three or more small layers of similar height whose
  //    vertical centres line up, read left to right.
  let glyphRun: string[] = [];
  // Glyphs are sized to the short side (38% of height on a 970×250), so cap on the short side, not the height.
  const small = images.filter(free).filter((i) => i.h <= Math.min(W, H) * 0.6 && i.h >= H * 0.03 && i.w <= W * 0.5 && !(panelBox && overlap(i, panelBox) > area(i) * 0.5));
  const byCentre = [...small].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  let best: Img[] = [];
  for (const seed of byCentre) {
    const cy = seed.y + seed.h / 2;
    const row = byCentre.filter((i) => Math.abs(i.y + i.h / 2 - cy) <= Math.max(seed.h, i.h) * 0.35 && i.h >= seed.h * 0.5 && i.h <= seed.h * 1.6);
    if (row.length >= 3 && row.length > best.length) best = row;
  }
  if (best.length >= 3) {
    best.sort((a, b) => a.x - b.x);
    // Break the row on a gap wider than two typical glyph widths.
    const widths = best.map((i) => i.w).sort((a, b) => a - b);
    const typical = widths[Math.floor(widths.length / 2)];
    const runs: Img[][] = [[best[0]]];
    for (let k = 1; k < best.length; k++) {
      const prev = best[k - 1];
      if (best[k].x - (prev.x + prev.w) > typical * 2) runs.push([best[k]]);
      else runs[runs.length - 1].push(best[k]);
    }
    const run = runs.sort((a, b) => b.length - a.length)[0];
    if (run.length >= 3) {
      glyphRun = run.map((i) => i.id);
      for (const i of run) set(i, "headline");
      notes.push(`Headline recognised as a run of ${run.length} glyph layers.`);
    }
  }
  // A single wide layer high in the artwork can be the headline when no run was found.
  if (glyphRun.length === 0) {
    const hl = images.filter(free).filter((i) => i.w / Math.max(1, i.h) >= 2.5 && i.h >= H * 0.05 && i.h <= H * 0.25 && i.y < H * 0.6 && !(panelBox && overlap(i, panelBox) > area(i) * 0.5)).sort((a, b) => area(b) - area(a))[0] ?? null;
    if (hl) { set(hl, "headline"); notes.push("Headline recognised as one image layer."); }
  }
  const headlineBox = (() => {
    const hs = images.filter((i) => i.slot === "headline");
    if (!hs.length) return null;
    const x0 = Math.min(...hs.map((i) => i.x)), y0 = Math.min(...hs.map((i) => i.y));
    return { x: x0, y: y0, w: Math.max(...hs.map((i) => i.x + i.w)) - x0, h: Math.max(...hs.map((i) => i.y + i.h)) - y0 };
  })();

  // 5. Sub-headline: a wide short layer just under the headline.
  if (headlineBox) {
    // A line of type: thin (no taller than 60% of the headline), wide (≥4:1),
    // and the nearest such layer below the headline — never the largest
    // layer, which on a wide banner is the car cut-out.
    const hx0 = headlineBox.x, hx1 = headlineBox.x + headlineBox.w;
    const sub = images.filter(free)
      .filter((i) => i.w / Math.max(1, i.h) >= 4 && i.h <= headlineBox.h * 0.6 && i.y >= headlineBox.y + headlineBox.h * 0.6 && i.y <= headlineBox.y + headlineBox.h * 2.2)
      // Under the headline means sharing its column: centre inside the
      // headline's x-range and not on the panel (where the pill lives).
      .filter((i) => i.x + i.w / 2 >= hx0 && i.x + i.w / 2 <= hx1 && !(panelBox && overlap(i, panelBox) > area(i) * 0.5))
      .sort((a, b) => a.y - b.y)[0] ?? null;
    if (sub) set(sub, "subheadline");
  }

  // 6. CTA: a button-shaped layer in the lower half, outside the headline.
  const cta = images.filter(free).filter((i) => {
    const a = i.w / Math.max(1, i.h);
    // The 181×43 display pill is 17% of a 970×250's height: cap on the short side.
    return a >= 2.2 && a <= 8 && i.h <= Math.min(W, H) * 0.2 && area(i) < canvas * 0.1 && i.y + i.h / 2 >= H * 0.45;
  }).sort((a, b) => area(b) - area(a))[0] ?? null;
  if (cta) set(cta, "cta");

  // 7. Scrim: a wide translucent-looking layer over the photo (not the photo).
  if (photoBox) {
    const scrim = images.filter(free).filter((i) => i.w >= W * 0.8 && i.h >= H * 0.12 && i.h <= H * 0.6 && overlap(i, photoBox) >= area(i) * 0.6).sort((a, b) => area(b) - area(a))[0] ?? null;
    if (scrim) set(scrim, "scrim");
    // 8. Cut-outs: mid-size layers on the photo.
    for (const i of images.filter(free)) {
      if (overlap(i, photoBox) >= area(i) * 0.6 && area(i) >= area(photoBox) * 0.03 && area(i) <= area(photoBox) * 0.6) set(i, "cutout");
    }
  }

  if (!photo) notes.push("No photo layer recognised.");
  if (!headlineBox) notes.push("No headline layer recognised.");
  return { config: { ...config, elements }, glyphRun, notes };
}

/** Median colour of an image's border pixels — the ground a baked panel graphic sits on. */
export async function edgeColour(bytes: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(bytes).resize(16, 16, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const px: number[][] = [];
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) {
        const i = (y * info.width + x) * 3;
        px.push([data[i], data[i + 1], data[i + 2]]);
      }
    }
    if (!px.length) return null;
    const med = (k: number) => px.map((p) => p[k]).sort((a, b) => a - b)[Math.floor(px.length / 2)];
    const hex = (v: number) => v.toString(16).padStart(2, "0");
    return `#${hex(med(0))}${hex(med(1))}${hex(med(2))}`;
  } catch {
    return null;
  }
}

export interface LayerIO {
  loadImage: (src: string) => Promise<Buffer | null>;
  uploadBytes: (bytes: Buffer, contentType: string) => Promise<string>;
}

/** Image loader that reads the studio's own storage directly (no request needed). */
export function storageImageLoader(): LayerIO["loadImage"] {
  const storage = new ObjectStorageService();
  return async (src: string) => {
    try {
      if (src.startsWith("/api/storage/objects/")) {
        const file = await storage.getObjectEntityFile(src.slice("/api/storage".length).split(/[?#]/)[0]);
        const res = await storage.downloadObject(file);
        return Buffer.from(await res.arrayBuffer());
      }
      if (/^https?:\/\//i.test(src)) {
        const res = await fetch(src);
        return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
      }
      return null;
    } catch {
      return null;
    }
  };
}

/**
 * Composite a glyph run into one transparent PNG at the run's bounding box,
 * upload it, and replace the run with a single headline image element.
 */
export async function mergeGlyphRun(config: FreeformConfig, ids: string[], io: LayerIO): Promise<FreeformConfig> {
  const run = config.elements.filter((e): e is Img => e.type === "image" && ids.includes(e.id));
  if (run.length < 2) return config;
  const x0 = Math.floor(Math.min(...run.map((i) => i.x)));
  const y0 = Math.floor(Math.min(...run.map((i) => i.y)));
  const x1 = Math.ceil(Math.max(...run.map((i) => i.x + i.w)));
  const y1 = Math.ceil(Math.max(...run.map((i) => i.y + i.h)));
  const scale = 2; // render the merged headline at 2x so it scales up cleanly
  const layers: sharp.OverlayOptions[] = [];
  for (const g of run) {
    if (!g.src) continue;
    const bytes = await io.loadImage(g.src);
    if (!bytes) continue;
    const resized = await sharp(bytes).resize(Math.max(1, r(g.w * scale)), Math.max(1, r(g.h * scale)), { fit: "fill" }).png().toBuffer();
    layers.push({ input: resized, left: r((g.x - x0) * scale), top: r((g.y - y0) * scale) });
  }
  if (!layers.length) return config;
  const merged = await sharp({ create: { width: Math.max(1, (x1 - x0) * scale), height: Math.max(1, (y1 - y0) * scale), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png()
    .toBuffer();
  const stored = await io.uploadBytes(merged, "image/png");
  const first = run[0];
  // The run's motion is what its container does (fly-in, scale); a single
  // glyph's own flicker is a cycling state and never the headline's motion.
  const runMotion = run.map((g) => g.groupMotion ?? g.motion).find(Boolean);
  const { motion: _m, groupMotion: _g, ownMotion: _o, ...firstRest } = first;
  // Each glyph keeps its own image and reveal as a part of the headline, so
  // the export can play a letter-by-letter entrance exactly as the original.
  const rd = (v: number) => Math.round(v * 10000) / 10000;
  const parts = runMotion
    ? run.filter((g) => g.src).map((g) => ({ src: g.src!, fx: rd((g.x - x0) / (x1 - x0)), fy: rd((g.y - y0) / (y1 - y0)), fw: rd(g.w / (x1 - x0)), fh: rd(g.h / (y1 - y0)), ...(g.ownMotion ? { motion: g.ownMotion } : {}) }))
    : [];
  const headline: Img = {
    ...firstRest,
    ...(runMotion ? { motion: { ...runMotion, w0: x1 - x0, h0: y1 - y0 } } : {}),
    ...(parts.some((p) => p.motion) ? { motionParts: parts } : {}),
    id: "layer_headline",
    slot: "headline",
    role: "decoration",
    src: `/api/storage${stored}`,
    fit: "contain",
    x: x0,
    y: y0,
    w: x1 - x0,
    h: y1 - y0,
  };
  const firstIdx = config.elements.findIndex((e) => e.id === first.id);
  const elements = config.elements.filter((e) => !ids.includes(e.id));
  elements.splice(Math.min(firstIdx, elements.length), 0, headline);
  return { ...config, elements };
}

export interface EnrichResult { config: FreeformConfig; changed: boolean; notes: string[] }

/** Slots + glyph merge for image-only artwork. Idempotent. */
export async function enrichLayeredArtwork(config: FreeformConfig, W: number, H: number, io: LayerIO): Promise<EnrichResult> {
  if (!isImageOnly(config) || hasLayeredSlots(config)) return { config, changed: false, notes: [] };
  const inferred = inferImageSlots(config, W, H);
  let next = inferred.config;
  if (inferred.glyphRun.length >= 2) {
    try {
      next = await mergeGlyphRun(next, inferred.glyphRun, io);
    } catch (err) {
      logger.warn({ err }, "layered artwork: glyph merge failed; keeping separate glyph layers");
    }
  }
  return { config: next, changed: hasLayeredSlots(next), notes: inferred.notes };
}

// ---------------------------------------------------------------------------
// Adapting slotted layers to a new canvas

export interface LayeredAdaptOptions {
  /** Solid fill behind the panel zone when the panel image doesn't cover it. */
  panelFill?: string | null;
  logoUrl?: string | null;
  /** Campaign style schema: its zones and part rules override the class recipe. */
  spec?: StyleSchema | null;
}

function fitInto(box: Box, aspect: number, maxScaleUp = 1.6, natural?: { w: number; h: number }): Box {
  let w = box.w, h = w / aspect;
  if (h > box.h) { h = box.h; w = h * aspect; }
  if (natural) {
    const cap = Math.min(w, natural.w * maxScaleUp);
    if (cap < w) { w = cap; h = w / aspect; }
  }
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/**
 * Place slotted image layers on a new canvas. Returns null when the master
 * carries no recognised headline (nothing to lay out).
 */
export function adaptLayered(master: FreeformConfig, srcW: number, srcH: number, dstW: number, dstH: number, opts: LayeredAdaptOptions = {}): { config: FreeformConfig; notes: string[] } | null {
  const imgs = master.elements.filter((e): e is Img => e.type === "image");
  const by = (slot: Slot) => imgs.filter((i) => i.slot === slot);
  const headlineParts = by("headline");
  if (!headlineParts.length) return null;
  const notes: string[] = [];
  const cls = classifyAspect(dstW, dstH);
  const base = RECIPES[cls];
  // The campaign schema, when one matches, is the standard: its zone shares
  // and CTA rule replace the class recipe's.
  const spec = opts.spec ?? null;
  const zone = spec?.zones[cls];
  const recipe = zone ? { ...base, axis: zone.axis === "row" ? ("row" as const) : zone.axis === "side" ? ("side" as const) : ("stacked" as const), photoFrac: zone.photoFrac, bandFrac: zone.bandFrac, bandAt: zone.bandAt } : base;
  const short = Math.min(dstW, dstH);
  const margin = r(short / 18);
  const isStrip = cls === "strip";
  if (spec) notes.push(`Laid out to the ${spec.name} schema.`);

  // Zones from the recipe axis.
  let photoZone: Box, panelZone: Box;
  if (recipe.axis === "stacked") {
    const ph = r(dstH * recipe.photoFrac);
    photoZone = { x: 0, y: 0, w: dstW, h: ph };
    panelZone = { x: 0, y: ph, w: dstW, h: dstH - ph };
  } else {
    const pw = r(dstW * recipe.photoFrac);
    photoZone = { x: 0, y: 0, w: pw, h: dstH };
    panelZone = { x: pw, y: 0, w: dstW - pw, h: dstH };
  }
  const tile = opts.logoUrl ? guidelineLogoPlacement(dstW, dstH) : null;
  if (tile && recipe.axis !== "stacked") panelZone = { ...panelZone, w: Math.max(40, tile.tile.x - panelZone.x - margin) };

  const out: FreeformElement[] = [];
  // Panel ground first, so a panel image that doesn't cover the zone still sits on brand colour.
  if (opts.panelFill) out.push({ id: "ly_panel_ground", type: "rect", slot: "panel", fill: opts.panelFill, x: panelZone.x, y: panelZone.y, w: panelZone.w, h: panelZone.h, locked: true } as FreeformElement);

  // Photo covers its zone.
  const photo = by("photo")[0];
  if (photo) out.push({ ...photo, id: "ly_photo", fit: "cover", x: photoZone.x, y: photoZone.y, w: photoZone.w, h: photoZone.h });

  // Cut-out first: it anchors to the bottom of the photo zone, and the copy
  // group takes the band above it (as in the master: headline over the car).
  // The anchoring cut-out is the largest one (the car), never a stray thin layer.
  const cutout = [...by("cutout")].sort((a, b) => area(b) - area(a))[0];
  let cutoutBox: Box | null = null;
  if (cutout && photo && !isStrip) {
    // The cut-out (the car) is a pop-out of the subject already in the photo,
    // so it must land exactly where the photo's own subject lands. The master's
    // photo layer is its image at natural aspect (the importer trims layers to
    // their asset), so map the cut-out through the photo's cover-fit into the
    // new zone. If it can't stay mostly inside the zone, drop it — the photo
    // shows the subject anyway, and two cars is the one thing we never ship.
    const photoAspect = photo.w / Math.max(1, photo.h);
    let rw = photoZone.w, rh = rw / photoAspect;
    if (rh < photoZone.h) { rh = photoZone.h; rw = rh * photoAspect; }
    const fx = typeof photo.focusX === "number" ? photo.focusX : 0.5;
    const fy = typeof photo.focusY === "number" ? photo.focusY : 0.5;
    const rx = photoZone.x - (rw - photoZone.w) * fx;
    const ry = photoZone.y - (rh - photoZone.h) * fy;
    const sx = rw / Math.max(1, photo.w), sy = rh / Math.max(1, photo.h);
    const box: Box = { x: rx + (cutout.x - photo.x) * sx, y: ry + (cutout.y - photo.y) * sy, w: cutout.w * sx, h: cutout.h * sy };
    const visible = overlap(box, photoZone) / Math.max(1, area(box));
    if (visible >= 0.6 && box.h <= photoZone.h * 0.6) {
      cutoutBox = { x: r(box.x), y: r(box.y), w: r(box.w), h: r(box.h) };
    } else {
      notes.push("Cut-out dropped: at this crop it would not sit over the photo's own subject.");
    }
  } else if (cutout) notes.push("Cut-out dropped: strips carry photo, headline, CTA and logo only.");

  // Copy group: headline (+ sub-headline) fitted into the band above the cut-out
  // (tall / side layouts) or beside the photo (strips).
  const hx0 = Math.min(...headlineParts.map((i) => i.x)), hy0 = Math.min(...headlineParts.map((i) => i.y));
  const hBox: Box = { x: hx0, y: hy0, w: Math.max(...headlineParts.map((i) => i.x + i.w)) - hx0, h: Math.max(...headlineParts.map((i) => i.y + i.h)) - hy0 };
  const sub = by("subheadline")[0];
  const groupH = sub ? Math.max(hBox.y + hBox.h, sub.y + sub.h) - hBox.y : hBox.h;
  const groupW = Math.max(hBox.w, sub ? sub.x + sub.w - hBox.x : 0);
  const rowLike = isStrip || recipe.axis === "row";
  const copyBand: Box = rowLike
    ? { x: panelZone.x + margin, y: panelZone.y + margin, w: r(panelZone.w * 0.55), h: panelZone.h - margin * 2 }
    : { x: photoZone.x + margin, y: photoZone.y + margin, w: photoZone.w - margin * 2, h: (cutoutBox ? cutoutBox.y : photoZone.y + photoZone.h) - photoZone.y - margin * 2 };
  const target = fitInto({ ...copyBand, w: r(copyBand.w * (rowLike ? 1 : recipe.headlineWidthFrac)), h: rowLike ? copyBand.h : r(Math.min(copyBand.h, photoZone.h * recipe.headlineMaxHeightFrac * 1.5)) }, groupW / Math.max(1, groupH), 2.2);
  let s = target.w / Math.max(1, groupW);
  // Schema: a display glyph headline is 19% of the short side tall; never
  // let the run grow past that, however wide the zone is.
  const specHeadline = spec?.parts.headline;
  if (specHeadline && !rowLike) {
    // Display shares: 19% of the short side on stacked layouts, 38% on side
    // layouts (the 970×250 glyph run). OOH masters carry the type live, so
    // this only governs picture headlines.
    const share = recipe.axis === "stacked" ? specHeadline.display?.stacked ?? 0.19 : specHeadline.display?.side ?? 0.38;
    const capH = short * share;
    if (hBox.h * s > capH) s = capH / Math.max(1, hBox.h);
  }
  const gx = rowLike ? copyBand.x : r(copyBand.x + (copyBand.w - groupW * s) / 2);
  // Block centre at the schema anchor (45% of the photo zone on tall, 36% of
  // height on wide), kept inside the band above the cut-out.
  let gy = r(copyBand.y + (copyBand.h - groupH * s) / 2);
  if (!rowLike && cutoutBox) {
    // With a cut-out the copy block sits directly on top of it (as in the
    // master: sub-line touching the car), never floating in the band above.
    gy = r(Math.max(copyBand.y, cutoutBox.y - margin / 2 - groupH * s));
  } else if (specHeadline && !rowLike) {
    const anchor = recipe.axis === "stacked" ? photoZone.y + photoZone.h * (specHeadline.anchor.y ?? 0.45) : dstH * 0.36;
    gy = r(Math.max(copyBand.y, Math.min(copyBand.y + copyBand.h - groupH * s, anchor - (groupH * s) / 2)));
  }
  const scrim = by("scrim")[0];
  if (scrim && photo) out.push({ ...scrim, id: "ly_scrim", fit: "fill" as "cover", x: photoZone.x, y: photoZone.y, w: photoZone.w, h: r(Math.max(gy + groupH * s + margin, photoZone.h * 0.35) - photoZone.y) });
  for (const [k, part] of headlineParts.entries()) {
    out.push({ ...part, id: headlineParts.length === 1 ? "ly_headline" : `ly_headline_${k}`, fit: "contain", x: r(gx + (part.x - hBox.x) * s), y: r(gy + (part.y - hBox.y) * s), w: r(part.w * s), h: r(part.h * s) });
  }
  if (sub) out.push({ ...sub, id: "ly_subheadline", fit: "contain", x: r(gx + (sub.x - hBox.x) * s), y: r(gy + (sub.y - hBox.y) * s), w: r(sub.w * s), h: r(sub.h * s) });
  if (cutout && cutoutBox) out.push({ ...cutout, id: "ly_cutout", fit: "contain", ...cutoutBox });

  // Panel group: panel image (baked message/lockup) fitted into the panel zone, CTA held at its floor.
  const panelImg = by("panel")[0];
  const cta = by("cta")[0];
  const panelInner: Box = { x: panelZone.x + margin, y: panelZone.y + margin, w: panelZone.w - margin * 2, h: panelZone.h - margin * 2 };
  // A baked panel graphic that would render below half its native size is
  // illegible — drop it and let the CTA sit on the brand ground instead.
  const panelFit = panelImg && !isStrip ? fitInto(panelInner, panelImg.w / Math.max(1, panelImg.h), 1.4) : null;
  const keepPanelImg = !!(panelImg && panelFit && panelFit.h >= panelImg.h * 0.5);
  if (panelImg && !isStrip && !keepPanelImg) notes.push("Panel graphic dropped: it would render too small to read at this size; the CTA sits on the brand panel.");
  if (panelImg && keepPanelImg && panelFit) {
    // The graphic fills the zone's width edge to edge (its ground colour
    // matches the panel ground, so the join is invisible), scaled down only
    // when it would be taller than the zone; anchored to the bottom where the
    // lockup lives.
    const aspect = panelImg.w / Math.max(1, panelImg.h);
    let pw = panelZone.w, ph = pw / aspect;
    if (ph > panelZone.h) { ph = panelZone.h; pw = ph * aspect; }
    const pb: Box = { x: panelZone.x + (panelZone.w - pw) / 2, y: 0, w: pw, h: ph };
    const y = panelZone.y + panelZone.h - pb.h;
    out.push({ ...panelImg, id: "ly_panel", fit: "contain", x: r(pb.x), y: r(y), w: r(pb.w), h: r(pb.h) });
    if (cta) {
      // Keep the CTA where it sat relative to the panel image. A display CTA
      // that is a fixed asset (181×43 in this campaign) is placed, not scaled.
      const ps = pb.w / Math.max(1, panelImg.w);
      const fixed = spec?.parts.cta?.fixedPx;
      const looksFixed = !!fixed && Math.abs(cta.h - fixed.h) <= 3 && Math.abs(cta.w - fixed.w) <= 6;
      // On display-sized canvases the pill is the fixed asset; on OOH sizes it
      // takes the campaign's share of the short side (7.5% tall / 12.5% wide).
      const isDisplayCanvas = short <= 400; // 300×600, 970×250, 300×250, 320×480 — not OOH-sized canvases
      const oohShare = recipe.axis === "stacked" ? 0.075 : 0.125;
      const ctaH = looksFixed && isDisplayCanvas ? fixed!.h : looksFixed ? r(short * oohShare) : Math.max(recipe.ctaFloorPx, r(cta.h * ps));
      const ctaW = looksFixed && isDisplayCanvas ? fixed!.w : r(ctaH * (cta.w / Math.max(1, cta.h)));
      const relX = (cta.x + cta.w / 2 - panelImg.x) / Math.max(1, panelImg.w);
      const relY = (cta.y + cta.h / 2 - panelImg.y) / Math.max(1, panelImg.h);
      out.push({ ...cta, id: "ly_cta", fit: "contain", x: r(pb.x + relX * pb.w - ctaW / 2), y: r(y + relY * pb.h - ctaH / 2), w: ctaW, h: ctaH });
    }
  } else {
    if (panelImg && isStrip) notes.push("Panel graphic dropped for the strip; the CTA sits on the brand panel.");
    if (cta) {
      const fixed = spec?.parts.cta?.fixedPx;
      const looksFixed = !!fixed && Math.abs(cta.h - fixed.h) <= 3 && Math.abs(cta.w - fixed.w) <= 6;
      const isFixedAsset = looksFixed && short <= 400 && fixed!.h <= panelInner.h && fixed!.w <= panelInner.w;
      const oohShare = recipe.axis === "stacked" ? 0.075 : 0.125;
      const ctaH = isFixedAsset ? fixed!.h : looksFixed ? r(Math.min(panelInner.h * 0.6, short * oohShare)) : Math.max(recipe.ctaFloorPx, r(Math.min(panelInner.h * 0.6, short * recipe.ctaHeightFrac)));
      const ctaW = isFixedAsset ? fixed!.w : r(Math.min(ctaH * (cta.w / Math.max(1, cta.h)), panelInner.w * recipe.ctaMaxWidthFrac));
      const cx = isStrip || recipe.axis === "row" ? panelInner.x + panelInner.w - ctaW : panelInner.x + (panelInner.w - ctaW) / 2;
      out.push({ ...cta, id: "ly_cta", fit: "contain", x: r(cx), y: r(panelInner.y + (panelInner.h - ctaH) / 2), w: ctaW, h: ctaH });
    }
  }

  // Logo tile per the brand rules, when the master carries a separate logo layer.
  const logo = by("logo")[0];
  if (logo && tile) out.push({ ...logo, id: "ly_logo", role: "logo", fit: "contain", locked: true, x: tile.tile.x, y: tile.tile.y, w: tile.tile.w, h: tile.tile.h });

  const dropped = imgs.filter((i) => !i.slot || i.slot === "other").length;
  if (dropped) notes.push(`${dropped} unrecognised decoration layer${dropped === 1 ? "" : "s"} not carried to this size.`);
  notes.push("Built from image layers: the headline and CTA are pictures, so Claude's check aligns them to the approved references rather than re-setting type.");
  return { config: { ...master, elements: out, adaptMethod: "layered" } as FreeformConfig, notes };
}
