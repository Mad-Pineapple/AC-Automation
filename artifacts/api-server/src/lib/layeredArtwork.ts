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
import { classifyAspect, type FormatClass } from "./formatCatalog";
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
  if (next.elements.some((e) => e.type === "image" && e.slot === "panel")) {
    try {
      const split = await splitPanelGraphic(next, io);
      next = split.config;
      inferred.notes.push(...split.notes);
    } catch (err) {
      logger.warn({ err }, "layered artwork: panel split failed; keeping the baked panel");
    }
  }
  return { config: next, changed: hasLayeredSlots(next), notes: inferred.notes };
}

/** True when the master's baked panel has been cut into re-stackable parts. */
export function hasPanelParts(config: FreeformConfig): boolean {
  return config.elements.some((e) => e.type === "image" && e.panelPart === true);
}

type PixelClass = "ground" | "yellow" | "white" | "other" | "none";

/**
 * Cut a baked panel graphic (band + message + lockup in one PNG, as the
 * HTML exports ship it) into its parts, so the panel can be re-stacked for
 * a zone of any shape instead of scaled or dropped whole. The parts are
 * found by colour: the band is the motif strip at the top (yellow AND
 * light-blue marks across most of the width), the message is the yellow
 * type, the lockup is the white cluster at the bottom. The panel image
 * stays on the master as the ground-colour reference; the parts carry the
 * panel's motion so the HTML export still moves them as one.
 */
