/**
 * The anther — Auckland Council's framing device: a circle on a straight
 * stem (the pollen-bearing tip of a pōhutukawa stamen). It houses a photo,
 * an illustration or the copy.
 *
 * BRAND SCHEMA RULE (designer ruling, 20 Sep 2026; AC Brand Guidelines June
 * 2025, pp. 28–31 and 16):
 *
 *   1. The anther is NEVER cropped. Its circle sits wholly inside the
 *      artwork, and nothing is laid over it. (The guidelines allow a cropped
 *      anther only "subject to design review"; an automated build has no
 *      design review, so it does not crop.)
 *   2. It is as big as the margins allow: the circle runs to the margins of
 *      its zone, and the margin is half the pōhutukawa tile.
 *   3. The stem runs off the artwork's boundary — from the left, the lower
 *      left at 45°, or the bottom centre — far enough that its straight
 *      lines show. That is how the device is drawn, not a crop.
 *   4. The stem is never covered by the pōhutukawa tile, and never heads for
 *      the lower-right corner where the tile lives.
 *   5. On narrow formats the margin may give way so the circle can hold its
 *      picture, but the curve where the stem meets the circle stays visible.
 *
 * This module reads the shape off the image itself (its transparency), so
 * the rule holds for any campaign's anther, not one known file.
 */
import sharp from "sharp";

export interface AntherShape {
  kind: "anther" | "shape";
  /** Circle centre and radius as fractions of the image (r is of the WIDTH). */
  cx: number;
  cy: number;
  r: number;
  /** Tip of the stem (the opaque point farthest from the centre), fractions. */
  stemX?: number;
  stemY?: number;
  /** The image's own width ÷ height. */
  aspect?: number;
}

export const ANTHER_RULE = {
  id: "anther-never-cropped",
  title: "The anther is never cropped",
  lines: [
    "The anther's circle sits wholly inside the artwork; nothing is laid over it.",
    "It is as big as the margins allow (margin = half the pōhutukawa tile).",
    "The stem runs off the artwork's edge — left, lower left at 45°, or bottom centre — with its straight lines showing.",
    "The stem is never covered by the pōhutukawa tile and never heads for the lower-right corner.",
    "A size that cannot hold the whole anther is flagged for a designer, never built with it cropped.",
  ],
  source: "AC Brand Guidelines June 2025, pp. 16, 28–31; designer ruling 20 Sep 2026",
} as const;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Read a shaped image: null for a plain rectangle of pixels. A few soft edge
 * pixels do not make a shape — a real one leaves at least a tenth of its box
 * clear, corners first.
 */
export async function analyseShape(bytes: Buffer): Promise<AntherShape | null> {
  try {
    const meta = await sharp(bytes, { failOn: "none" }).metadata();
    if (!meta.hasAlpha || !meta.width || !meta.height) return null;
    const W = 96, H = Math.max(8, Math.round((96 * meta.height) / meta.width));
    const { data } = await sharp(bytes, { failOn: "none" }).resize(W, H, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && data[(y * W + x) * 4 + 3] >= 128;
    let clear = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!solid(x, y)) clear++;
    const corners = [solid(1, 1), solid(W - 2, 1), solid(1, H - 2), solid(W - 2, H - 2)].filter((v) => !v).length;
    if (clear / (W * H) < 0.1 || corners < 2) return null;
    // Distance to the nearest clear pixel (two-pass chamfer): the largest
    // value is the radius of the biggest circle the shape holds.
    const INF = 1e6;
    const d = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = solid(x, y) ? INF : 0;
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[y * W + x]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (d[y * W + x] === 0) continue;
      d[y * W + x] = Math.min(d[y * W + x], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      if (d[y * W + x] === 0) continue;
      d[y * W + x] = Math.min(d[y * W + x], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
    }
    let best = 0, bx = W / 2, by = H / 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[y * W + x] > best) { best = d[y * W + x]; bx = x; by = y; }
    if (best < 4) return null;
    // An anther is a circle on a thin stem: the circle must account for most
    // of what is solid. A photo with a dark sky keyed away is not that.
    let solidCount = 0, insideCircle = 0, circleCells = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const inC = Math.hypot(x - bx, y - by) <= best;
      if (inC) circleCells++;
      if (solid(x, y)) { solidCount++; if (inC) insideCircle++; }
    }
    if (insideCircle / Math.max(1, circleCells) < 0.95 || insideCircle / Math.max(1, solidCount) < 0.72) return null;
    // The stem's tip: the solid pixel farthest from the circle's centre.
    let far = 0, sx = bx, sy = by;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!solid(x, y)) continue;
      const dist = Math.hypot(x - bx, y - by);
      if (dist > far) { far = dist; sx = x; sy = y; }
    }
    const hasStem = far > best * 1.18;
    return {
      kind: hasStem ? "anther" : "shape",
      cx: r3((bx + 0.5) / W), cy: r3((by + 0.5) / H), r: r3(best / W),
      ...(hasStem ? { stemX: r3((sx + 0.5) / W), stemY: r3((sy + 0.5) / H) } : {}),
      aspect: r3(meta.width / meta.height),
    };
  } catch {
    return null;
  }
}

