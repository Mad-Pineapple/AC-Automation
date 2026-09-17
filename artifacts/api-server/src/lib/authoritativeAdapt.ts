/**
 * Deterministic adaptation for packages exported by AC-InDesign-Bridge.idjs.
 *
 * The InDesign document has already supplied semantics, blocks and anchors.
 * This adapter deliberately avoids inferred slots, campaign recipes and AI.
 * Every member of a block receives the same uniform transform.
 */
import type { FreeformConfig, FreeformElement } from "./freeform";

type Box = { x: number; y: number; w: number; h: number };

const round = (n: number) => Math.round(n * 100) / 100;
const union = (items: FreeformElement[]): Box => {
  const x0 = Math.min(...items.map((e) => e.x));
  const y0 = Math.min(...items.map((e) => e.y));
  const x1 = Math.max(...items.map((e) => e.x + e.w));
  const y1 = Math.max(...items.map((e) => e.y + e.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

function familyForTarget(width: number, height: number): NonNullable<FreeformConfig["masterFamily"]> {
  const ratio = width / height;
  if (ratio <= 0.55) return "slim-portrait";
  if (ratio < 0.82) return "portrait";
  if (ratio >= 2.75) return "slim-landscape";
  return "landscape";
}

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
  return [...pool].sort((a, b) =>
    Math.abs(Math.log((a.width / a.height) / (width / height))) - Math.abs(Math.log((b.width / b.height) / (width / height))),
  )[0];
}

function blockPosition(
  box: Box, srcW: number, srcH: number, dstW: number, dstH: number,
  scale: number, anchorX: string, anchorY: string,
): Box {
  const w = box.w * scale, h = box.h * scale;
  const left = box.x * scale, right = (srcW - box.x - box.w) * scale;
  const top = box.y * scale, bottom = (srcH - box.y - box.h) * scale;
  const x = anchorX === "right" ? dstW - right - w
    : anchorX === "center" ? dstW / 2 + (box.x + box.w / 2 - srcW / 2) * scale - w / 2
    : left;
  const y = anchorY === "bottom" ? dstH - bottom - h
    : anchorY === "center" ? dstH / 2 + (box.y + box.h / 2 - srcH / 2) * scale - h / 2
    : top;
  return { x, y, w, h };
}

export function adaptAuthoritativeConfig(
  master: FreeformConfig, srcW: number, srcH: number, dstW: number, dstH: number,
): FreeformConfig {
  if (srcW === dstW && srcH === dstH) return JSON.parse(JSON.stringify(master)) as FreeformConfig;
  const groups = new Map<string, FreeformElement[]>();
  for (const el of master.elements) {
    const key = el.layoutBlock || `item:${el.id}`;
    groups.set(key, [...(groups.get(key) ?? []), el]);
  }
  const byId = new Map<string, FreeformElement>();
  // Fit the complete source composition inside the target before applying
  // block anchors. Scaling from only the short side made a landscape master
  // wider than square targets, which is the root of the stacked-layer
  // failures this path is designed to prevent.
  const fitScale = Math.min(dstW / srcW, dstH / srcH);
  for (const members of groups.values()) {
    const source = union(members);
    const lead = members[0];
    const mode = lead.scaleMode ?? "uniform";
    const anchorX = lead.anchorX ?? "left";
    const anchorY = lead.anchorY ?? "top";
    if (mode === "fill" && anchorX === "stretch" && anchorY === "stretch") {
      for (const el of members) {
        if (members.length === 1) byId.set(el.id, { ...el, x: 0, y: 0, w: dstW, h: dstH });
        else {
          const sx = dstW / srcW, sy = dstH / srcH;
          byId.set(el.id, { ...el, x: round(el.x * sx), y: round(el.y * sy), w: round(el.w * sx), h: round(el.h * sy) });
        }
      }
      continue;
    }
    const scale = mode === "fixed" ? 1 : fitScale;
    const target = blockPosition(source, srcW, srcH, dstW, dstH, scale, anchorX, anchorY);
    for (const el of members) {
      const next: FreeformElement = {
        ...el,
        x: round(target.x + (el.x - source.x) * scale),
        y: round(target.y + (el.y - source.y) * scale),
        w: Math.max(1, round(el.w * scale)),
        h: Math.max(1, round(el.h * scale)),
        ...(el.type === "text" ? { fontSize: Math.max(6, round(el.fontSize * scale)), ...(el.letterSpacing !== undefined ? { letterSpacing: round(el.letterSpacing * scale) } : {}) } : {}),
      } as FreeformElement;
      byId.set(el.id, next);
    }
  }
  return {
    ...master,
    elements: master.elements.map((e) => byId.get(e.id) ?? e),
    adaptMethod: "indesign-authoritative",
    adaptNotes: [
      `Built from the registered ${master.masterFamily ?? "InDesign"} master using its exported block anchors.`,
      "All artwork blocks were scaled uniformly. Generic layout recipes and AI repositioning were bypassed.",
    ],
  };
}
