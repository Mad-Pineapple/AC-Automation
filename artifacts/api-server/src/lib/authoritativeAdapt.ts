/**
 * Deterministic adaptation for packages exported by AC-InDesign-Bridge.idjs.
 *
 * The InDesign document has already supplied semantics, blocks and anchors.
 * This adapter deliberately avoids inferred slots, campaign recipes and AI.
 *
 * Placement is the liquid-layout model (lib/liquid.ts), per block: a block
 * pinned on both sides of an axis stretches between its pins, a block pinned
 * on one side rides that edge keeping its scaled offset, an unpinned block
 * keeps its share of the canvas. Switches come from, in order: the block's
 * own `constraints` (a designer's edit in the editor), the bridge anchors
 * (anchorX / anchorY / scaleMode), or inference from where the block sits.
 *
 * Raster artwork is never stretched: a stretched image block crops (cover)
 * to its new box; logos and lockups always scale uniformly and ride their
 * edges; text scales uniformly and re-aligns inside a stretched block.
 */
import type { FreeformConfig, FreeformElement } from "./freeform";
import { inferConstraints, resolveLiquid, describeConstraints, type LiquidConstraints } from "./liquid";
import type { RuleLayer } from "./partRulesLayer";

type Box = { x: number; y: number; w: number; h: number };

