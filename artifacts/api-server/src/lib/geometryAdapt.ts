/**
 * Rebuild a free-form key visual from the measured portrait and landscape
 * examples in a campaign profile. This is deliberately geometric, not an AI
 * redraw: layer order, live copy, image sources and animation tracks survive.
 * Raster artwork is never stretched.
 */
import type { FreeformConfig, FreeformElement } from "./freeform";
import { adaptFreeformConfig } from "./freeform";
import { inferSlots } from "./slots";
import { measureLine, wrapText } from "./textMeasure";
import type { GeometryBox, GeometryMaster, LayoutProfile } from "./layoutProfile";

interface KeyedElement { key: string; element: FreeformElement }

function keyElements(config: FreeformConfig, width: number, height: number): KeyedElement[] {
  const semantic = inferSlots(config, width, height);
  const groups = new Map<string, FreeformElement[]>();
  for (const e of semantic.elements) {
    const slot = e.slot && e.slot !== "other"
      ? e.slot
      : e.type === "image"
        ? `image:${e.role}`
        : e.type === "text"
          ? `text:${e.role}`
          : "rect:other";
    groups.set(slot, [...(groups.get(slot) ?? []), e]);
  }
  const keyed: KeyedElement[] = [];
  for (const [slot, elements] of groups) {
    elements.sort((a, b) => a.y - b.y || a.x - b.x || b.w * b.h - a.w * a.h);
    elements.forEach((element, index) => keyed.push({ key: `${slot}:${index}`, element }));
  }
  return keyed;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function interpolate(a: GeometryBox, b: GeometryBox, t: number): GeometryBox {
  const edges = (["left", "right", "top", "bottom"] as const).filter((edge) => a.edges.includes(edge) && b.edges.includes(edge));
  return {
    x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t),
    aspect: lerp(a.aspect, b.aspect, t), edges,
    ...(a.fontSize != null || b.fontSize != null ? { fontSize: lerp(a.fontSize ?? b.fontSize!, b.fontSize ?? a.fontSize!, t) } : {}),
  };
}

function bracket(masters: GeometryMaster[], aspect: number): { a: GeometryMaster; b: GeometryMaster; t: number; outside: boolean } {
  const sorted = [...masters].sort((a, b) => Math.log(a.aspect) - Math.log(b.aspect));
  const target = Math.log(aspect);
  if (target <= Math.log(sorted[0].aspect)) return { a: sorted[0], b: sorted[0], t: 0, outside: true };
  const last = sorted[sorted.length - 1];
  if (target >= Math.log(last.aspect)) return { a: last, b: last, t: 0, outside: true };
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = Math.log(sorted[i].aspect), hi = Math.log(sorted[i + 1].aspect);
    if (target >= lo && target <= hi) return { a: sorted[i], b: sorted[i + 1], t: (target - lo) / Math.max(0.0001, hi - lo), outside: false };
  }
  return { a: last, b: last, t: 0, outside: true };
}

function targetBox(a: GeometryMaster, b: GeometryMaster, key: string, t: number): GeometryBox | null {
  const x = a.elements[key], y = b.elements[key];
  if (x && y) return interpolate(x, y, t);
  return x ?? y ?? null;
}

function fitText(el: Extract<FreeformElement, { type: "text" }>, proposed: number, width: number, height: number): number {
  const floor = el.slot === "headline" || el.role === "headline" ? 12 : 8;
  let size = Math.max(floor, proposed);
  for (let i = 0; i < 40; i++) {
    const lines = wrapText(el.text, width, { family: el.fontFamily, weight: el.fontWeight, letterSpacing: el.letterSpacing }, size);
    const widest = Math.max(0, ...lines.map((line) => measureLine(line, { family: el.fontFamily, weight: el.fontWeight, letterSpacing: el.letterSpacing }, size)));
    const blockH = lines.length * size * (el.lineHeight ?? 1.2);
    if (widest <= width * 1.01 && blockH <= height * 1.02) break;
    size *= 0.96;
  }
  return Math.max(floor, Math.round(size * 10) / 10);
}

