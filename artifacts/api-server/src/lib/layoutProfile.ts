/**
 * Campaign layout profiles, learned from the artwork.
 *
 * A campaign arrives as a few shipped sizes. Each one is a complete statement
 * of how the family lays out at that shape: where the photo zone ends, how
 * tall the headline runs against the short side, how the sub-line sits under
 * it, where the car goes, how the panel column stacks. This module measures
 * those numbers off every supplied master, combines them into one profile,
 * and hands the profile to the adapter as a style schema — the same shape
 * the hand-written Get Ready schema has, so nothing downstream changes.
 *
 * Measured classes are marked measured; the rest are interpolated from the
 * nearest measured axis and say so, so a designer knows which sizes rest on
 * evidence and which on the family rule.
 */
import { db, templatesTable, layoutProfilesTable } from "@workspace/db";
import { eq, inArray, desc, sql } from "drizzle-orm";
import { normalizeFreeformConfig, type FreeformConfig, type FreeformElement } from "./freeform";
import { classifyFormat, type FormatClass } from "./formatCatalog";
import { inferSlots } from "./slots";
import { RECIPES } from "./recipes";
import { styleSchemaFor, PART_RULE_SLOTS, type StyleSchema, type DisplayAxisRule, type ZoneRule, type PartRule, type PartRules, type PartRuleSlot } from "./styleSpecs/getReadyBurst2";

type Axis = "stacked" | "side";
interface Box { x: number; y: number; w: number; h: number }

export interface GeometryBox extends Box {
  /** Font size divided by the canvas short side, for live text only. */
  fontSize?: number;
  /** Original artwork aspect, used to keep image layers proportional. */
  aspect: number;
  /** Which canvas edges this part deliberately touches. */
  edges: Array<"left" | "right" | "top" | "bottom">;
}

export interface GeometryMaster {
  templateId: number;
  name: string;
  width: number;
  height: number;
  aspect: number;
  formatClass: FormatClass;
  mode: "panel" | "free";
  /** Stable semantic keys, such as headline:0, photo:0 and image:decoration:1. */
  elements: Record<string, GeometryBox>;
}

export interface AxisMeasurement extends DisplayAxisRule {
  /** Photo zone share along the split axis. */
  photoFrac: number;
  /** Band thickness as a fraction of the canvas height. */
  bandFrac: number;
  /** Copy-to-cut-out relationship: last line bottom minus cut-out top, as a fraction of the line height. */
  copyOverCutoutFrac: number | null;
  /** Headline width as a fraction of the photo zone width. */
  headlineW: number;
  /** CTA size in px and the canvas short side it was measured on. */
  ctaPx: { w: number; h: number } | null;
  short: number;
  hasScrim: boolean;
  scrimH: number | null;
}

export interface MasterMeasurement {
  templateId: number;
  name: string;
  width: number;
  height: number;
  axis: Axis;
  formatClass: FormatClass;
  m: AxisMeasurement;
  missing: string[];
  geometry: GeometryMaster;
  mode: "panel" | "free";
}

export interface LayoutProfile {
  version: 1 | 2;
  name: string;
  sources: Array<{ templateId: number; name: string; width: number; height: number; axis: Axis; formatClass: FormatClass }>;
  zones: Record<FormatClass, ZoneRule & { measured: boolean }>;
  display: { stacked?: DisplayAxisRule; side?: DisplayAxisRule };
  measuredAxes: Axis[];
  cta: { fixedPx?: { w: number; h: number }; fixedShortRange?: [number, number] };
  copyOverCutoutFrac: number | null;
  notes: string[];
  /** Designer-set behaviour rules per part; absent = defaults from the measurements. */
  rules?: Partial<Record<PartRuleSlot, PartRules>>;
  /** Measured layer boxes from every supplied key visual. Version 2+. */
  geometryMasters?: GeometryMaster[];
}