/**
 * A shape whose ground colour was baked into the pixels (an importer
 * rasterised the anther together with the artwork's flat ground): cut that
 * ground away so the shape can be read and nothing square is laid over the
 * layout. Only ground CONNECTED TO THE EDGE goes — the same colour inside the
 * picture (a pale sky) stays. Returns null when the corners do not agree on a
 * ground colour. The imported file itself is never changed; builds use this
 * derived cut-out.
 */
export async function keyOutGround(bytes: Buffer, groundHex?: string | null): Promise<Buffer | null> {
  try {
    const { data, info } = await sharp(bytes, { failOn: "none" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    if (W < 16 || H < 16 || W * H > 40_000_000) return null;
    const px = (x: number, y: number) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]] as const; };
    const corners = [px(2, 2), px(W - 3, 2), px(2, H - 3), px(W - 3, H - 3)];
    const diff = (a: readonly number[], b: readonly number[]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    // The ground is the colour most corners share.
    let bg: readonly number[] | null = null, votes = 0;
    for (const c of corners) { const n = corners.filter((o) => diff(c, o) < 22).length; if (n > votes) { votes = n; bg = c; } }
    if (!bg || votes < 2) return null;
    // The baked colour must BE the artwork's flat ground; otherwise this is
    // just a picture whose corners happen to agree (a dark sky, a plain wall).
    const hex = /^#?([0-9a-f]{6})$/i.exec(groundHex ?? "");
    if (!hex) return null;
    const g = [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)];
    if (diff(bg, g) > 18) return null;
    const T = 34;
    const isBg = (i: number) => Math.max(Math.abs(data[i] - bg![0]), Math.abs(data[i + 1] - bg![1]), Math.abs(data[i + 2] - bg![2])) < T;
    const mark = new Uint8Array(W * H);
    const stack: number[] = [];
    const seed = (x: number, y: number) => { const k = y * W + x; if (!mark[k] && isBg(k * 4)) { mark[k] = 1; stack.push(k); } };
    for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
    for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }
    while (stack.length) {
      const k = stack.pop() as number; const x = k % W, y = (k - x) / W;
      if (x > 0) seed(x - 1, y); if (x < W - 1) seed(x + 1, y); if (y > 0) seed(x, y - 1); if (y < H - 1) seed(x, y + 1);
    }
    // Keep only the largest solid piece — the shape itself. An importer that
    // rasterised the anther's box also caught whatever overlapped it (a corner
    // of the pattern band); invisible in the master, a stray fragment once
    // the ground is gone.
    const label = new Int32Array(W * H);
    let bestLabel = 0, bestSize = 0, next = 0;
    for (let k0 = 0; k0 < W * H; k0++) {
      if (mark[k0] || label[k0]) continue;
      const id = ++next; let size = 0; label[k0] = id; stack.push(k0);
      while (stack.length) {
        const k = stack.pop() as number; size++;
        const x = k % W, y = (k - x) / W;
        const visit = (j: number) => { if (!mark[j] && !label[j]) { label[j] = id; stack.push(j); } };
        if (x > 0) visit(k - 1); if (x < W - 1) visit(k + 1); if (y > 0) visit(k - W); if (y < H - 1) visit(k + W);
      }
      if (size > bestSize) { bestSize = size; bestLabel = id; }
    }
    for (let k = 0; k < W * H; k++) if (!mark[k] && label[k] !== bestLabel) mark[k] = 1;
    let cleared = 0;
    for (let k = 0; k < W * H; k++) if (mark[k]) { data[k * 4 + 3] = 0; cleared++; }
    if (cleared / (W * H) < 0.1) return null;
    // One soft pixel at the cut edge, by how far its colour is from the ground.
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const k = y * W + x;
      if (mark[k] || !(mark[k - 1] || mark[k + 1] || mark[k - W] || mark[k + W])) continue;
      const i = k * 4;
      const d = Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));
      data[i + 3] = Math.round(255 * Math.min(1, Math.max(0.25, (d - 10) / 50)));
    }
    return await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  } catch {
    return null;
  }
}

export interface Box { x: number; y: number; w: number; h: number }

export interface AntherPlacement {
  /** Where the whole image goes (may run past the canvas on the stem side). */
  box: Box;
  /** The circle, in canvas pixels. */
  circle: { cx: number; cy: number; r: number };
  notes: string[];
}

