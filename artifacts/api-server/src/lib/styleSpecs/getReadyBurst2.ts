/**
 * Style schema — AEM Get Ready, Burst 2 (26-PRO-0461).
 *
 * Measured off the delivered files in "Large campaign example" on 2026-09-10:
 * the InDesign masters (384×592 and 960×256 JCDecaux, standard + SLIM), the
 * Google Web Designer working files (300×600 and 970×250 for Storms, Quakes,
 * Tsunami), the DV360 HTML5 finals and statics for all three phases (V1–V10),
 * and the collateral production sheet (every size the campaign ships in).
 *
 * Every number here is a fraction of the canvas or its short side so it
 * transfers to any size in the sheet. Nothing is invented: the schema only
 * describes parts that exist in the delivered artwork, and the adapter only
 * uses layers it has been given.
 *
 * Human-readable version with the audit notes: docs/style-specs/get-ready-burst-2.md
 */
import type { FormatClass } from "../formatCatalog";

export interface PartRule {
  /** What the part is, in studio language. */
  role: "headline" | "kicker" | "subheadline" | "message" | "cta" | "lockup" | "logo" | "band" | "photo" | "scrim" | "cutout" | "panel";
  /** Where it lives. */
  zone: "photo" | "panel" | "seam" | "canvas";
  /** Size, as fractions. `ofShort` = of the canvas short side; `ofZoneW/H` = of its zone. */
  size: { ofShort?: number; ofZoneW?: number; ofZoneH?: number; ofHeadline?: number };
  /** Vertical/horizontal anchor as a fraction of the zone (block centre). */
  anchor: { x?: number; y?: number; align?: "left" | "center" | "right" };
  /** Never below this many px (legibility floor). */
  floorPx?: number;
  /** Fixed pixel asset (display pill) — width×height when the part is a picture that must not scale. */
  fixedPx?: { w: number; h: number };
  /** Display (small-canvas) share of the short side, by layout axis — measured off the GWD files. */
  display?: { stacked: number; side: number };
  /** Dropped when the canvas can't hold it. */
  droppedWhen?: string;
  /** The exact rule in words, for the reviewer. */
  rule: string;
}

export interface ZoneRule {
  axis: "stacked" | "side" | "row";
  /** Photo zone share along the split axis. */
  photoFrac: number;
  /** The share on display-sized canvases (short side ≤ 400px), when the
   * shipped display pieces differ from OOH — 69% on the 970×250. */
  displayPhotoFrac?: number;
  /** Band thickness as a fraction of canvas height, and where it sits. */
  bandFrac: number;
  bandAt: "seam" | "panelTop" | "none";
  tolerance: number;
}

/** Display-canvas layout numbers measured off the shipped 300×600 (stacked)
 *  and 970×250 (side) pieces: fractions of the photo zone / panel zone. */
export interface DisplayAxisRule {
  /** Headline height as a fraction of the canvas short side. */
  headlineH: number;
  /** Headline block centre, fraction of the photo zone height. */
  headlineCy: number;
  /** Sub-line width and height as fractions of the headline's; gap below the headline as a fraction of headline height. */
  subW: number;
  subH: number;
  subGap: number;
  /** Cut-out width as a fraction of the photo zone width, its centre x, and how much of its height may run past the zone bottom. */
  cutoutW: number;
  cutoutCx: number;
  cutoutBleed: number;
  /** Panel column: centres as fractions of the panel zone height; widths as fractions of the panel zone width. */
  message: { cy: number; w: number };
  cta: { cy: number };
  lockup: { cy: number; w: number };
  bandH: number;
}

export interface StyleSchema {
  id: string;
  name: string;
  /** Template/brief names that select this schema (case-insensitive substrings). */
  match: string[];
  colours: Record<string, string>;
  type: Record<string, string>;
  /** Reading order — first is the most important element on the page. */
  hierarchy: string[];
  zones: Record<FormatClass, ZoneRule>;
  /** Measured display layouts by axis (see DisplayAxisRule). */
  display?: { stacked: DisplayAxisRule; side: DisplayAxisRule };
  parts: Record<string, PartRule>;
  /** Copy variants the campaign actually shipped — the only copy allowed. */
  variants: Array<{ phase: string; kicker?: string; headline: string; subheadline?: string; message: string; cta: { display: string; ooh: string } }>;
  never: string[];
  /** Sizes from the production sheet, with the class the schema applies. */
  sizes: Array<{ name: string; w: number; h: number }>;
  references: string[];
}