const round = (n: number) => Math.round(n * 100) / 100;
const union = (items: FreeformElement[]): Box => {
  const x0 = Math.min(...items.map((e) => e.x));
  const y0 = Math.min(...items.map((e) => e.y));
  const x1 = Math.max(...items.map((e) => e.x + e.w));
  const y1 = Math.max(...items.map((e) => e.y + e.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export type MasterFamily = NonNullable<FreeformConfig["masterFamily"]>;

export function familyForTarget(width: number, height: number): MasterFamily {
  const ratio = width / height;
  if (ratio <= 0.55) return "slim-portrait";
  if (ratio < 0.82) return "portrait";
  if (ratio >= 2.75) return "slim-landscape";
  return "landscape";
}

const aspectDist = (aw: number, ah: number, bw: number, bh: number) => Math.abs(Math.log((aw / ah) / (bw / bh)));

/** The family master a target should be built from; null when the target is
 *  slim and no slim master exists (the caller decides how to soften that). */
export function selectAuthoritativeSource<T extends { width: number; height: number; config: FreeformConfig }>(
  sources: T[], width: number, height: number,
): T | null {
  if (!sources.length) return null;
  const exact = sources.find((s) => s.width === width && s.height === height);
  if (exact) return exact;
  const family = familyForTarget(width, height);
  const familySources = sources.filter((s) => s.config.masterFamily === family);
  if ((family === "slim-portrait" || family === "slim-landscape") && familySources.length === 0) return null;
  const candidates = familySources.length
    ? familySources
    : sources.filter((s) => family.includes("portrait") ? s.width < s.height : s.width >= s.height);
  const pool = candidates.length ? candidates : sources;
  return [...pool].sort((a, b) => aspectDist(a.width, a.height, width, height) - aspectDist(b.width, b.height, width, height))[0];
}

/** Nearest master by shape, whatever its family. */
export function nearestAuthoritativeSource<T extends { width: number; height: number }>(sources: T[], width: number, height: number): T | null {
  if (!sources.length) return null;
  return [...sources].sort((a, b) => aspectDist(a.width, a.height, width, height) - aspectDist(b.width, b.height, width, height))[0];
}

/** True when the target's shape lies strictly between two masters' shapes,
 *  so the family can be interpolated instead of copied from one master. */
export function targetBetweenMasters(sources: Array<{ width: number; height: number }>, width: number, height: number): boolean {
  if (sources.length < 2) return false;
  const t = Math.log(width / height);
  const logs = sources.map((s) => Math.log(s.width / s.height));
  return t > Math.min(...logs) + 0.02 && t < Math.max(...logs) - 0.02;
}

/** Bridge anchors → liquid switches. */
export function constraintsFromAnchors(el: { anchorX?: string; anchorY?: string; scaleMode?: string }): LiquidConstraints | undefined {
  if (!el.anchorX && !el.anchorY && !el.scaleMode) return undefined;
  const c: LiquidConstraints = {};
  if (el.anchorX === "left") c.pinLeft = true;
  if (el.anchorX === "right") c.pinRight = true;
  if (el.anchorX === "stretch") { c.pinLeft = true; c.pinRight = true; c.flexW = true; }
  if (el.anchorY === "top") c.pinTop = true;
  if (el.anchorY === "bottom") c.pinBottom = true;
  if (el.anchorY === "stretch") { c.pinTop = true; c.pinBottom = true; c.flexH = true; }
  if (el.scaleMode === "fill") { c.flexW = true; c.flexH = true; }
  return Object.keys(c).length ? c : undefined;
}

export interface AuthoritativeOptions {
  rules?: RuleLayer;
}

export function adaptAuthoritativeConfig(
  master: FreeformConfig, srcW: number, srcH: number, dstW: number, dstH: number, opts: AuthoritativeOptions = {},
): FreeformConfig {
  if (srcW === dstW && srcH === dstH) return JSON.parse(JSON.stringify(master)) as FreeformConfig;
  const groups = new Map<string, FreeformElement[]>();
  for (const el of master.elements) {
    const key = el.layoutBlock || `item:${el.id}`;
    groups.set(key, [...(groups.get(key) ?? []), el]);
  }
  const byId = new Map<string, FreeformElement>();
  const notes: string[] = [];
  let needsReview = false;
  // The whole composition is fitted first (one scale for everything), then
  // each block's pins decide where it lands and whether it stretches.
  const fitScale = Math.min(dstW / srcW, dstH / srcH);
  const canvasSrc: Box = { x: 0, y: 0, w: srcW, h: srcH };
  const canvasDst: Box = { x: 0, y: 0, w: dstW, h: dstH };
  const describe: string[] = [];
  for (const [key, members] of groups) {
    const source = union(members);
    const lead = members[0];
    const isLogo = members.every((m) => m.slot === "logo" || m.slot === "lockup" || (m.type === "image" && m.role === "logo"));
    // Designer switches win outright. Bridge anchors are merged with what
    // the geometry says: a block that spans the page (a panel, a band) is
    // pinned both sides and flexible whatever a v1 anchor called it, because
    // "centre" from the old thirds guess left such blocks short on wider
    // canvases.
    const inferred = inferConstraints(source, canvasSrc);
    const spans: LiquidConstraints = {
      ...(inferred.flexW ? { pinLeft: true, pinRight: true, flexW: true } : {}),
      ...(inferred.flexH ? { pinTop: true, pinBottom: true, flexH: true } : {}),
    };
    let c: LiquidConstraints =
      (lead.constraints && Object.keys(lead.constraints).length ? lead.constraints : undefined)
      ?? (constraintsFromAnchors(lead) ? { ...constraintsFromAnchors(lead), ...spans } : undefined)
      ?? inferred;
    // Logos and lockups never stretch: pins may ride edges, springs are off.
    if (isLogo) c = { ...c, flexW: undefined, flexH: undefined, ...(c.pinLeft && c.pinRight ? { pinLeft: undefined } : {}), ...(c.pinTop && c.pinBottom ? { pinTop: undefined } : {}) };
    const scale = lead.scaleMode === "fixed" ? 1 : fitScale;
    const box = resolveLiquid(source, c, canvasSrc, canvasDst, scale);
    const kx = box.w / Math.max(1, source.w * scale);
    const ky = box.h / Math.max(1, source.h * scale);
    const stretched = Math.abs(kx - 1) > 0.02 || Math.abs(ky - 1) > 0.02;
    describe.push(`${key}: ${describeConstraints(c)}${stretched ? " (stretched)" : ""}`);
    for (const el of members) {
      const w = Math.max(1, round(el.w * scale));
      const h = Math.max(1, round(el.h * scale));
      const offX = (el.x - source.x) * scale, offY = (el.y - source.y) * scale;
      if (el.type === "image" && members.length === 1 && stretched && !isLogo) {
        // A stretched single image block crops to its box rather than
        // distorting (the photo, a flat panel, a band motif).
        byId.set(el.id, { ...el, x: box.x, y: box.y, w: box.w, h: box.h, fit: "cover" });
        continue;
      }
      if (el.type === "rect" && stretched) {
        // A flat fill stretches with its block on the flexible axes.
        const fx0 = source.w > 0 ? (el.x - source.x) / source.w : 0, fx1 = source.w > 0 ? (el.x + el.w - source.x) / source.w : 1;
        const fy0 = source.h > 0 ? (el.y - source.y) / source.h : 0, fy1 = source.h > 0 ? (el.y + el.h - source.y) / source.h : 1;
        byId.set(el.id, { ...el, x: round(box.x + fx0 * box.w), y: round(box.y + fy0 * box.h), w: Math.max(1, round((fx1 - fx0) * box.w)), h: Math.max(1, round((fy1 - fy0) * box.h)) });
        continue;
      }
      if (el.type === "image" && stretched && !isLogo && (el.slot === "band" || el.slot === "photo" || el.slot === "panel")) {
        // Bands, panels and photos inside a mixed block crop to the block's
        // flexible extent rather than sitting short in it.
        const fx0 = source.w > 0 ? (el.x - source.x) / source.w : 0, fx1 = source.w > 0 ? (el.x + el.w - source.x) / source.w : 1;
        const fy0 = source.h > 0 ? (el.y - source.y) / source.h : 0, fy1 = source.h > 0 ? (el.y + el.h - source.y) / source.h : 1;
        const bw = Math.max(1, round((fx1 - fx0) * box.w)), bh = c.flexH ? Math.max(1, round((fy1 - fy0) * box.h)) : h;
        byId.set(el.id, { ...el, x: round(box.x + fx0 * box.w), y: round(box.y + fy0 * box.h), w: bw, h: bh, fit: "cover" });
        continue;
      }
      let x = box.x + offX, y = box.y + offY;
      if (stretched) {
        // Members keep their own size; they re-align inside the wider box:
        // text by its alignment, everything else by its share of the block.
        const fx = source.w > 0 ? (el.x + el.w / 2 - source.x) / source.w : 0.5;
        const fy = source.h > 0 ? (el.y + el.h / 2 - source.y) / source.h : 0.5;
        if (el.type === "text") x = el.align === "center" ? box.x + (box.w - w) / 2 : el.align === "right" ? box.x + box.w - w : box.x + offX;
        else x = box.x + fx * box.w - w / 2;
        y = box.y + fy * box.h - h / 2;
      }
      const next: FreeformElement = {
        ...el,
        x: round(x), y: round(y), w, h,
        ...(el.type === "text" ? { fontSize: Math.max(6, round(el.fontSize * scale)), ...(el.letterSpacing !== undefined ? { letterSpacing: round(el.letterSpacing * scale) } : {}) } : {}),
      } as FreeformElement;
      byId.set(el.id, next);
    }
  }
  const elements = master.elements.map((e) => byId.get(e.id) ?? e);
  // Studio floors still hold on the bridge path: copy and pills below them
  // are raised to the floor inside their box and flagged for a look.
  const rules = opts.rules;
  if (rules) {
    for (const el of elements) {
      if (el.type === "text") {
        const part = el.slot === "headline" ? "headline" : el.slot === "subheadline" || el.slot === "kicker" ? "subheadline" : el.slot === "message" ? "message" : el.slot === "ctaLabel" ? "cta" : null;
        const floor = part === "cta" ? 9 : part ? rules.floor(part) : 0;
        if (floor && el.fontSize < floor) {
          notes.push(`Check: "${el.text.replace(/\s+/g, " ").slice(0, 24)}" came out at ${Math.round(el.fontSize)}px — raised to the ${floor}px floor; confirm it still fits.`);
          el.fontSize = floor;
          el.h = Math.max(el.h, Math.round(floor * (el.lineHeight ?? 1.2)));
          needsReview = true;
        }
      } else if (el.slot === "cta" && el.h < rules.floor("cta")) {
        notes.push(`Check: the call-to-action is ${Math.round(el.h)}px tall — under the ${rules.floor("cta")}px floor at this size.`);
        needsReview = true;
      }
    }
  }
  return {
    ...master,
    elements,
    adaptMethod: "indesign-authoritative",
    adaptNotes: [
      `Built from the registered ${master.masterFamily ?? "InDesign"} master with its blocks' liquid-layout pins (${describe.slice(0, 6).join("; ")}).`,
      "Raster artwork was never stretched (a stretched block crops to its box); logos scaled uniformly; AI repositioning bypassed.",
      ...notes,
    ],
    ...(needsReview ? { needsReview: true } : {}),
  };
}


/**
 * A target whose shape lies between two family masters is INTERPOLATED from
 * both, block by block (blocks are keyed by their bridge name, so "cta" in
 * the portrait matches "cta" in the landscape): each block's box, as a
 * fraction of its canvas, is blended by the target's position between the
 * two shapes (log-aspect), then the block's pins are applied. Blocks that
 * exist in only one master come from the nearer master.
 */
export function adaptAuthoritativeBetween(
  a: { width: number; height: number; config: FreeformConfig },
  b: { width: number; height: number; config: FreeformConfig },
  dstW: number, dstH: number, opts: AuthoritativeOptions = {},
): FreeformConfig {
  const la = Math.log(a.width / a.height), lb = Math.log(b.width / b.height), lt = Math.log(dstW / dstH);
  const t = Math.max(0, Math.min(1, (lt - la) / Math.max(1e-6, lb - la)));
  const near = t < 0.5 ? a : b;
  const blocksOf = (cfg: FreeformConfig) => {
    const m = new Map<string, FreeformElement[]>();
    for (const el of cfg.elements) { const k = el.layoutBlock || el.slot || el.id; m.set(k, [...(m.get(k) ?? []), el]); }
    return m;
  };
  const ba = blocksOf(a.config), bb = blocksOf(b.config), bn = blocksOf(near.config);
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const out: FreeformElement[] = [];
  const canvasDst: Box = { x: 0, y: 0, w: dstW, h: dstH };
  const describe: string[] = [];
  for (const [key, nearMembers] of bn) {
    const ma = ba.get(key), mb = bb.get(key);
    const src = union(nearMembers);
    const srcCanvas: Box = { x: 0, y: 0, w: near.width, h: near.height };
    const lead = nearMembers[0];
    const isLogo = nearMembers.every((m) => m.slot === "logo" || m.slot === "lockup" || (m.type === "image" && m.role === "logo"));
    let box: Box;
    if (ma && mb) {
      const ua = union(ma), ub = union(mb);
      const fx = lerp(ua.x / a.width, ub.x / b.width), fy = lerp(ua.y / a.height, ub.y / b.height);
      const fw = lerp(ua.w / a.width, ub.w / b.width), fh = lerp(ua.h / a.height, ub.h / b.height);
      box = { x: fx * dstW, y: fy * dstH, w: Math.max(1, fw * dstW), h: Math.max(1, fh * dstH) };
      // Pins still hold: flush in both masters stays flush here. Same merge
      // as the single-master path: designer switches, else anchors plus what
      // the geometry says (a block spanning the page is pinned both sides).
      const inferredA = inferConstraints(ua, { x: 0, y: 0, w: a.width, h: a.height });
      const spansA: LiquidConstraints = { ...(inferredA.flexW ? { pinLeft: true, pinRight: true, flexW: true } : {}), ...(inferredA.flexH ? { pinTop: true, pinBottom: true, flexH: true } : {}) };
      const leadA = ma[0];
      const ca: LiquidConstraints = (leadA.constraints && Object.keys(leadA.constraints).length ? leadA.constraints : undefined)
        ?? (constraintsFromAnchors(leadA) ? { ...constraintsFromAnchors(leadA), ...spansA } : undefined)
        ?? inferredA;
      if (ca.pinLeft && ca.pinRight) { box.x = 0; box.w = dstW; } else if (ca.pinLeft) box.x = lerp(ua.x, ub.x) * (dstW / lerp(a.width, b.width)); else if (ca.pinRight) box.x = dstW - box.w - lerp(a.width - ua.x - ua.w, b.width - ub.x - ub.w) * (dstW / lerp(a.width, b.width));
      if (ca.pinTop && ca.pinBottom) { box.y = 0; box.h = dstH; } else if (ca.pinTop) box.y = lerp(ua.y, ub.y) * (dstH / lerp(a.height, b.height)); else if (ca.pinBottom) box.y = dstH - box.h - lerp(a.height - ua.y - ua.h, b.height - ub.y - ub.h) * (dstH / lerp(a.height, b.height));
      describe.push(`${key}: blended`);
    } else {
      const c = lead.constraints ?? constraintsFromAnchors(lead) ?? inferConstraints(src, srcCanvas);
      box = resolveLiquid(src, c, srcCanvas, canvasDst, Math.min(dstW / near.width, dstH / near.height));
      describe.push(`${key}: from the ${near === a ? "first" : "second"} master`);
    }
    // Members: uniform scale by the block's own change (min axis) for
    // pictures and text; rects and bands fill the block.
    const sx = box.w / Math.max(1, src.w), sy = box.h / Math.max(1, src.h);
    const s = isLogo ? Math.min(sx, sy) : Math.min(sx, sy);
    for (const el of nearMembers) {
      const fx0 = src.w > 0 ? (el.x - src.x) / src.w : 0, fx1 = src.w > 0 ? (el.x + el.w - src.x) / src.w : 1;
      const fy0 = src.h > 0 ? (el.y - src.y) / src.h : 0, fy1 = src.h > 0 ? (el.y + el.h - src.y) / src.h : 1;
      if (el.type === "rect" || (el.type === "image" && !isLogo && (el.slot === "band" || el.slot === "photo" || el.slot === "panel" || nearMembers.length === 1))) {
        out.push({ ...el, x: round(box.x + fx0 * box.w), y: round(box.y + fy0 * box.h), w: Math.max(1, round((fx1 - fx0) * box.w)), h: Math.max(1, round((fy1 - fy0) * box.h)), ...(el.type === "image" ? { fit: "cover" } : {}) } as FreeformElement);
        continue;
      }
      const w = Math.max(1, round(el.w * s)), h = Math.max(1, round(el.h * s));
      const cx = box.x + ((fx0 + fx1) / 2) * box.w, cy = box.y + ((fy0 + fy1) / 2) * box.h;
      const x = el.type === "text" ? (el.align === "center" ? cx - w / 2 : el.align === "right" ? box.x + fx1 * box.w - w : box.x + fx0 * box.w) : cx - w / 2;
      out.push({ ...el, x: round(x), y: round(cy - h / 2), w, h, ...(el.type === "text" ? { fontSize: Math.max(6, round(el.fontSize * s)), ...(el.letterSpacing !== undefined ? { letterSpacing: round(el.letterSpacing * s) } : {}) } : {}) } as FreeformElement);
    }
  }
  // Copy keeps its relation to the panel: what sat wholly above or beside
  // the panel in the nearer master stays above or beside it here (blended
  // blocks otherwise slide under the panel or the band).
  const panelOut = out.find((e) => e.slot === "panel") ?? null;
  const bandOut = out.find((e) => e.slot === "band") ?? null;
  const panelNear = near.config.elements.find((e) => e.slot === "panel") ?? null;
  if (panelOut && panelNear) {
    const seamY = Math.min(panelOut.y, bandOut ? bandOut.y : Infinity);
    const seamX = Math.min(panelOut.x, bandOut ? bandOut.x : Infinity);
    const byBlock = new Map<string, FreeformElement[]>();
    for (const e of out) { const k = e.layoutBlock ?? e.id; byBlock.set(k, [...(byBlock.get(k) ?? []), e]); }
    for (const [k, members] of byBlock) {
      if (!members.some((e) => e.type === "text")) continue;
      const nearMembers = near.config.elements.filter((e) => (e.layoutBlock ?? e.id) === k);
      const nb = union(nearMembers);
      const wasAbove = nb.y + nb.h <= panelNear.y + 1 && panelNear.w >= near.width * 0.9;
      const wasBeside = nb.x + nb.w <= panelNear.x + 1 && panelNear.h >= near.height * 0.9;
      const ob = union(members);
      if (wasAbove && ob.y + ob.h > seamY - 4) { const dy = ob.y + ob.h - (seamY - 4); for (const e of members) e.y = round(Math.max(0, e.y - dy)); }
      if (wasBeside && ob.x + ob.w > seamX - 4) { const dx = ob.x + ob.w - (seamX - 4); for (const e of members) e.x = round(Math.max(0, e.x - dx)); }
    }
  }
  // Blocks blended independently can meet: copy that lands on other copy
  // (a sub-line on the message) is nudged down, in reading order, so the
  // gate is not the first to notice.
  const copy = out.filter((e) => e.type === "text" && e.text.trim().length > 0).sort((p, q) => p.y - q.y);
  for (let i = 1; i < copy.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = copy[j], b = copy[i];
      if ((a.layoutBlock ?? a.id) === (b.layoutBlock ?? b.id)) continue;
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (ix * iy > 0.1 * Math.min(a.w * a.h, b.w * b.h)) {
        const shift = a.y + a.h - b.y + Math.max(4, Math.round(b.h * 0.25));
        if (b.y + shift + b.h <= dstH) b.y = round(b.y + shift);
      }
    }
  }
  const base: FreeformConfig = { ...near.config, elements: out };
  // Floors, as on the single-master path.
  const floored = adaptAuthoritativeConfig({ ...base, elements: out.map((e) => ({ ...e })) }, dstW, dstH, dstW, dstH, opts);
  return {
    ...floored,
    adaptMethod: "indesign-interpolated",
    adaptNotes: [
      `Interpolated between the family's InDesign masters (${a.width}×${a.height} and ${b.width}×${b.height}, ${Math.round(t * 100)}% of the way): ${describe.slice(0, 6).join("; ")}.`,
      ...(floored.adaptNotes ?? []).filter((n) => n.startsWith("Check:")),
    ],
  };
}


/** How a bridge master is composed: a panel or band spanning the width is a
 *  stacked layout (photo over panel); spanning the height is a side layout. */
export function masterAxis(cfg: FreeformConfig, width: number, height: number): "stacked" | "side" | null {
  const zone = cfg.elements.find((e) => (e.slot === "panel" || e.slot === "band") && e.w > 0 && e.h > 0);
  if (!zone) return null;
  if (zone.w >= width * 0.9 && zone.h < height * 0.9) return "stacked";
  if (zone.h >= height * 0.9 && zone.w < width * 0.9) return "side";
  return null;
}
