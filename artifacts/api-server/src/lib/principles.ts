/**
 * Design-principle scores for an automated layout — the second half of the
 * gate after the mandatory-element rules. A designer looking at a contact
 * sheet checks four things geometry alone can measure:
 *
 *  - alignment: parts that shared an edge (or centre) in the master still do;
 *  - margins:   copy keeps clear of the canvas edge the way the master does;
 *  - balance:   the visual weight sits where the master put it (same axis)
 *               and copy is not crowded into one end of a strip;
 *  - contrast:  each copy element reads against what is actually behind it
 *               in the rendered piece (WCAG ratio; 3:1 is the floor for
 *               display-size copy, 4.5:1 for small copy).
 *
 * Scores are 0..1 and stored on the config (`principles`) so the review
 * pages can show them; a contrast ratio under the floor on mandatory copy
 * is a rejection, the rest surface as checks.
 */
import sharp from "sharp";
import type { FreeformConfig, FreeformElement, FreeformText } from "./freeform";
import type { LayoutIssue } from "./layoutCheck";
import { renderFreeformToPng, type ImageLoader } from "./renderFreeform";

export interface PrincipleScores {
  alignment: number;
  margins: number;
  balance: number;
  /** Worst contrast ratio behind copy, or null when it could not be measured. */
  contrast: number | null;
  /** Per-copy-element ratios, worst first. */
  contrastDetail?: Array<{ id: string; label: string; ratio: number; floor: number }>;
}

const COPY_SLOTS = new Set(["headline", "subheadline", "message"]);
const ALIGN_SLOTS = new Set(["headline", "subheadline", "message", "cta", "lockup"]);

function label(el: FreeformElement): string {
  return el.slot ?? (el.type === "text" ? el.role : el.id);
}
function isCopy(el: FreeformElement): boolean {
  if (el.slot && COPY_SLOTS.has(el.slot)) return el.w > 0 && el.h > 0;
  return el.type === "text" && el.text.trim().length > 0 && el.w > 0 && el.h > 0;
}
function bySlot(cfg: FreeformConfig, slot: string): FreeformElement | undefined {
  return cfg.elements.find((e) => (e.slot === slot || (e.type === "text" && e.role === slot)) && e.w > 0 && e.h > 0 && (e.type !== "text" || e.text.trim().length > 0));
}

// ---------------------------------------------------------------------------
// Geometry: alignment, margins, balance
// ---------------------------------------------------------------------------