export const GET_READY_BURST_2: StyleSchema = {
  id: "get-ready-burst-2",
  name: "AEM Get Ready — Burst 2 (photo + panel)",
  match: ["get ready", "26-pro-0461", "aem get ready", "storms", "quakes", "tsunami"],

  colours: {
    panelOOH: "#005b9f", // InDesign panel rect
    panelDisplay: "#0060ac", // GWD panel graphic (sampled)
    scrim: "#0c253b", // gradient scrim over the photo, top 50% (tall) / 77% (wide) of the photo zone
    message: "#ffeb3d", // "Make a plan today." — Kowhai-adjacent campaign yellow
    ctaDisplay: "#fdf10e", // LEARN MORE button fill
    ctaLabelDisplay: "#0060ac",
    pillOOH: "#ffffff",
    pillLabelOOH: "#111827",
    copy: "#ffffff",
  },
  type: {
    headline: "DS-Digital (digital clock face), white, upper case with colons between letter pairs — ST:OR:MS, QU:AK:ES, TSU:NA:MI — or a HH:MM:SS countdown in Phase 2. The lettering is the campaign device, not an error.",
    kicker: "National 2 Bold, white, upper case, one line above the headline (Phases 1–2 only).",
    subheadline: "National 2 Bold, white, upper case, one line under the headline (Phase 3 and OOH).",
    message: "National 2 Bold, campaign yellow, sentence case with full stop.",
    ctaOOH: "Search pill: white pill, label National 2 Bold in ink #111827, magnifier icon at the right.",
    ctaDisplay: "LEARN MORE: yellow pill, label National 2 Bold upper case in panel blue.",
  },
  hierarchy: ["headline", "kicker/subheadline", "message", "cta", "lockup"],

  zones: {
    portrait: { axis: "stacked", photoFrac: 0.569, displayPhotoFrac: 0.568, bandFrac: 0.059, bandAt: "seam", tolerance: 0.03 },
    tower: { axis: "stacked", photoFrac: 0.52, bandFrac: 0.045, bandAt: "seam", tolerance: 0.05 },
    square: { axis: "stacked", photoFrac: 0.6, displayPhotoFrac: 0.55, bandFrac: 0.05, bandAt: "seam", tolerance: 0.05 },
    landscape: { axis: "side", photoFrac: 0.55, bandFrac: 0.15, bandAt: "panelTop", tolerance: 0.05 },
    wide: { axis: "side", photoFrac: 0.5, displayPhotoFrac: 0.69, bandFrac: 0.169, bandAt: "panelTop", tolerance: 0.05 },
    strip: { axis: "row", photoFrac: 0.3, bandFrac: 0, bandAt: "none", tolerance: 0.05 },
  },

  display: {
    // 300×600 final / working files: photo zone 0–341, panel zone 341–600.
    stacked: { headlineH: 0.193, headlineCy: 0.422, subW: 0.986, subH: 0.517, subGap: 0.069, cutoutW: 0.8, cutoutCx: 0.41, cutoutBleed: 0.45, message: { cy: 0.36, w: 0.73 }, cta: { cy: 0.55 }, lockup: { cy: 0.82, w: 0.7 }, bandH: 0.147 },
    // 970×250 working file: photo zone 0–670, panel zone 670–970.
    side: { headlineH: 0.396, headlineCy: 0.266, subW: 0.874, subH: 0.404, subGap: 0.07, cutoutW: 0.467, cutoutCx: 0.419, cutoutBleed: 0.6, message: { cy: 0.378, w: 0.7 }, cta: { cy: 0.562 }, lockup: { cy: 0.838, w: 0.7 }, bandH: 0.152 },
  },

  parts: {
    photo: {
      role: "photo", zone: "photo", size: { ofZoneW: 1, ofZoneH: 1 }, anchor: {},
      rule: "Cover-crops its zone, 6–75% oversize, panned so the subject (wave crest, road crack, flooded car) sits in the lower half under the copy. Never letterboxed, never stretched.",
    },
    scrim: {
      role: "scrim", zone: "photo", size: { ofZoneW: 1, ofZoneH: 0.5 }, anchor: { y: 0 },
      rule: "Navy gradient from the top of the photo zone down 50% (tall) or 77% (wide), so white copy reads over any sky.",
    },
    headline: {
      role: "headline", zone: "photo", size: { ofShort: 0.247, ofZoneW: 0.88 }, anchor: { y: 0.45, align: "center" }, floorPx: 24, display: { stacked: 0.19, side: 0.38 },
      rule: "OOH: 95px on a 384 short side (25% of short), 110px on 256 (43% of short) — the word fills 88% of the photo zone width on one line, block centre at 45% of the photo zone height (tall) or 36% (wide). Display: the glyph run is 19% of the short side tall (57px on 300×600, 96px on 970×250) and sits at 19–25% of the canvas height (tall) / 7% (wide, glyph top).",
    },
    kicker: {
      role: "kicker", zone: "photo", size: { ofHeadline: 0.3 }, anchor: { align: "center" },
      rule: "Phases 1–2 only. One line directly above the headline, 30% of the headline size.",
    },
    subheadline: {
      role: "subheadline", zone: "photo", size: { ofHeadline: 0.295 }, anchor: { align: "center" }, floorPx: 10,
      rule: "28px under a 95px headline, 32px under 110px — 29–30% of the headline size — directly beneath it, centred, 83% of the zone width max.",
    },
    cutout: {
      role: "cutout", zone: "photo", size: { ofZoneW: 0.8 }, anchor: { y: 1 }, droppedWhen: "strips; canvases under 250px on the short side",
      rule: "Storms only: the car cut-out sits on the photo at the bottom of the zone, 80% of the zone width (tall) or 32% (wide), below the copy — never behind it.",
    },
    band: {
      role: "band", zone: "seam", size: { ofZoneW: 1 }, anchor: {}, droppedWhen: "strips",
      rule: "Kotahitanga tohu strip on the seam (tall) or along the top of the panel (wide): 5.9% of height on 384×592, 16.9% on 960×256. Yellow leaf and chevron motifs, never under the logo.",
    },
    message: {
      role: "message", zone: "panel", size: { ofShort: 0.068, ofHeadline: 0.27 }, anchor: { y: 0.34, align: "center" }, floorPx: 13,
      rule: "\"Make a plan today.\" in campaign yellow: 26px on 384 (6.8% of short), 29px on 256 (11%); first item in the panel stack, centred, top third of the panel.",
    },
    cta: {
      role: "cta", zone: "panel", size: { ofShort: 0.075, ofZoneW: 0.62 }, anchor: { y: 0.47, align: "center" }, floorPx: 28, fixedPx: { w: 181, h: 43 }, display: { stacked: 0.143, side: 0.172 },
      rule: "OOH search pill: 28.9px tall on 384 (7.5% of short), 32px on 256 (12.5%), 62% of the panel width (tall) / 56% (wide), centred under the message. Display LEARN MORE button: a fixed 181×43px asset on both 300×600 and 970×250 — placed, never scaled with the canvas; 60% of the panel width.",
    },
    lockup: {
      role: "lockup", zone: "panel", size: { ofShort: 0.122, ofZoneW: 0.5 }, anchor: { y: 0.93, align: "center" }, droppedWhen: "strips (logo tile instead)",
      rule: "AEM + Council lockup 46.7px tall on 384 (12.2% of short), 47.4px on 256 (18.5%); 50% of the panel width (tall) / 40% (wide); last in the stack, centred, bottom margin ≈ 1/3 tile.",
    },
    panel: {
      role: "panel", zone: "panel", size: { ofZoneW: 1, ofZoneH: 1 }, anchor: {},
      rule: "Solid campaign blue behind the whole panel zone. Display working files carry it as one graphic (band + message + lockup baked); it fills the zone width edge to edge and is never cropped.",
    },
    logo: {
      role: "logo", zone: "canvas", size: { ofShort: 1 / 6 }, anchor: { x: 1, y: 1 }, droppedWhen: "never on strips; the lockup carries the mark elsewhere",
      rule: "Strips only: pōhutukawa tile, short ÷ 6, flush bottom-right (brand rule). Every other shape uses the AEM + Council lockup instead.",
    },
  },

  variants: [
    { phase: "Phase 1 — pre daylight-saving weekend (V1–V3)", kicker: "IT'S TIME TO TALK", headline: "ST:OR:MS | QU:AK:ES | TSU:NA:MI", message: "Make a plan this daylight saving weekend.", cta: { display: "LEARN MORE", ooh: "Auckland emergency" } },
    { phase: "Phase 2 — daylight-saving weekend countdown (V4–V7: 48H, 36H, 24H, 12H)", kicker: "TIME'S RUNNING OUT TO MAKE A PLAN", headline: "HH:MM:SS countdown in the clock face", message: "Make a plan this daylight saving weekend.", cta: { display: "LEARN MORE", ooh: "Auckland emergency" } },
    { phase: "Phase 3 — post daylight-saving weekend (V8–V10) and all OOH", headline: "ST:OR:MS | QU:AK:ES | TSU:NA:MI", subheadline: "CAN STRIKE SUDDENLY", message: "Make a plan today.", cta: { display: "LEARN MORE", ooh: "Auckland emergency" } },
  ],

  never: [
    "Re-set or respell the clock-face headline; the colons are the device.",
    "Copy over the photo without the scrim.",
    "Pill scaled with the canvas: display pill is a fixed 181×43 asset, OOH pill sits at its measured share of the short side.",
    "Band under the lockup or the logo tile.",
    "Panel graphic cropped, or floating inside a darker frame.",
    "Cut-out car behind the headline.",
    "Photo letterboxed on a colour field.",
    "Any element that is not in the delivered layers: no new shapes, patterns or copy.",
  ],

  sizes: [
    { name: "Display Half Page", w: 300, h: 600 }, { name: "Display Billboard", w: 970, h: 250 },
    { name: "Mrec", w: 300, h: 250 }, { name: "Mobile", w: 320, h: 480 }, { name: "Council Screen Landscape", w: 1920, h: 1080 },
    { name: "Meta Stories", w: 1440, h: 2560 }, { name: "JCDecaux", w: 2688, h: 672 }, { name: "JCDecaux", w: 1824, h: 432 },
    { name: "JCDecaux", w: 384, h: 592 }, { name: "JCDecaux", w: 960, h: 256 }, { name: "JCDecaux", w: 768, h: 256 },
    { name: "JCDecaux", w: 1440, h: 480 }, { name: "JCDecaux", w: 1184, h: 400 }, { name: "Hivestack", w: 2160, h: 3840 },
    { name: "Hivestack", w: 384, h: 576 }, { name: "Britomart Towers", w: 432, h: 768 }, { name: "Newmarket Atrium", w: 1280, h: 448 },
    { name: "Fanshawe Blades", w: 704, h: 1408 }, { name: "The Oteha", w: 384, h: 768 }, { name: "Shopalive", w: 1080, h: 1920 },
  ],

  references: [
    "InDesign masters: 26-PRO-0461 … 384px W x 592px H and 960px W x 256px H (standard and SLIM) — Storms, Quakes, Tsunami.",
    "GWD working files: WORKING FILES/{QUAKES,STORMS,TSUNAMI}/{300x600px,970x250px}.",
    "DV360 finals: Phase 1 V1–V3, Phase 2 V4–V7, Phase 3 V8–V10 at 300×600 and 970×250 (HTML5 + statics).",
  ],
};