function placeImage(el: Extract<FreeformElement, { type: "image" }>, measured: GeometryBox, dstW: number, dstH: number): FreeformElement {
  const box = { x: measured.x * dstW, y: measured.y * dstH, w: measured.w * dstW, h: measured.h * dstH };
  const fullBleed = measured.edges.length === 4 && measured.w * measured.h > 0.65;
  if (fullBleed) return { ...el, x: 0, y: 0, w: dstW, h: dstH, fit: "cover" };

  const aspect = el.w / Math.max(1, el.h);
  let scale = Math.min(box.w / Math.max(1, el.w), box.h / Math.max(1, el.h));
  if (measured.edges.includes("left") && measured.edges.includes("right")) scale = box.w / Math.max(1, el.w);
  else if (measured.edges.includes("top") && measured.edges.includes("bottom")) scale = box.h / Math.max(1, el.h);
  const w = Math.max(1, el.w * scale), h = Math.max(1, w / aspect);
  let x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
  if (measured.edges.includes("left")) x = box.x;
  if (measured.edges.includes("right")) x = box.x + box.w - w;
  if (measured.edges.includes("top")) y = box.y;
  if (measured.edges.includes("bottom")) y = box.y + box.h - h;
  return { ...el, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), fit: el.fit ?? "contain" };
}

/** Returns null for old profiles, so the existing recipe engine continues. */
export function adaptGeometryProfile(
  master: FreeformConfig,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  profile: LayoutProfile,
): { config: FreeformConfig; notes: string[] } | null {
  const masters = profile.geometryMasters ?? [];
  if (masters.length === 0 || !masters.some((m) => m.mode === "free")) return null;
  const keyed = keyElements(master, srcW, srcH);
  if (!keyed.some(({ element }) => element.slot === "headline" || (element.type === "text" && element.role === "headline"))) return null;

  const { a, b, t, outside } = bracket(masters, dstW / dstH);
  const fallback = adaptFreeformConfig(master, srcW, srcH, dstW, dstH);
  const fallbackById = new Map(fallback.elements.map((e) => [e.id, e]));
  const short = Math.min(dstW, dstH);
  let matched = 0;
  const elements = keyed.map(({ key, element }) => {
    const measured = targetBox(a, b, key, t);
    if (!measured) return fallbackById.get(element.id) ?? element;
    matched++;
    const x = Math.round(measured.x * dstW), y = Math.round(measured.y * dstH);
    const w = Math.max(1, Math.round(measured.w * dstW)), h = Math.max(1, Math.round(measured.h * dstH));
    if (element.type === "image") return placeImage(element, measured, dstW, dstH);
    if (element.type === "text") {
      const proposed = (measured.fontSize ?? element.fontSize / Math.min(srcW, srcH)) * short;
      return { ...element, x, y, w, h, fontSize: fitText(element, proposed, w, h), ...(element.letterSpacing !== undefined ? { letterSpacing: element.letterSpacing * (short / Math.min(srcW, srcH)) } : {}) };
    }
    return { ...element, x, y, w, h };
  });
  if (matched < Math.min(3, keyed.length)) return null;
  const relation = a.templateId === b.templateId ? `nearest ${a.width}×${a.height} master` : `${a.width}×${a.height} and ${b.width}×${b.height} masters`;
  return {
    config: { ...master, elements, adaptMethod: "geometry-profile" },
    notes: [
      `Layer positions measured from the ${relation}.`,
      "Raster artwork was scaled proportionally, never stretched; live text was fitted inside its measured box.",
      ...(outside ? ["Target shape is outside the supplied portrait-to-landscape range, so the nearest master geometry was edge-anchored and flagged for review."] : []),
    ],
  };
}