/**
 * Place an anther in `zone`: circle as big as the margins allow, whole, and
 * slid towards the edge its stem heads for until the stem runs off the
 * artwork (never past the margin on that side).
 */
export function placeAnther(zone: Box, canvas: { w: number; h: number }, natural: { w: number; h: number }, shape: AntherShape, margin: number): AntherPlacement {
  const notes: string[] = [];
  // Rule 5: on a narrow zone the margin gives way rather than the picture.
  const m = Math.min(margin, Math.min(zone.w, zone.h) * 0.08);
  const D = Math.max(16, Math.min(zone.w, zone.h) - m * 2);
  const imgW = D / (2 * shape.r);
  const imgH = imgW * (natural.h / Math.max(1, natural.w));
  let cx = zone.x + zone.w / 2, cy = zone.y + zone.h / 2;
  if (shape.kind === "anther" && shape.stemX != null && shape.stemY != null) {
    const vx = (shape.stemX - shape.cx) * imgW, vy = (shape.stemY - shape.cy) * imgH;
    const tip = () => ({ x: cx + vx, y: cy + vy });
    const reaches = () => { const t = tip(); return t.x <= 0 || t.y <= 0 || t.x >= canvas.w || t.y >= canvas.h; };
    if (!reaches()) {
      // Slide along the stem's main heading, the circle staying in its margins.
      const room = { left: cx - D / 2 - (zone.x + m), right: zone.x + zone.w - m - (cx + D / 2), up: cy - D / 2 - (zone.y + m), down: zone.y + zone.h - m - (cy + D / 2) };
      const t = tip();
      if (vx < 0 && Math.abs(vx) >= Math.abs(vy) * 0.5) cx -= Math.min(Math.max(0, room.left), t.x);
      else if (vx > 0 && Math.abs(vx) >= Math.abs(vy) * 0.5) cx += Math.min(Math.max(0, room.right), canvas.w - t.x);
      if (!reaches()) {
        const t2 = tip();
        if (vy > 0) cy += Math.min(Math.max(0, room.down), canvas.h - t2.y);
        else if (vy < 0) cy -= Math.min(Math.max(0, room.up), t2.y);
      }
    }
    if (!reaches()) notes.push("Check: the anther's stem ends inside the artwork at this size — it should run off an edge (brand guidelines p.28).");
    if (vx > 0 && vy > 0) notes.push("Check: this anther's stem heads for the lower-right corner, where the pōhutukawa tile sits (brand guidelines p.28).");
  }
  const box = { x: Math.round(cx - shape.cx * imgW), y: Math.round(cy - shape.cy * imgH), w: Math.round(imgW), h: Math.round(imgH) };
  return { box, circle: { cx, cy, r: D / 2 }, notes };
}

/** The circle of a placed anther element, in canvas pixels. */
export function circleOf(el: { x: number; y: number; w: number; h: number }, shape: AntherShape): { cx: number; cy: number; r: number } {
  return { cx: el.x + shape.cx * el.w, cy: el.y + shape.cy * el.h, r: shape.r * el.w };
}

/** Gate: is a placed anther whole and uncovered? Returns rejection reasons. */
export function checkAnther(
  elements: Array<{ id: string; type: string; x: number; y: number; w: number; h: number; slot?: string; role?: string; opacity?: number; shape?: AntherShape }>,
  canvasW: number,
  canvasH: number,
): string[] {
  const reasons: string[] = [];
  elements.forEach((el, idx) => {
    if (el.type !== "image" || !el.shape) return;
    const c = circleOf(el, el.shape);
    const tol = Math.max(1.5, c.r * 0.02);
    if (c.cx - c.r < -tol || c.cy - c.r < -tol || c.cx + c.r > canvasW + tol || c.cy + c.r > canvasH + tol) {
      reasons.push("The anther is cropped by the edge of the artwork. Brand schema: the anther is never cropped — this size needs a designer.");
    }
    // Anything solid laid over the circle (its inner square is enough to tell).
    const k = c.r * 0.7;
    const inner = { x0: c.cx - k, y0: c.cy - k, x1: c.cx + k, y1: c.cy + k };
    for (const over of elements.slice(idx + 1)) {
      if (over.type === "text" || (over.opacity ?? 1) < 0.5) continue;
      if (over.type === "image" && over.shape) continue;
      const ix = Math.min(inner.x1, over.x + over.w) - Math.max(inner.x0, over.x), iy = Math.min(inner.y1, over.y + over.h) - Math.max(inner.y0, over.y);
      if (ix > 0 && iy > 0 && (ix * iy) / ((inner.x1 - inner.x0) * (inner.y1 - inner.y0)) > 0.04) {
        reasons.push(`The anther is covered by the ${over.slot ?? over.role ?? "layer"} above it. Brand schema: nothing is laid over the anther.`);
        break;
      }
    }
  });
  return reasons;
}