/** All schemas the studio knows. Add new campaigns here. */
export const STYLE_SCHEMAS: StyleSchema[] = [GET_READY_BURST_2];

/** Pick the schema for a template or brief by name. */
export function styleSchemaFor(name: string | null | undefined): StyleSchema | null {
  const n = (name ?? "").toLowerCase();
  if (!n) return null;
  return STYLE_SCHEMAS.find((s) => s.match.some((m) => n.includes(m))) ?? null;
}

/** A compact, prompt-ready rendering of the schema for the reviewer. */
export function describeStyleSchema(s: StyleSchema): string {
  const zones = (Object.keys(s.zones) as FormatClass[])
    .map((k) => `  ${k}: ${s.zones[k].axis}, photo ${Math.round(s.zones[k].photoFrac * 100)}%, band ${Math.round(s.zones[k].bandFrac * 100)}% ${s.zones[k].bandAt}`)
    .join("\n");
  const parts = Object.values(s.parts).map((p) => `  ${p.role}: ${p.rule}`).join("\n");
  return [
    `STYLE SPEC — ${s.name}`,
    `Reading order (most important first): ${s.hierarchy.join(" → ")}.`,
    `Type: ${Object.entries(s.type).map(([k, v]) => `${k} — ${v}`).join(" ")}`,
    `Colours: ${Object.entries(s.colours).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    "Zones by shape:",
    zones,
    "Parts:",
    parts,
    `Shipped copy: ${s.variants.map((v) => `[${v.phase}] ${v.kicker ? v.kicker + " / " : ""}${v.headline}${v.subheadline ? " / " + v.subheadline : ""} / ${v.message} / CTA ${v.cta.display} (display) or ${v.cta.ooh} (OOH)`).join(" | ")}`,
    `Never: ${s.never.join(" ")}`,
  ].join("\n");
}