export async function splitPanelGraphic(config: FreeformConfig, io: LayerIO): Promise<{ config: FreeformConfig; notes: string[] }> {
  const notes: string[] = [];
  if (hasPanelParts(config)) return { config, notes };
  const panel = config.elements.find((e): e is Img => e.type === "image" && e.slot === "panel" && !!e.src);
  if (!panel) return { config, notes };
  const bytes = await io.loadImage(panel.src!);
  if (!bytes) return { config, notes };
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) return { config, notes };
  const W = meta.width, H = meta.height;
  const raw = await sharp(bytes).ensureAlpha().raw().toBuffer();
  const px = (x: number, y: number) => { const i = (y * W + x) * 4; return [raw[i], raw[i + 1], raw[i + 2], raw[i + 3]] as const; };
  // Ground colour: the most common opaque colour along the panel's edges.
  const tally = new Map<string, number>();
  const bump = (x: number, y: number) => { const [r, g, b, a] = px(x, y); if (a < 200) return; const k = `${r >> 3},${g >> 3},${b >> 3}`; tally.set(k, (tally.get(k) ?? 0) + 1); };
  for (let x = 0; x < W; x++) { bump(x, 0); bump(x, H - 1); bump(x, Math.floor(H / 2)); }
  for (let y = 0; y < H; y++) { bump(0, y); bump(W - 1, y); }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return { config, notes };
  const [gr, gg, gb] = top[0].split(",").map((v) => (Number(v) << 3) + 4);
  const classify = (r: number, g: number, b: number, a: number): PixelClass => {
    if (a < 40) return "none";
    if (Math.abs(r - gr) + Math.abs(g - gg) + Math.abs(b - gb) < 72) return "ground";
    if (r > 185 && g > 165 && b < 140 && r - b > 80) return "yellow";
    if (r > 210 && g > 210 && b > 210) return "white";
    return "other";
  };
  interface RowStat { content: number; yellow: number; white: number; other: number; x0: number; x1: number }
  const rows: RowStat[] = [];
  for (let y = 0; y < H; y++) {
    const st: RowStat = { content: 0, yellow: 0, white: 0, other: 0, x0: W, x1: -1 };
    for (let x = 0; x < W; x++) {
      const [r, g, b, a] = px(x, y);
      const c = classify(r, g, b, a);
      if (c === "ground" || c === "none") continue;
      st.content++;
      if (c === "yellow") st.yellow++; else if (c === "white") st.white++; else st.other++;
      if (x < st.x0) st.x0 = x;
      if (x > st.x1) st.x1 = x;
    }
    rows.push(st);
  }
  // Segments: runs of content rows, bridged across gaps of up to 4px.
  interface Seg { y0: number; y1: number; x0: number; x1: number; content: number; yellow: number; white: number; other: number }
  const segs: Seg[] = [];
  let cur: Seg | null = null;
  let gap = 0;
  for (let y = 0; y < H; y++) {
    const st = rows[y];
    if (st.content >= 2) {
      if (!cur) cur = { y0: y, y1: y, x0: st.x0, x1: st.x1, content: 0, yellow: 0, white: 0, other: 0 };
      cur.y1 = y; cur.x0 = Math.min(cur.x0, st.x0); cur.x1 = Math.max(cur.x1, st.x1);
      cur.content += st.content; cur.yellow += st.yellow; cur.white += st.white; cur.other += st.other;
      gap = 0;
    } else if (cur) {
      gap++;
      if (gap > 4) { segs.push(cur); cur = null; gap = 0; }
    }
  }
  if (cur) segs.push(cur);
  const isBand = (s: Seg) => s.other >= s.content * 0.2 && s.yellow >= s.content * 0.05 && (s.x1 - s.x0) >= W * 0.6 && s.y0 < H * 0.35;
  const isMessage = (s: Seg) => !isBand(s) && s.yellow >= s.content * 0.55 && (s.y1 - s.y0) >= 6;
  // The lockup is mostly white type with the coloured emergency-management
  // mark beside it, so white is the plurality, not the majority.
  const isLockup = (s: Seg) => !isBand(s) && !isMessage(s) && s.white >= s.content * 0.3 && s.white + s.other >= s.content * 0.6 && s.y0 > H * 0.35 && (s.y1 - s.y0) >= 8;
  const band = segs.find(isBand) ?? null;
  const message = segs.filter(isMessage).sort((a, b) => b.content - a.content)[0] ?? null;
  const lockup = [...segs.filter(isLockup)].pop() ?? null;
  if (!message && !lockup) { notes.push("Panel graphic kept whole: no message or lockup could be told apart in it."); return { config, notes }; }

  const sx = panel.w / W, sy = panel.h / H;
  const parts: Img[] = [];
  const cut = async (seg: Seg, slot: "band" | "message" | "lockup", id: string) => {
    const pad = 2;
    const x0 = Math.max(0, seg.x0 - pad), y0 = Math.max(0, seg.y0 - pad);
    const x1 = Math.min(W - 1, seg.x1 + pad), y1 = Math.min(H - 1, seg.y1 + pad);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const buf = await sharp(bytes).extract({ left: x0, top: y0, width: cw, height: ch }).png().toBuffer();
    const stored = await io.uploadBytes(buf, "image/png");
    const w = cw * sx, h = ch * sy;
    const el: Img = {
      id,
      type: "image",
      role: "decoration",
      slot,
      src: `/api/storage${stored}`,
      fit: "contain",
      x: r(panel.x + x0 * sx),
      y: r(panel.y + y0 * sy),
      w: r(w),
      h: r(h),
      panelPart: true,
      ...(panel.motion ? { motion: { ...panel.motion, w0: r(w), h0: r(h) } } : {}),
    };
    parts.push(el);
  };
  if (band) await cut(band, "band", "layer_band");
  if (message) await cut(message, "message", "layer_message");
  if (lockup) await cut(lockup, "lockup", "layer_lockup");
  const idx = config.elements.findIndex((e) => e.id === panel.id);
  const elements = [...config.elements];
  elements.splice(idx + 1, 0, ...parts);
  notes.push(`Panel graphic cut into ${parts.map((p) => p.slot).join(", ")} so the panel can be re-stacked at any size.`);
  return { config: { ...config, elements }, notes };
}

// ---------------------------------------------------------------------------
// Adapting slotted layers to a new canvas