/** The rules the measurements imply, before a designer touches them. */
export function defaultRules(profile: Pick<LayoutProfile, "cta" | "display">): Record<PartRuleSlot, PartRules> {
  return {
    headline: { pin: "measured", size: "measured", aspect: "locked", dropWhenTight: false, minPx: 24, neverOverlap: ["lockup", "cta"] },
    subheadline: { pin: "measured", size: "measured", aspect: "locked", dropWhenTight: true, minPx: 10, neverOverlap: ["lockup", "cta"] },
    cutout: { pin: "on-copy", size: "measured", aspect: "locked", dropWhenTight: true, neverOverlap: [] },
    band: { pin: "panel-edge", size: "fit-width", aspect: "locked", dropWhenTight: true, neverOverlap: ["lockup", "logo"] },
    message: { pin: "measured", size: "measured", aspect: "locked", dropWhenTight: true, minPx: 11, neverOverlap: ["cta", "lockup"] },
    cta: { pin: "measured", size: profile.cta.fixedPx ? "fixed" : "scale", aspect: "locked", dropWhenTight: false, minPx: 24, neverOverlap: ["lockup", "message"] },
    lockup: { pin: "measured", size: "measured", aspect: "locked", dropWhenTight: false, minPx: 16, neverOverlap: ["band", "cta"] },
    logo: { pin: "bottom", size: "measured", aspect: "locked", dropWhenTight: false, minPx: 24, neverOverlap: ["band", "cutout"] },
    photo: { pin: "measured", size: "scale", aspect: "free", dropWhenTight: false, neverOverlap: [] },
  };
}