export function scoreGeometry(
  master: FreeformConfig, srcW: number, srcH: number,
  adapted: FreeformConfig, w: number, h: number,
): { scores: Pick<PrincipleScores, "alignment" | "margins" | "balance">; issues: LayoutIssue[] } {
  const issues: LayoutIssue[] = [];
  const short = Math.min(w, h);
  const srcShort = Math.min(srcW, srcH);

  // Alignment — every pair of parts that lined up in the master (left,
  // centre or right edges within 2% of the short side) should still line
  // up here. Parts the adapter placed in different zones are exempt: a
  // headline over the photo and a button in the panel never shared an
  // edge on purpose.
  const slots = [...ALIGN_SLOTS].filter((s) => bySlot(master, s) && bySlot(adapted, s));
  // Headline and sub-line live over the photo; message, button and lockup in
  // the panel. Across a change of axis the two groups move to different
  // zones by design, so only pairs inside a group are compared then.
  const groupOf = (s: string) => (s === "headline" || s === "subheadline" ? "copy" : "panel");
  const sameAxisBuild = (srcW >= srcH) === (w >= h);
  let pairs = 0, kept = 0;
  const tolM = Math.max(2, srcShort * 0.02);
  const tolA = Math.max(3, short * 0.025);
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a0 = bySlot(master, slots[i])!, b0 = bySlot(master, slots[j])!;
      const a1 = bySlot(adapted, slots[i])!, b1 = bySlot(adapted, slots[j])!;
      const rel = (a: FreeformElement, b: FreeformElement, tol: number) => ({
        left: Math.abs(a.x - b.x) <= tol,
        centre: Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) <= tol,
        right: Math.abs((a.x + a.w) - (b.x + b.w)) <= tol,
      });
      const m = rel(a0, b0, tolM);
      if (!m.left && !m.centre && !m.right) continue;
      if (!sameAxisBuild && groupOf(slots[i]) !== groupOf(slots[j])) continue;
      // On a strip the button and lockup sit at the end of the row by
      // design; only the copy pair is held to the master's alignment.
      if (h <= 120 && w / h >= 2.5 && (groupOf(slots[i]) !== "copy" || groupOf(slots[j]) !== "copy")) continue;
      pairs++;
      const r = rel(a1, b1, tolA);
      if ((m.left && r.left) || (m.centre && r.centre) || (m.right && r.right)) kept++;
      else {
        const off = m.left ? Math.abs(a1.x - b1.x) : m.centre ? Math.abs((a1.x + a1.w / 2) - (b1.x + b1.w / 2)) : Math.abs((a1.x + a1.w) - (b1.x + b1.w));
        issues.push({ severity: off > short * 0.08 ? "error" : "warn", message: `Alignment: ${slots[i]} and ${slots[j]} shared a ${m.left ? "left edge" : m.centre ? "centre line" : "right edge"} in the master but are ${Math.round(off)}px apart here.`, elementId: a1.id });
      }
    }
  }
  const alignment = pairs === 0 ? 1 : kept / pairs;

  // Margins — the master's clearance from the canvas edge, per copy part,
  // as a share of its short side; the adapted piece keeps at least 60% of
  // that (and never under 4px). Logo tiles, bands, photos and cut-outs are
  // placed to the edge by design and are not measured.
  let margins = 1;
  for (const el of adapted.elements) {
    if (!isCopy(el) && el.slot !== "cta" && el.slot !== "lockup") continue;
    const m0 = master.elements.find((e) => e.slot === el.slot && e.slot) ?? null;
    const masterFrac = m0 ? Math.max(0, Math.min(m0.x, m0.y, srcW - (m0.x + m0.w), srcH - (m0.y + m0.h))) / srcShort : 0.04;
    const floor = Math.max(4, Math.round(short * Math.min(masterFrac, 0.12) * 0.6));
    const gap = Math.min(el.x, el.y, w - (el.x + el.w), h - (el.y + el.h));
    if (gap < floor) {
      margins = Math.min(margins, Math.max(0, gap) / floor);
      issues.push({ severity: gap < floor / 2 ? "error" : "warn", message: `Margins: ${label(el)} sits ${Math.round(Math.max(0, gap))}px from the canvas edge; the master keeps about ${Math.round(masterFrac * 100)}% of the short side clear (${floor}px here).`, elementId: el.id });
    }
  }

  // Balance — centroid of the visual weight (copy, cut-out, panel, button,
  // lockup, logo; the photo fills and is not weight). On a same-axis build
  // it should sit where the master's does; across axes the copy should not
  // be crowded into one end of the long axis.
  const weightOf = (cfg: FreeformConfig) => {
    let ax = 0, ay = 0, aw = 0;
    for (const el of cfg.elements) {
      const s = el.slot ?? "";
      if (!(isCopy(el) || ["cutout", "panel", "cta", "lockup", "logo"].includes(s))) continue;
      const area = Math.max(1, el.w * el.h) * (isCopy(el) ? 1.3 : 1);
      ax += (el.x + el.w / 2) * area; ay += (el.y + el.h / 2) * area; aw += area;
    }
    return aw > 0 ? { x: ax / aw, y: ay / aw } : null;
  };
  const cm = weightOf(master), ca = weightOf(adapted);
  let balance = 1;
  if (cm && ca) {
    const sameAxis = (srcW >= srcH) === (w >= h);
    if (sameAxis) {
      const dx = Math.abs(cm.x / srcW - ca.x / w), dy = Math.abs(cm.y / srcH - ca.y / h);
      const d = Math.max(dx, dy);
      balance = Math.max(0, 1 - d / 0.3);
      if (d > 0.15) issues.push({ severity: d > 0.25 ? "error" : "warn", message: `Balance: the visual weight sits ${Math.round(d * 100)}% of the canvas away from where the master puts it.` });
    } else {
      const longIsX = w >= h;
      const pos = longIsX ? ca.x / w : ca.y / h;
      const d = Math.abs(pos - 0.5);
      balance = Math.max(0, 1 - Math.max(0, d - 0.15) / 0.3);
      if (d > 0.3) issues.push({ severity: "warn", message: `Balance: the weight is crowded toward one end of the ${longIsX ? "width" : "height"} (${Math.round(pos * 100)}% along).` });
    }
  }
  return { scores: { alignment: round(alignment), margins: round(margins), balance: round(balance) }, issues };
}