export interface LayeredAdaptOptions {
  /** Solid fill behind the panel zone when the panel image doesn't cover it. */
  panelFill?: string | null;
  logoUrl?: string | null;
  /** Campaign style schema: its zones and part rules override the class recipe. */
  spec?: StyleSchema | null;
  /** Format class decided from the brief's name/channel (else by dimensions). */
  formatClass?: FormatClass;
}

function recipeCtaFloor(recipe: { ctaFloorPx: number }): number {
  return recipe.ctaFloorPx;
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
  const cls = opts.formatClass ?? classifyAspect(dstW, dstH);
  const base = RECIPES[cls];
  const short = Math.min(dstW, dstH);
  // Display-sized canvases (300×600, 970×250, 300×250 …) follow the shipped
  // display pieces' shares; OOH-sized canvases follow the OOH masters'.
  const isDisplayCanvas = short <= 400;
  // The campaign schema, when one matches, is the standard: its zone shares
  // and CTA rule replace the class recipe's.
  const spec = opts.spec ?? null;
  const zone = spec?.zones[cls];
  const zonePhotoFrac = zone ? (isDisplayCanvas && zone.displayPhotoFrac != null ? zone.displayPhotoFrac : zone.photoFrac) : base.photoFrac;
  const recipe = zone ? { ...base, axis: zone.axis === "row" ? ("row" as const) : zone.axis === "side" ? ("side" as const) : ("stacked" as const), photoFrac: zonePhotoFrac, bandFrac: zone.bandFrac, bandAt: zone.bandAt } : base;
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
  const tile = opts.logoUrl && by("logo").length > 0 ? guidelineLogoPlacement(dstW, dstH) : null;
  if (tile && recipe.axis !== "stacked") panelZone = { ...panelZone, w: Math.max(40, tile.tile.x - panelZone.x - margin) };
  const panelInnerEarly: Box = { x: panelZone.x + margin, y: panelZone.y + margin, w: panelZone.w - margin * 2, h: panelZone.h - margin * 2 };
  // Strips are one row: headline group | pill | lockup. Size the right-hand
  // items first so the headline takes what is left, never overlapping them.
  const stripCta0 = by("cta")[0];
  const stripLockup0 = by("lockup").find((i) => i.panelPart) ?? null;
  const stripGap = Math.max(6, margin);
  let stripCtaBox: { w: number; h: number } | null = null;
  let stripLockupBox: { w: number; h: number } | null = null;
  let stripReserve = 0;
  if (isStrip) {
    if (stripCta0) {
      let h = Math.min(panelInnerEarly.h * 0.6, Math.max(recipeCtaFloor(base), stripCta0.h));
      let w = h * (stripCta0.w / Math.max(1, stripCta0.h));
      if (w > panelInnerEarly.w * 0.26) { w = panelInnerEarly.w * 0.26; h = w * (stripCta0.h / Math.max(1, stripCta0.w)); }
      stripCtaBox = { w, h };
      stripReserve += w + stripGap;
    }
    if (stripLockup0) {
      let h = Math.min(panelInnerEarly.h * 0.5, stripLockup0.h);
      let w = h * (stripLockup0.w / Math.max(1, stripLockup0.h));
      if (w > panelInnerEarly.w * 0.26) { w = panelInnerEarly.w * 0.26; h = w * (stripLockup0.h / Math.max(1, stripLockup0.w)); }
      stripLockupBox = { w, h };
      stripReserve += w + stripGap;
    }
  }

  const out: FreeformElement[] = [];
  // Panel ground first, so a panel image that doesn't cover the zone still sits on brand colour.
  if (opts.panelFill) out.push({ id: "ly_panel_ground", type: "rect", slot: "panel", fill: opts.panelFill, x: panelZone.x, y: panelZone.y, w: panelZone.w, h: panelZone.h, locked: true } as FreeformElement);

  // Photo covers its zone, panned so the subject (the cut-out's box in the
  // master: the flooded car) stays whole inside the crop window — a centre
  // crop of a tall photo into a wide zone halves the car.
  const photo = by("photo")[0];
  const cutoutForPan = [...by("cutout")].sort((a, b) => area(b) - area(a))[0];
  let panX = typeof photo?.focusX === "number" ? photo.focusX : 0.5;
  let panY = typeof photo?.focusY === "number" ? photo.focusY : 0.5;
  if (photo && cutoutForPan && !isStrip) {
    const photoAspect = photo.w / Math.max(1, photo.h);
    let rw = photoZone.w, rh = rw / photoAspect;
    if (rh < photoZone.h) { rh = photoZone.h; rw = rh * photoAspect; }
    const sx = rw / Math.max(1, photo.w), sy = rh / Math.max(1, photo.h);
    // Subject box in the oversize photo's own px, with a little air around it.
    const bx0 = (cutoutForPan.x - photo.x) * sx - photoZone.w * 0.03, bx1 = (cutoutForPan.x + cutoutForPan.w - photo.x) * sx + photoZone.w * 0.03;
    const by0 = (cutoutForPan.y - photo.y) * sy - photoZone.h * 0.05, by1 = (cutoutForPan.y + cutoutForPan.h - photo.y) * sy + photoZone.h * 0.05;
    const slackX = rw - photoZone.w, slackY = rh - photoZone.h;
    // The crop window's top-left is slack × pan. Keep the box inside it when
    // it fits, else centre on the box.
    // Only pan when the subject can sit whole in the window AND leave the
    // upper part of the zone for the copy (its top no higher than 45% down);
    // otherwise the master's own framing stands — never zoom into the car.
    const fit = (b0: number, b1: number, win: number, slack: number, cur: number, copyRoom: number) => {
      if (slack <= 0) return cur;
      const lo = Math.max(0, b1 - win), hi = Math.min(slack, b0 - win * copyRoom);
      if (lo <= hi) return Math.min(1, Math.max(0, Math.min(Math.max(cur * slack, lo), hi) / slack));
      return cur;
    };
    panX = fit(bx0, bx1, photoZone.w, slackX, panX, 0);
    panY = fit(by0, by1, photoZone.h, slackY, panY, 0.45);
  }
  if (photo) out.push({ ...photo, id: "ly_photo", fit: "cover", focusX: Math.round(panX * 1000) / 1000, focusY: Math.round(panY * 1000) / 1000, x: photoZone.x, y: photoZone.y, w: photoZone.w, h: photoZone.h });

  // Cut-out first: it anchors to the bottom of the photo zone, and the copy
  // group takes the band above it (as in the master: headline over the car).
  // The anchoring cut-out is the largest one (the car), never a stray thin layer.
  const cutout = [...by("cutout")].sort((a, b) => area(b) - area(a))[0];
  let cutoutBox: Box | null = null;
  /** True when the cut-out was placed free of the photo's own car and may
   *  move up with the copy to the family's headline height. */
  let cutoutFloating = false;
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
    const fx = panX;
    const fy = panY;
    const rx = photoZone.x - (rw - photoZone.w) * fx;
    const ry = photoZone.y - (rh - photoZone.h) * fy;
    const sx = rw / Math.max(1, photo.w), sy = rh / Math.max(1, photo.h);
    const box: Box = { x: rx + (cutout.x - photo.x) * sx, y: ry + (cutout.y - photo.y) * sy, w: cutout.w * sx, h: cutout.h * sy };
    const visible = overlap(box, photoZone) / Math.max(1, area(box));
    const tall = photoZone.w / Math.max(1, photoZone.h) < 0.7;
    const photoIdx = out.findIndex((e) => e.id === "ly_photo");
    if (tall && box.w > photoZone.w * 0.96) {
      // Tall, narrow column: the car at cover scale is wider than the column.
      // Show the WHOLE car as big as the column allows — the cut-out at the
      // column's width, bottom of the zone — and pan the photo to the side
      // that keeps its own car out of frame, so there is only one car.
      const cx0 = (cutout.x - photo.x) * sx, cx1 = cx0 + cutout.w * sx;
      const slackX = Math.max(0, rw - photoZone.w);
      const overlapAt = (p: number) => Math.max(0, Math.min(p + photoZone.w, cx1) - Math.max(p, cx0));
      // The nearest window to the master's own framing that leaves its car
      // out: just left of the car or just right of it, whichever is closer.
      const cur = panX * slackX;
      const leftOf = Math.min(slackX, Math.max(0, cx0 - photoZone.w - photoZone.w * 0.04));
      const rightOf = Math.min(slackX, Math.max(0, cx1 + photoZone.w * 0.04));
      const candidates = [leftOf, rightOf].map((p) => ({ p, o: overlapAt(p) })).filter((c) => c.o <= (cx1 - cx0) * 0.12).sort((a, b) => Math.abs(a.p - cur) - Math.abs(b.p - cur));
      const best = candidates[0];
      if (best && slackX > 0) {
        const cw = photoZone.w * 0.94, chh = cw * (cutout.h / Math.max(1, cutout.w));
        // Provisional: bottom of the zone. Once the copy is sized, car and
        // copy move up together to the family's headline height.
        cutoutBox = { x: r(photoZone.x + (photoZone.w - cw) / 2), y: r(photoZone.y + photoZone.h - chh - margin / 2), w: r(cw), h: r(chh) };
        cutoutFloating = true;
        if (photoIdx >= 0) (out[photoIdx] as Img).focusX = Math.round((best.p / slackX) * 1000) / 1000;
        notes.push("Cut-out placed whole at the column's width; the photo's crop window moved just off its own car.");
      } else {
        notes.push("Cut-out dropped: the column cannot show the whole car without a second car behind it.");
      }
    } else if (visible >= 0.6 && box.h <= photoZone.h * 0.6) {
      let placed: Box = { x: box.x, y: box.y, w: box.w, h: box.h };
      if (tall) {
        // Room to spare: grow the cut-out to the column's width (it covers
        // the photo's own car, which sits beneath it), never past 1.35×.
        const k = Math.min(1.35, (photoZone.w * 0.94) / Math.max(1, box.w));
        if (k > 1.02) {
          const w = box.w * k, h = box.h * k;
          let x = box.x + box.w / 2 - w / 2, y = box.y + box.h / 2 - h / 2;
          x = Math.max(photoZone.x + 2, Math.min(photoZone.x + photoZone.w - w - 2, x));
          y = Math.min(photoZone.y + photoZone.h - h - 2, y);
          placed = { x, y, w, h };
          notes.push("Cut-out enlarged to the column's width so the whole car reads.");
        }
      }
      cutoutBox = { x: r(placed.x), y: r(placed.y), w: r(placed.w), h: r(placed.h) };
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
  // The designer's copy-to-car relationship: the cut-out is drawn over the
  // bottom of the copy (a slight overlap that reads as the copy sitting
  // behind the car). Measure it on the master as a fraction of the last
  // line's height and reproduce it at every size — never replace it with a gap.
  const masterCopyBottom = sub ? Math.max(hBox.y + hBox.h, sub.y + sub.h) : hBox.y + hBox.h;
  const lastLineH = sub ? sub.h : hBox.h;
  const copyOverCutoutFrac = cutout ? (masterCopyBottom - cutout.y) / Math.max(1, lastLineH) : null;
  const groupW = Math.max(hBox.w, sub ? sub.x + sub.w - hBox.x : 0);
  const rowLike = isStrip || recipe.axis === "row";
  const copyBand: Box = rowLike
    ? { x: panelZone.x + margin, y: panelZone.y + margin, w: r(isStrip ? Math.max(40, panelZone.w - margin * 2 - stripReserve) : panelZone.w * 0.55), h: panelZone.h - margin * 2 }
    : { x: photoZone.x + margin, y: photoZone.y + margin, w: photoZone.w - margin * 2, h: (cutoutBox ? cutoutBox.y + Math.max(0, (copyOverCutoutFrac ?? 0) * lastLineH) : photoZone.y + photoZone.h) - photoZone.y - margin * 2 };
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
    // With a cut-out the copy block sits on it exactly as in the master: the
    // measured overlap (or touch) between the last line and the car's top,
    // scaled with the copy — the car is drawn after the copy, so it reads
    // in front.
    const ov = copyOverCutoutFrac != null ? copyOverCutoutFrac * lastLineH * s : -margin / 2;
    gy = r(Math.max(copyBand.y, cutoutBox.y + ov - groupH * s));
    if (cutoutFloating) {
      // Copy block centre at the family's headline anchor (45% of the photo
      // zone), the car riding up with it; never above the top margin.
      const anchorY = spec?.parts.headline?.anchor.y ?? 0.45;
      const wantGy = r(photoZone.y + photoZone.h * anchorY - (groupH * s) / 2);
      const shift = Math.min(0, Math.max(copyBand.y, wantGy) - gy);
      if (shift < 0) { gy += shift; cutoutBox = { ...cutoutBox, y: r(cutoutBox.y + shift) }; }
    }
    if (copyOverCutoutFrac != null && copyOverCutoutFrac > 0.02) notes.push("Car cut-out overlaps the copy as in the master (copy reads behind the car).");
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

  // Panel group. When the baked panel has been cut into parts (band,
  // message, lockup), re-stack them in the zone the way the schema reads:
  // band on the panel's outer edge, then a centred column of message, CTA
  // and lockup. Otherwise fit the whole graphic as before.
  const panelImg = by("panel")[0];
  const cta = by("cta")[0];
  const panelInner: Box = { x: panelZone.x + margin, y: panelZone.y + margin, w: panelZone.w - margin * 2, h: panelZone.h - margin * 2 };
  const partBand = by("band").find((i) => i.panelPart) ?? null;
  const partMessage = by("message").find((i) => i.panelPart) ?? null;
  const partLockup = by("lockup").find((i) => i.panelPart) ?? null;
  const fixedCta = spec?.parts.cta?.fixedPx ?? null;
  const ctaLooksFixed = !!(cta && fixedCta && Math.abs(cta.h - fixedCta.h) <= 3 && Math.abs(cta.w - fixedCta.w) <= 6);
  if ((partMessage || partLockup) && !isStrip) {
    const ps = panelImg ? panelZone.w / Math.max(1, panelImg.w) : 1;
    // A shallow zone (an MREC's 100px panel) gives up the fixed pill and the
    // outer margins so the message and lockup stay legible.
    const shallow = panelZone.h < 200;
    let stackTop = panelZone.y + (shallow ? margin / 2 : margin);
    if (partBand && recipe.bandAt !== "none") {
      // Full zone width, aspect kept, never taller than a quarter of the zone
      // (an eighth on a shallow zone, where the message and lockup need the room).
      let bw = panelZone.w, bh = bw * (partBand.h / Math.max(1, partBand.w));
      const capH = panelZone.h * (shallow ? 0.2 : 0.25);
      if (bh > capH) { bh = capH; bw = bh * (partBand.w / Math.max(1, partBand.h)); }
      out.push({ ...partBand, id: "ly_band", fit: "contain", x: r(panelZone.x + (panelZone.w - bw) / 2), y: r(panelZone.y), w: r(bw), h: r(bh) });
      stackTop = panelZone.y + bh + margin / 2;
    }
    const stackBottom = panelZone.y + panelZone.h - (shallow ? margin / 2 : margin);
    const avail = Math.max(10, stackBottom - stackTop);
    const gapPx = Math.max(4, margin / 2);
    // Natural sizes at the panel's own scale; the CTA follows the pill rule.
    interface Item { el: Img; w: number; h: number; minH: number; fixed: boolean }
    const items: Item[] = [];
    if (partMessage) items.push({ el: partMessage, w: partMessage.w * ps, h: partMessage.h * ps, minH: 11, fixed: false });
    if (cta) {
      const oohShare = recipe.axis === "stacked" ? 0.075 : 0.125;
      const wantFixed = ctaLooksFixed && isDisplayCanvas && !shallow && fixedCta!.w <= panelInner.w * 0.9;
      // A fixed display pill that is wider than the zone is scaled to the
      // zone, never swapped for the OOH share (that made a 12px pill on 160-wide).
      const fitFixed = ctaLooksFixed && isDisplayCanvas && !wantFixed;
      const ctaH = wantFixed ? fixedCta!.h : fitFixed ? r((panelInner.w * 0.85) * (fixedCta!.h / fixedCta!.w)) : ctaLooksFixed ? r(short * oohShare) : Math.max(recipe.ctaFloorPx, r(cta.h * ps));
      const ctaW = wantFixed ? fixedCta!.w : Math.min(panelInner.w * 0.85, r(ctaH * (cta.w / Math.max(1, cta.h))));
      items.push({ el: cta, w: ctaW, h: wantFixed ? ctaH : ctaW * (cta.h / Math.max(1, cta.w)), minH: recipe.ctaFloorPx, fixed: wantFixed });
    }
    if (partLockup) items.push({ el: partLockup, w: partLockup.w * ps, h: partLockup.h * ps, minH: 14, fixed: false });
    // Width caps per part, then a common shrink when the column is too tall.
    const capW = (it: Item) => (it.el === partMessage ? panelInner.w * 0.9 : it.el === partLockup ? panelInner.w * 0.7 : panelInner.w * 0.85);
    for (const it of items) { if (it.w > capW(it)) { const k = capW(it) / it.w; it.w *= k; it.h *= k; } }
    const total = () => items.reduce((a, it) => a + it.h, 0) + gapPx * (items.length - 1);
    if (total() > avail) {
      const flexible = items.filter((it) => !it.fixed);
      const fixedH = items.filter((it) => it.fixed).reduce((a, it) => a + it.h, 0);
      const room = avail - gapPx * (items.length - 1) - fixedH;
      const flexH = flexible.reduce((a, it) => a + it.h, 0);
      const k = Math.max(0.2, room / Math.max(1, flexH));
      for (const it of flexible) { const h = Math.max(it.minH, it.h * k); it.w *= h / it.h; it.h = h; }
      if (total() > avail) {
        // Even the pill has to give: scale everything to fit, floors permitting.
        const k2 = avail / total();
        for (const it of items) { it.w *= k2; it.h = Math.max(it.minH, it.h * k2); }
        notes.push("Panel column compressed to fit this zone; check the message and lockup are legible.");
      }
    }
    // Where the schema anchors each part in the zone (block centres), when
    // the anchored positions keep their order and don't collide; else an
    // even stack.
    const anchorOf = (it: Item): number | null => {
      const part = it.el === partMessage ? spec?.parts.message : it.el === partLockup ? spec?.parts.lockup : spec?.parts.cta;
      return part?.anchor.y ?? null;
    };
    let anchored: number[] | null = spec && !shallow ? items.map((it) => {
      const a = anchorOf(it);
      if (a == null) return NaN;
      const centre = panelZone.y + a * panelZone.h;
      return Math.max(stackTop, Math.min(stackBottom - it.h, centre - it.h / 2));
    }) : null;
    if (anchored && anchored.some((v) => Number.isNaN(v))) anchored = null;
    if (anchored) {
      for (let i = 1; i < items.length; i++) if (anchored[i] < anchored[i - 1] + items[i - 1].h + gapPx) { anchored = null; break; }
    }
    let y = stackTop + Math.max(0, (avail - total()) / 2);
    for (const [i, it] of items.entries()) {
      const id = it.el === partMessage ? "ly_message" : it.el === partLockup ? "ly_lockup" : "ly_cta";
      const yy = anchored ? anchored[i] : y;
      out.push({ ...it.el, id, fit: "contain", x: r(panelZone.x + (panelZone.w - it.w) / 2), y: r(yy), w: r(it.w), h: r(it.h) });
      y += it.h + gapPx;
    }
    if (panelImg) notes.push("Panel re-stacked from its parts (band, message, button, lockup) for this zone.");
  } else {
  const partsAlreadyPlaced = false;
  void partsAlreadyPlaced;
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
      const fitFixed = looksFixed && short <= 400 && !isFixedAsset;
      const oohShare = recipe.axis === "stacked" ? 0.075 : 0.125;
      const ctaH = isFixedAsset ? fixed!.h : fitFixed ? r(Math.min(panelInner.h * 0.6, panelInner.w * 0.85 * (fixed!.h / fixed!.w))) : looksFixed ? r(Math.min(panelInner.h * 0.6, short * oohShare)) : Math.max(recipe.ctaFloorPx, r(Math.min(panelInner.h * 0.6, short * recipe.ctaHeightFrac)));
      const ctaW = isFixedAsset ? fixed!.w : r(Math.min(ctaH * (cta.w / Math.max(1, cta.h)), panelInner.w * recipe.ctaMaxWidthFrac));
      // On a strip the lockup is the brand mark: it takes the right end and
      // the pill sits beside it, both pre-sized so the headline never overlaps.
      let rightEdge = panelInner.x + panelInner.w;
      if (isStrip && partLockup && stripLockupBox) {
        out.push({ ...partLockup, id: "ly_lockup", fit: "contain", x: r(rightEdge - stripLockupBox.w), y: r(panelInner.y + (panelInner.h - stripLockupBox.h) / 2), w: r(stripLockupBox.w), h: r(stripLockupBox.h) });
        rightEdge -= stripLockupBox.w + stripGap;
      }
      const cw = isStrip && stripCtaBox ? r(stripCtaBox.w) : ctaW;
      const ch = isStrip && stripCtaBox ? r(stripCtaBox.h) : ctaH;
      const cx = isStrip || recipe.axis === "row" ? rightEdge - cw : panelInner.x + (panelInner.w - cw) / 2;
      out.push({ ...cta, id: "ly_cta", fit: "contain", x: r(cx), y: r(panelInner.y + (panelInner.h - ch) / 2), w: cw, h: ch });
    } else if (isStrip && partLockup && stripLockupBox) {
      out.push({ ...partLockup, id: "ly_lockup", fit: "contain", x: r(panelInner.x + panelInner.w - stripLockupBox.w), y: r(panelInner.y + (panelInner.h - stripLockupBox.h) / 2), w: r(stripLockupBox.w), h: r(stripLockupBox.h) });
    }
  }

  }

  // Logo tile per the brand rules, when the master carries a separate logo layer.
  const logo = by("logo")[0];
  if (logo && tile) out.push({ ...logo, id: "ly_logo", role: "logo", fit: "contain", locked: true, x: tile.tile.x, y: tile.tile.y, w: tile.tile.w, h: tile.tile.h });

  const dropped = imgs.filter((i) => (!i.slot || i.slot === "other") && !i.panelPart).length;
  if (dropped) notes.push(`${dropped} unrecognised decoration layer${dropped === 1 ? "" : "s"} not carried to this size.`);
  notes.push("Built from image layers: the headline and CTA are pictures, so Claude's check aligns them to the approved references rather than re-setting type.");
  return { config: { ...master, elements: out, adaptMethod: "layered" } as FreeformConfig, notes };
}