/** Merge designer edits over the defaults, dropping anything that is not a known rule. */
export function mergeRules(profile: Pick<LayoutProfile, "cta" | "display" | "rules">, edits: unknown): Record<PartRuleSlot, PartRules> {
  const base = { ...defaultRules(profile), ...(profile.rules ?? {}) } as Record<PartRuleSlot, PartRules>;
  if (typeof edits !== "object" || edits === null) return base;
  const PIN = new Set(["measured", "top", "centre", "bottom", "on-copy", "zone-bottom", "panel-edge", "none"]);
  const SIZE = new Set(["measured", "fixed", "fit-width", "scale"]);
  for (const slot of PART_RULE_SLOTS) {
    const e = (edits as Record<string, unknown>)[slot];
    if (typeof e !== "object" || e === null) continue;
    const r = e as Record<string, unknown>;
    const cur = { ...base[slot] };
    if (typeof r.pin === "string" && PIN.has(r.pin)) cur.pin = r.pin as PartRules["pin"];
    if (typeof r.size === "string" && SIZE.has(r.size)) cur.size = r.size as PartRules["size"];
    if (r.aspect === "locked" || r.aspect === "free") cur.aspect = r.aspect;
    if (typeof r.dropWhenTight === "boolean") cur.dropWhenTight = r.dropWhenTight;
    if (typeof r.minPx === "number" && Number.isFinite(r.minPx)) cur.minPx = Math.max(0, Math.min(2000, Math.round(r.minPx)));
    if (Array.isArray(r.neverOverlap)) cur.neverOverlap = (r.neverOverlap as unknown[]).filter((v): v is string => typeof v === "string" && (PART_RULE_SLOTS as readonly string[]).includes(v));
    base[slot] = cur;
  }
  return base;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function byRole(config: FreeformConfig, role: string): FreeformElement | undefined {
  return config.elements.find((e) => e.slot === role || (e.type === "text" && e.role === role) || (e.type === "image" && e.role === role && role === "logo"));
}
function allByRole(config: FreeformConfig, role: string): FreeformElement[] {
  return config.elements.filter((e) => e.slot === role || (e.type === "text" && e.role === role));
}
const box = (e: FreeformElement): Box => ({ x: e.x, y: e.y, w: e.w, h: e.h });

function geometryKeyed(config: FreeformConfig, W: number, H: number): Record<string, GeometryBox> {
  const semantic = inferSlots(config, W, H);
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
  const out: Record<string, GeometryBox> = {};
  for (const [slot, elements] of groups) {
    elements.sort((a, b) => a.y - b.y || a.x - b.x || b.w * b.h - a.w * a.h);
    elements.forEach((e, index) => {
      const toleranceX = Math.max(2, W * 0.012);
      const toleranceY = Math.max(2, H * 0.012);
      const edges: GeometryBox["edges"] = [];
      if (e.x <= toleranceX) edges.push("left");
      if (e.x + e.w >= W - toleranceX) edges.push("right");
      if (e.y <= toleranceY) edges.push("top");
      if (e.y + e.h >= H - toleranceY) edges.push("bottom");
      out[`${slot}:${index}`] = {
        x: r3(e.x / W), y: r3(e.y / H), w: r3(e.w / W), h: r3(e.h / H),
        aspect: r3(e.w / Math.max(1, e.h)), edges,
        ...(e.type === "text" ? { fontSize: r3(e.fontSize / Math.min(W, H)) } : {}),
      };
    });
  }
  return out;
}

function geometryMaster(config: FreeformConfig, W: number, H: number, name: string, templateId: number, mode: GeometryMaster["mode"]): GeometryMaster {
  return { templateId, name, width: W, height: H, aspect: W / H, formatClass: classifyFormat(W, H, { name }), mode, elements: geometryKeyed(config, W, H) };
}

/**
 * Measure one master. A recognised headline is required. Panel campaigns keep
 * their existing zone measurements; free-form key visuals are measured by
 * semantic layer and do not need an invented panel.
 */
export function measureMaster(config: FreeformConfig, W: number, H: number, name: string, templateId: number): MasterMeasurement | null {
  const semantic = inferSlots(config, W, H);
  const measuredConfig: FreeformConfig = { ...config, elements: semantic.elements };
  const panel = byRole(measuredConfig, "panel");
  const headlineParts = allByRole(measuredConfig, "headline");
  if (headlineParts.length === 0) return null;
  const panelAxis: Axis | null = panel
    ? panel.w >= W * 0.9 && panel.y > H * 0.2
      ? "stacked"
      : panel.h >= H * 0.9 && panel.x > W * 0.2
        ? "side"
        : null
    : null;
  const axis: Axis = panelAxis ?? (W / H >= 1.12 ? "side" : "stacked");
  const mode: MasterMeasurement["mode"] = panelAxis ? "panel" : "free";
  const fallbackPhotoFrac = axis === "stacked" ? 0.58 : 0.56;
  const split = panelAxis && panel
    ? (axis === "stacked" ? panel.y : panel.x)
    : (axis === "stacked" ? H * fallbackPhotoFrac : W * fallbackPhotoFrac);
  const photoZone: Box = axis === "stacked" ? { x: 0, y: 0, w: W, h: split } : { x: 0, y: 0, w: split, h: H };
  const panelZone: Box = axis === "stacked" ? { x: 0, y: split, w: W, h: H - split } : { x: split, y: 0, w: W - split, h: H };
  const short = Math.min(W, H);
  const missing: string[] = [];

  const hx0 = Math.min(...headlineParts.map((e) => e.x)), hy0 = Math.min(...headlineParts.map((e) => e.y));
  const hl: Box = { x: hx0, y: hy0, w: Math.max(...headlineParts.map((e) => e.x + e.w)) - hx0, h: Math.max(...headlineParts.map((e) => e.y + e.h)) - hy0 };
  const sub = byRole(measuredConfig, "subheadline");
  const cutout = allByRole(measuredConfig, "cutout").sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const band = byRole(measuredConfig, "band");
  const message = byRole(measuredConfig, "message");
  const cta = byRole(measuredConfig, "cta");
  const lockup = byRole(measuredConfig, "lockup") ?? byRole(measuredConfig, "logo");
  const scrim = byRole(measuredConfig, "scrim");
  for (const [k, v] of [["sub-line", sub], ["cut-out", cutout], ["band", band], ["message", message], ["CTA", cta], ["lockup", lockup]] as const) if (!v) missing.push(k);

  const copyBottom = sub ? Math.max(hl.y + hl.h, sub.y + sub.h) : hl.y + hl.h;
  const lastLineH = sub ? sub.h : hl.h;
  const m: AxisMeasurement = {
    photoFrac: r3(axis === "stacked" ? split / H : split / W),
    bandFrac: r3(band ? band.h / H : 0),
    bandH: r3(band ? band.h / panelZone.h : 0),
    headlineH: r3(hl.h / short),
    headlineCy: r3((hl.y + hl.h / 2 - photoZone.y) / photoZone.h),
    headlineW: r3(hl.w / photoZone.w),
    subW: r3(sub ? sub.w / hl.w : 0.9),
    subH: r3(sub ? sub.h / hl.h : 0.45),
    subGap: r3(sub ? (sub.y - (hl.y + hl.h)) / hl.h : 0.07),
    cutoutW: r3(cutout ? cutout.w / photoZone.w : 0),
    cutoutCx: r3(cutout ? (cutout.x + cutout.w / 2 - photoZone.x) / photoZone.w : 0.5),
    // A car that reaches the zone's bottom edge in the master is bottom-
    // anchored: whatever of it falls below the zone (its water, its shadow)
    // hides under the panel, so a rebuilt size may let it run past by up to
    // 60% of its height. A car floating clear of the edge keeps to the zone.
    cutoutBleed: r3(cutout ? (cutout.y + cutout.h >= photoZone.y + photoZone.h - photoZone.h * 0.02 ? 0.6 : 0.06) : 0),
    copyOverCutoutFrac: cutout ? r3((copyBottom - cutout.y) / Math.max(1, lastLineH)) : null,
    message: { cy: r3(message ? (message.y + message.h / 2 - panelZone.y) / panelZone.h : 0.36), w: r3(message ? message.w / panelZone.w : 0.7) },
    cta: { cy: r3(cta ? (cta.y + cta.h / 2 - panelZone.y) / panelZone.h : 0.55) },
    lockup: { cy: r3(lockup ? (lockup.y + lockup.h / 2 - panelZone.y) / panelZone.h : 0.82), w: r3(lockup ? lockup.w / panelZone.w : 0.7) },
    ctaPx: cta ? { w: Math.round(cta.w), h: Math.round(cta.h) } : null,
    short,
    hasScrim: !!scrim,
    scrimH: scrim ? r3(scrim.h / photoZone.h) : null,
  };
  return { templateId, name, width: W, height: H, axis, formatClass: classifyFormat(W, H, { name }), m, missing, geometry: geometryMaster(measuredConfig, W, H, name, templateId, mode), mode };
}

const STACKED_CLASSES: FormatClass[] = ["portrait", "tower", "square"];
const SIDE_CLASSES: FormatClass[] = ["wide", "landscape"];

function averageAxis(ms: AxisMeasurement[]): AxisMeasurement {
  const n = ms.length;
  const avg = (f: (m: AxisMeasurement) => number) => r3(ms.reduce((a, m) => a + f(m), 0) / n);
  const cutouts = ms.filter((m) => m.cutoutW > 0);
  const avgC = (f: (m: AxisMeasurement) => number, fallback: number) => (cutouts.length ? r3(cutouts.reduce((a, m) => a + f(m), 0) / cutouts.length) : fallback);
  const overs = ms.map((m) => m.copyOverCutoutFrac).filter((v): v is number => v != null);
  return {
    photoFrac: avg((m) => m.photoFrac),
    bandFrac: avg((m) => m.bandFrac),
    bandH: avg((m) => m.bandH),
    headlineH: avg((m) => m.headlineH),
    headlineCy: avg((m) => m.headlineCy),
    headlineW: avg((m) => m.headlineW),
    subW: avg((m) => m.subW),
    subH: avg((m) => m.subH),
    subGap: avg((m) => m.subGap),
    cutoutW: avgC((m) => m.cutoutW, 0),
    cutoutCx: avgC((m) => m.cutoutCx, 0.5),
    cutoutBleed: avgC((m) => m.cutoutBleed, 0.06),
    copyOverCutoutFrac: overs.length ? r3(overs.reduce((a, v) => a + v, 0) / overs.length) : null,
    message: { cy: avg((m) => m.message.cy), w: avg((m) => m.message.w) },
    cta: { cy: avg((m) => m.cta.cy) },
    lockup: { cy: avg((m) => m.lockup.cy), w: avg((m) => m.lockup.w) },
    ctaPx: ms[0].ctaPx,
    short: Math.round(ms.reduce((a, m) => a + m.short, 0) / n),
    hasScrim: ms.some((m) => m.hasScrim),
    scrimH: ms.find((m) => m.scrimH != null)?.scrimH ?? null,
  };
}

/** Combine measured masters into one profile. */
export function buildProfile(measurements: MasterMeasurement[], name: string): LayoutProfile {
  const notes: string[] = [];
  const stacked = measurements.filter((x) => x.axis === "stacked").map((x) => x.m);
  const side = measurements.filter((x) => x.axis === "side").map((x) => x.m);
  const sAvg = stacked.length ? averageAxis(stacked) : null;
  const dAvg = side.length ? averageAxis(side) : null;
  const measuredClasses = new Set(measurements.map((x) => x.formatClass));
  const zones = {} as LayoutProfile["zones"];
  // An axis nobody measured keeps the class recipe's calibrated numbers. A
  // band is 5.9% of a portrait's height and 16.9% of a wide's: borrowing
  // one axis's share for the other gave wides a hairline band and portraits
  // a band so deep the message no longer fitted.
  for (const cls of STACKED_CLASSES) {
    zones[cls] = { axis: "stacked", photoFrac: sAvg ? sAvg.photoFrac : RECIPES[cls].photoFrac, displayPhotoFrac: sAvg ? sAvg.photoFrac : undefined, bandFrac: sAvg ? sAvg.bandFrac : RECIPES[cls].bandFrac, bandAt: "seam", tolerance: measuredClasses.has(cls) ? 0.03 : 0.05, measured: measuredClasses.has(cls) };
  }
  for (const cls of SIDE_CLASSES) {
    zones[cls] = { axis: "side", photoFrac: dAvg ? dAvg.photoFrac : RECIPES[cls].photoFrac, displayPhotoFrac: dAvg ? dAvg.photoFrac : undefined, bandFrac: dAvg ? dAvg.bandFrac : RECIPES[cls].bandFrac, bandAt: "panelTop", tolerance: measuredClasses.has(cls) ? 0.03 : 0.05, measured: measuredClasses.has(cls) };
  }
  zones.strip = { axis: "row", photoFrac: 0.3, bandFrac: 0, bandAt: "none", tolerance: 0.05, measured: measuredClasses.has("strip") };

  const display: LayoutProfile["display"] = {};
  if (sAvg) display.stacked = stripAxis(sAvg);
  if (dAvg) display.side = stripAxis(dAvg);

  // A CTA that is the same pixel size on every measured master is a placed
  // asset, not a scaled one — but only at the scale it was measured on.
  const ctaSizes = measurements.map((x) => x.m.ctaPx).filter((c): c is { w: number; h: number } => !!c);
  const cta: LayoutProfile["cta"] = {};
  if (ctaSizes.length >= 1) {
    const same = ctaSizes.every((c) => Math.abs(c.w - ctaSizes[0].w) <= 3 && Math.abs(c.h - ctaSizes[0].h) <= 3);
    if (same) {
      const shorts = measurements.filter((x) => x.m.ctaPx).map((x) => x.m.short);
      cta.fixedPx = { w: Math.round(ctaSizes.reduce((a, c) => a + c.w, 0) / ctaSizes.length), h: Math.round(ctaSizes.reduce((a, c) => a + c.h, 0) / ctaSizes.length) };
      cta.fixedShortRange = [Math.min(...shorts), Math.max(...shorts)];
      notes.push(`Button is a fixed ${cta.fixedPx.w}×${cta.fixedPx.h}px asset on canvases whose short side is ${cta.fixedShortRange[0]}–${cta.fixedShortRange[1]}px; it scales elsewhere.`);
    }
  }
  const overs = measurements.map((x) => x.m.copyOverCutoutFrac).filter((v): v is number => v != null);
  const copyOverCutoutFrac = overs.length ? r3(overs.reduce((a, v) => a + v, 0) / overs.length) : null;

  const measuredAxes: Axis[] = [];
  if (sAvg) measuredAxes.push("stacked");
  if (dAvg) measuredAxes.push("side");
  const measuredList = [...measuredClasses].join(", ");
  const interpolated = (Object.keys(zones) as FormatClass[]).filter((c) => !zones[c].measured).join(", ");
  notes.unshift(`Measured from ${measurements.length} example${measurements.length === 1 ? "" : "s"} (${measuredList}); interpolated: ${interpolated || "none"}.`);
  if (measurements.some((x) => x.mode === "free")) notes.push("Free-form key visual geometry measured by semantic layer, no panel required. Images remain proportional and live text keeps editable boxes.");
  if (!sAvg) notes.push("No stacked (tall) example: portrait, tower and square sizes use the family defaults until one is supplied.");
  if (!dAvg) notes.push("No side (wide) example: wide and landscape sizes use the family defaults until one is supplied.");
  for (const x of measurements) if (x.missing.length) notes.push(`${x.name}: no ${x.missing.join(", ")} layer recognised.`);

  return { version: 2, name, sources: measurements.map((x) => ({ templateId: x.templateId, name: x.name, width: x.width, height: x.height, axis: x.axis, formatClass: x.formatClass })), zones, display, measuredAxes, cta, copyOverCutoutFrac, notes, geometryMasters: measurements.map((x) => x.geometry) };
}

function stripAxis(m: AxisMeasurement): DisplayAxisRule {
  return { headlineH: m.headlineH, headlineCy: m.headlineCy, subW: m.subW, subH: m.subH, subGap: m.subGap, cutoutW: m.cutoutW, cutoutCx: m.cutoutCx, cutoutBleed: m.cutoutBleed, message: m.message, cta: m.cta, lockup: m.lockup, bandH: m.bandH };
}

/** The profile as the style schema the adapter and the reviewer read. */
export function profileToStyleSchema(profile: LayoutProfile, id: number): StyleSchema {
  const parts: Record<string, PartRule> = {
    headline: {
      role: "headline", zone: "photo", size: { ofShort: profile.display.stacked?.headlineH ?? profile.display.side?.headlineH ?? 0.19 },
      anchor: { y: profile.display.stacked?.headlineCy ?? 0.45, align: "center" }, floorPx: 24,
      display: { stacked: profile.display.stacked?.headlineH ?? 0.19, side: profile.display.side?.headlineH ?? 0.38 },
      rule: `Headline height ${Math.round((profile.display.stacked?.headlineH ?? 0.19) * 100)}% of the short side on stacked layouts, ${Math.round((profile.display.side?.headlineH ?? 0.38) * 100)}% on side layouts; block centre at ${Math.round((profile.display.stacked?.headlineCy ?? 0.45) * 100)}% / ${Math.round((profile.display.side?.headlineCy ?? 0.36) * 100)}% of the photo zone (measured).`,
    },
    subheadline: { role: "subheadline", zone: "photo", size: { ofHeadline: profile.display.stacked?.subH ?? 0.45 }, anchor: { align: "center" }, rule: "Sub-line set at the measured share of the headline, directly under it." },
    cutout: { role: "cutout", zone: "photo", size: { ofZoneW: profile.display.stacked?.cutoutW ?? 0.8 }, anchor: { y: 1 }, rule: `Cut-out at ${Math.round((profile.display.stacked?.cutoutW ?? 0.8) * 100)}% of the zone width (stacked) / ${Math.round((profile.display.side?.cutoutW ?? 0.47) * 100)}% (side), on the copy's last line as measured.` },
    message: { role: "message", zone: "panel", size: { ofZoneW: profile.display.stacked?.message.w ?? 0.7 }, anchor: { y: profile.display.stacked?.message.cy ?? 0.36, align: "center" }, floorPx: 11, rule: "Message centred in the panel column at the measured height." },
    cta: { role: "cta", zone: "panel", size: { ofZoneW: 0.6 }, anchor: { y: profile.display.stacked?.cta.cy ?? 0.55, align: "center" }, floorPx: 24, ...(profile.cta.fixedPx ? { fixedPx: profile.cta.fixedPx, fixedShortRange: profile.cta.fixedShortRange } : {}), rule: profile.cta.fixedPx ? `Button is a fixed ${profile.cta.fixedPx.w}×${profile.cta.fixedPx.h}px asset at the measured scale.` : "Button scales with the panel." },
    lockup: { role: "lockup", zone: "panel", size: { ofZoneW: profile.display.stacked?.lockup.w ?? 0.7 }, anchor: { y: profile.display.stacked?.lockup.cy ?? 0.82, align: "center" }, rule: "Lockup last in the panel column at the measured height." },
    band: { role: "band", zone: "seam", size: { ofZoneW: 1 }, anchor: {}, droppedWhen: "strips", rule: "Band on the panel's outer edge, full zone width." },
    photo: { role: "photo", zone: "photo", size: { ofZoneW: 1, ofZoneH: 1 }, anchor: {}, rule: "Covers its zone; the master's framing is kept on same-axis builds." },
  };
  const zones = {} as Record<FormatClass, ZoneRule>;
  // Profiles stored before the fix above carry the borrowed numbers: an
  // unmeasured axis reads the named campaign schema when the profile's name
  // matches one, else the class recipe.
  const named = styleSchemaFor(profile.name);
  for (const k of Object.keys(profile.zones) as FormatClass[]) {
    const { measured: _m, ...z } = profile.zones[k];
    const axisMeasured = z.axis === "row" || profile.measuredAxes.includes(z.axis as Axis);
    zones[k] = axisMeasured ? z : named?.zones[k] ?? { ...z, photoFrac: RECIPES[k].photoFrac, displayPhotoFrac: undefined, bandFrac: RECIPES[k].bandFrac };
  }
  return {
    id: `profile-${id}`,
    name: profile.name,
    match: [],
    colours: {},
    type: {},
    hierarchy: ["headline", "subheadline", "message", "cta", "lockup"],
    zones,
    display: { stacked: profile.display.stacked ?? DEFAULT_STACKED, side: profile.display.side ?? DEFAULT_SIDE },
    alwaysDisplay: true,
    parts,
    variants: [],
    never: [],
    sizes: [],
    references: profile.sources.map((s) => `${s.name} (${s.width}×${s.height})`),
    ...(profile.copyOverCutoutFrac != null ? { copyOverCutoutFrac: profile.copyOverCutoutFrac } : {}),
    partRules: mergeRules(profile, null),
  };
}

/** Save designer edits to a profile's rules. */
export async function updateProfileRules(id: number, edits: unknown): Promise<StoredProfile | null> {
  const p = await getProfile(id);
  if (!p) return null;
  const rules = mergeRules(p.profile, edits);
  const profile: LayoutProfile = { ...p.profile, rules };
  const [saved] = await db.update(layoutProfilesTable).set({ profile: JSON.stringify(profile), updatedAt: new Date() }).where(eq(layoutProfilesTable.id, id)).returning();
  return parseRow(saved);
}

const DEFAULT_STACKED: DisplayAxisRule = { headlineH: 0.193, headlineCy: 0.422, subW: 0.986, subH: 0.517, subGap: 0.069, cutoutW: 0.8, cutoutCx: 0.41, cutoutBleed: 0.45, message: { cy: 0.36, w: 0.73 }, cta: { cy: 0.55 }, lockup: { cy: 0.82, w: 0.7 }, bandH: 0.147 };
const DEFAULT_SIDE: DisplayAxisRule = { headlineH: 0.396, headlineCy: 0.266, subW: 0.874, subH: 0.404, subGap: 0.07, cutoutW: 0.467, cutoutCx: 0.419, cutoutBleed: 0.6, message: { cy: 0.378, w: 0.7 }, cta: { cy: 0.562 }, lockup: { cy: 0.838, w: 0.7 }, bandH: 0.152 };

// ---------------------------------------------------------------------------
// Persistence

export interface StoredProfile { id: number; name: string; sourceKey: string; profile: LayoutProfile; updatedAt: Date }

function parseRow(row: typeof layoutProfilesTable.$inferSelect): StoredProfile {
  let profile: LayoutProfile;
  try { profile = JSON.parse(row.profile) as LayoutProfile; } catch { profile = buildProfile([], row.name); }
  return { id: row.id, name: row.name, sourceKey: row.sourceKey, profile, updatedAt: row.updatedAt };
}

/** Measure the given masters and store (or refresh) their profile. */
export async function learnProfile(masterIds: number[], name?: string | null, createdBy?: string | null): Promise<{ stored: StoredProfile; skipped: string[] } | null> {
  const ids = [...new Set(masterIds.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  if (ids.length === 0) return null;
  const rows = await db.select().from(templatesTable).where(inArray(templatesTable.id, ids));
  const measurements: MasterMeasurement[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    let parsed: unknown;
    try { parsed = JSON.parse(row.config || "{}"); } catch { parsed = {}; }
    const cfg = normalizeFreeformConfig(parsed);
    const m = measureMaster(cfg, row.width, row.height, row.name, row.id);
    if (m) measurements.push(m);
    else skipped.push(`${row.name}: no headline recognised, not measured`);
  }
  if (measurements.length === 0) return null;
  const profileName = (name ?? "").trim() || campaignNameFrom(measurements.map((m) => m.name));
  const profile = buildProfile(measurements, profileName);
  let sourceKey = measurements.map((m) => m.templateId).sort((a, b) => a - b).join(",");
  let [existing] = await db.select().from(layoutProfilesTable).where(eq(layoutProfilesTable.sourceKey, sourceKey));
  // A re-import of the same folder gives the masters new ids. Rather than
  // spawning a fresh default profile that would outrank the one carrying
  // the designer's rule edits, re-learn INTO the campaign's existing
  // profile (same name) and widen its source key to the new masters.
  if (!existing) {
    const sameName = (await db.select().from(layoutProfilesTable).where(sql`lower(${layoutProfilesTable.name}) = ${profileName.toLowerCase()}`).orderBy(desc(layoutProfilesTable.updatedAt)).limit(1))[0];
    if (sameName) {
      existing = sameName;
      const prevIds = sameName.sourceKey.split(",").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
      sourceKey = [...new Set([...prevIds, ...ids])].sort((a, b) => a - b).join(",");
    }
  }
  let saved: typeof layoutProfilesTable.$inferSelect;
  if (existing) {
    // Re-measuring keeps the designer's rule edits.
    try { const prev = JSON.parse(existing.profile) as LayoutProfile; if (prev.rules) profile.rules = prev.rules; } catch { /* fresh rules */ }
    [saved] = await db.update(layoutProfilesTable).set({ name: profileName, sourceKey, profile: JSON.stringify(profile), updatedAt: new Date() }).where(eq(layoutProfilesTable.id, existing.id)).returning();
  } else {
    [saved] = await db.insert(layoutProfilesTable).values({ name: profileName, sourceKey, profile: JSON.stringify(profile), createdBy: createdBy ?? null }).returning();
  }
  return { stored: parseRow(saved), skipped };
}

/** A campaign name from the masters' names: the longest common prefix, tidied. */
export function campaignNameFrom(names: string[]): string {
  if (names.length === 0) return "Campaign";
  let prefix = names[0];
  for (const n of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < n.length && prefix[i].toLowerCase() === n[i].toLowerCase()) i++;
    prefix = prefix.slice(0, i);
  }
  const tidy = prefix.replace(/[\s_\-—–:]+$/g, "").replace(/\s{2,}/g, " ").trim();
  return tidy.length >= 4 ? tidy : names[0].split(/ — /)[0].trim() || "Campaign";
}

export async function listProfiles(): Promise<StoredProfile[]> {
  const rows = await db.select().from(layoutProfilesTable).orderBy(desc(layoutProfilesTable.updatedAt));
  return rows.map(parseRow);
}

export async function getProfile(id: number): Promise<StoredProfile | null> {
  const [row] = await db.select().from(layoutProfilesTable).where(eq(layoutProfilesTable.id, id));
  return row ? parseRow(row) : null;
}

export async function deleteProfile(id: number): Promise<boolean> {
  const rows = await db.delete(layoutProfilesTable).where(eq(layoutProfilesTable.id, id)).returning({ id: layoutProfilesTable.id });
  return rows.length > 0;
}

/** The newest profile that was measured from this master (or its own master). */
export async function profileForMaster(masterId: number, sourceTemplateId?: number | null): Promise<StoredProfile | null> {
  const ids = [masterId, ...(sourceTemplateId ? [sourceTemplateId] : [])];
  const rows = await db
    .select()
    .from(layoutProfilesTable)
    .where(sql`string_to_array(${layoutProfilesTable.sourceKey}, ',')::int[] && ${sql.raw(`ARRAY[${ids.map((n) => Number(n)).join(",")}]::int[]`)}`)
    .orderBy(desc(layoutProfilesTable.updatedAt))
    .limit(1);
  return rows[0] ? parseRow(rows[0]) : null;
}

export interface ResolvedStyle { schema: StyleSchema | null; source: "profile" | "builtin" | "none"; profileId?: number; label: string; profile?: LayoutProfile }

/**
 * The style schema for a build: an explicit profile, else the newest profile
 * measured from this master, else the hand-written schema matched by name.
 */
export async function resolveStyleSchema(opts: { masterId: number; masterName: string; sourceTemplateId?: number | null; profileId?: number | null }): Promise<ResolvedStyle> {
  if (opts.profileId) {
    const p = await getProfile(opts.profileId);
    if (p) return { schema: profileToStyleSchema(p.profile, p.id), source: "profile", profileId: p.id, label: `${p.name} (measured profile)`, profile: p.profile };
  }
  try {
    const p = await profileForMaster(opts.masterId, opts.sourceTemplateId);
    if (p) return { schema: profileToStyleSchema(p.profile, p.id), source: "profile", profileId: p.id, label: `${p.name} (measured profile)`, profile: p.profile };
  } catch { /* table missing on an old database: fall through */ }
  const builtin = styleSchemaFor(opts.masterName);
  if (builtin) return { schema: builtin, source: "builtin", label: `${builtin.name} (built-in schema)` };
  return { schema: null, source: "none", label: "family defaults" };
}