// ---------------------------------------------------------------------------
// Contrast behind copy (rendered)
// ---------------------------------------------------------------------------

function relLum(r: number, g: number, b: number): number {
  const c = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
function ratio(l1: number, l2: number): number {
  const [a, b] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}
function round(n: number): number { return Math.round(n * 100) / 100; }

async function raw(png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Renders the piece twice — once without its copy, once with only its copy
 * on white (and on black when the copy is light) — and measures, for every
 * copy element, the contrast between the copy's own pixels and what sits
 * behind them. Returns the worst ratio and the reasons for any below floor.
 */
export async function scoreContrast(
  config: FreeformConfig, w: number, h: number,
  loadImage: ImageLoader, brandFontFamily?: string,
  /** The master's own ratios by label: a part that reads the way the
   * designer's approved master reads is as designed, not a failure. */
  baseline: Map<string, number> = new Map(),
): Promise<{ contrast: number | null; detail: PrincipleScores["contrastDetail"]; rejections: string[]; issues: LayoutIssue[] }> {
  const copy = config.elements.filter(isCopy);
  if (copy.length === 0) return { contrast: null, detail: [], rejections: [], issues: [] };
  const copyIds = new Set(copy.map((e) => e.id));
  const opts = { loadImage, brandFontFamily, scale: 1 };
  const behind = await raw(await renderFreeformToPng({ ...config, elements: config.elements.filter((e) => !copyIds.has(e.id)) }, w, h, opts));
  const onWhite = await raw(await renderFreeformToPng({ ...config, elements: config.elements.filter((e) => copyIds.has(e.id)) }, w, h, opts));
  let onBlack: { data: Buffer; width: number; height: number } | null = null;

  const detail: NonNullable<PrincipleScores["contrastDetail"]> = [];
  const rejections: string[] = [];
  const issues: LayoutIssue[] = [];
  const px = (img: { data: Buffer; width: number }, x: number, y: number) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]] as const; };

  for (const el of copy) {
    const x0 = Math.max(0, Math.floor(el.x)), y0 = Math.max(0, Math.floor(el.y));
    const x1 = Math.min(w, Math.ceil(el.x + el.w)), y1 = Math.min(h, Math.ceil(el.y + el.h));
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    // Copy pixels: those the copy-only render painted (differ from the white ground).
    let src = onWhite;
    const collect = (img: typeof onWhite, ground: number) => {
      const pts: Array<[number, number]> = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const [r, g, b] = px(img, x, y);
        if (Math.abs(r - ground) + Math.abs(g - ground) + Math.abs(b - ground) > 60) pts.push([x, y]);
      }
      return pts;
    };
    let pts = collect(src, 255);
    const area = (x1 - x0) * (y1 - y0);
    if (pts.length < area * 0.01) {
      // Light copy on a white ground is invisible: render the copy on black instead.
      if (!onBlack) {
        const black = { id: "__ground", type: "rect" as const, x: 0, y: 0, w, h, fill: "#000000" };
        onBlack = await raw(await renderFreeformToPng({ ...config, elements: [black, ...config.elements.filter((e) => copyIds.has(e.id))] }, w, h, opts));
      }
      src = onBlack; pts = collect(src, 0);
      if (pts.length < area * 0.005) continue;
    }
    // A part cut from a panel graphic carries its own opaque ground (the
    // panel colour) around the glyphs. When one colour dominates the box it
    // is that ground: the glyphs are the pixels that differ from it, and
    // they are read against it rather than against the render behind.
    const key = (r: number, g: number, b: number) => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const hist = new Map<number, number>();
    for (const [x, y] of pts) { const [r, g, b] = px(src, x, y); hist.set(key(r, g, b), (hist.get(key(r, g, b)) ?? 0) + 1); }
    let modeKey = -1, modeN = 0;
    for (const [k, n] of hist) if (n > modeN) { modeN = n; modeKey = k; }
    let lc = 0, lb = 0, n = 0;
    if (el.type !== "text" && modeN > area * 0.45) {
      let gr = 0, gg = 0, gb = 0, gn = 0;
      for (const [x, y] of pts) { const [r, g, b] = px(src, x, y); if (key(r, g, b) === modeKey) { gr += r; gg += g; gb += b; gn++; } }
      const ground = [gr / gn, gg / gn, gb / gn] as const;
      const glyphs = pts.filter(([x, y]) => { const [r, g, b] = px(src, x, y); return Math.abs(r - ground[0]) + Math.abs(g - ground[1]) + Math.abs(b - ground[2]) > 90; });
      if (glyphs.length < area * 0.005) continue;
      const step = Math.max(1, Math.floor(glyphs.length / 4000));
      for (let i = 0; i < glyphs.length; i += step) { const [x, y] = glyphs[i]; const [r, g, b] = px(src, x, y); lc += relLum(r, g, b); n++; }
      lb = relLum(ground[0], ground[1], ground[2]) * n;
    } else {
      // Sample up to ~4000 copy pixels for speed.
      const step = Math.max(1, Math.floor(pts.length / 4000));
      for (let i = 0; i < pts.length; i += step) {
        const [x, y] = pts[i];
        const [cr, cg, cb] = px(src, x, y);
        const [br, bg, bb] = px(behind, x, y);
        lc += relLum(cr, cg, cb); lb += relLum(br, bg, bb); n++;
      }
    }
    if (n === 0) continue;
    const r = ratio(lc / n, lb / n);
    const t = el.type === "text" ? (el as FreeformText) : null;
    // Known type colour: use it directly rather than antialiased pixels,
    // which read greyer than the ink at small sizes.
    const hex = t && /^#?[0-9a-f]{6}$/i.test(t.color) ? t.color.replace("#", "") : null;
    if (hex && n > 0) lc = relLum(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)) * n;
    const r2 = hex ? ratio(lc / n, lb / n) : r;
    const large = t ? t.fontSize >= 18 : Math.min(el.w, el.h) >= 18;
    const floor = large ? 3 : 4.5;
    detail.push({ id: el.id, label: label(el), ratio: round(r2), floor });
    if (r2 < floor) {
      const r = r2;
      const designed = baseline.get(label(el));
      if (designed != null && r >= designed * 0.8) {
        issues.push({ severity: "warn", message: `Contrast: ${label(el)} reads at ${r.toFixed(1)}:1 — under the ${floor}:1 floor, but the master reads the same (${designed.toFixed(1)}:1), so as designed.`, elementId: el.id });
        continue;
      }
      const msg = `Contrast: ${label(el)} reads at ${r.toFixed(1)}:1 against what is behind it (floor ${floor}:1${designed != null ? `; the master reads ${designed.toFixed(1)}:1` : ""}).`;
      if (el.slot === "headline" || el.slot === "message" || (t && t.role === "headline")) rejections.push(msg);
      else issues.push({ severity: r < floor * 0.7 ? "error" : "warn", message: msg, elementId: el.id });
    }
  }
  detail.sort((a, b) => a.ratio - b.ratio);
  return { contrast: detail.length ? detail[0].ratio : null, detail, rejections, issues };
}

const baselineCache = new Map<string, { at: number; ratios: Map<string, number> }>();

/** The master's own contrast per copy part, measured once per master and
 * kept for ten minutes so a build of many sizes pays for it once. */
export async function contrastBaseline(
  key: string, master: FreeformConfig, w: number, h: number,
  loadImage: ImageLoader, brandFontFamily?: string,
): Promise<Map<string, number>> {
  const hit = baselineCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.ratios;
  const m = await scoreContrast(master, w, h, loadImage, brandFontFamily);
  const ratios = new Map<string, number>();
  for (const d of m.detail ?? []) ratios.set(d.label, d.ratio);
  baselineCache.set(key, { at: Date.now(), ratios });
  return ratios;
}
