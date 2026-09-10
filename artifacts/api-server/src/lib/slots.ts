/**
 * Semantic master: which rectangle in a layout is the photo, the panel, the
 * headline, the CTA, the band, the lockup.
 *
 * Imported masters arrive as a flat list of rectangles with loose roles
 * (product / decoration / headline / subhead). A recomposer needs to know
 * what each one is FOR, because the parts behave differently under a new
 * shape: the photo re-crops, the panel re-sizes, the CTA keeps its pixel
 * size, the band tiles along the seam. This module assigns each element a
 * slot. An explicit `slot` on the element (set by an importer or a designer
 * in the editor) always wins; the heuristics below fill in the rest from
 * geometry, measured against the Get Ready OOH and DV360 masters.
 */
import type { FreeformConfig, FreeformElement, FreeformImage, FreeformRect, FreeformText, SlotRole } from "./freeform";

export type Slot = SlotRole;

export type SlottedElement = FreeformElement & { slot: Slot };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SemanticMaster {
  width: number;
  height: number;
  elements: SlottedElement[];
  photo: (FreeformImage & { slot: Slot }) | null;
  cutouts: (FreeformImage & { slot: Slot })[];
  scrim: (FreeformRect & { slot: Slot }) | null;
  panel: (FreeformRect & { slot: Slot }) | null;
  band: (FreeformImage & { slot: Slot }) | null;
  headline: (FreeformText & { slot: Slot }) | null;
  subheadline: (FreeformText & { slot: Slot }) | null;
  message: (FreeformText & { slot: Slot }) | null;
  cta: (FreeformRect & { slot: Slot }) | (FreeformImage & { slot: Slot }) | null;
  ctaLabel: (FreeformText & { slot: Slot }) | null;
  ctaIcon: (FreeformImage & { slot: Slot }) | null;
  lockup: (FreeformImage & { slot: Slot }) | null;
  logo: (FreeformImage & { slot: Slot }) | null;
  /** How the master itself is composed. */
  axis: "stacked" | "side" | "overlay" | "none";
  photoBox: Box | null;
  /** The part of the panel not covered by the photo. */
  panelBox: Box | null;
  panelFill: string | null;
  ctaKind: "pill" | "button" | "none";
  notes: string[];
}

function area(b: Box): number {
  return Math.max(0, b.w) * Math.max(0, b.h);
}

function centreIn(e: Box, b: Box): boolean {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
}

function overlapFrac(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / Math.max(1, area(a));
}

/** Largest rectangle of `outer` left after removing `hole` (axis-aligned;
 * the hole is assumed to touch at least one edge, as photo panels do). */
function remainder(outer: Box, hole: Box): Box {
  const candidates: Box[] = [
    { x: outer.x, y: outer.y, w: outer.w, h: Math.max(0, hole.y - outer.y) }, // above
    { x: outer.x, y: hole.y + hole.h, w: outer.w, h: Math.max(0, outer.y + outer.h - (hole.y + hole.h)) }, // below
    { x: outer.x, y: outer.y, w: Math.max(0, hole.x - outer.x), h: outer.h }, // left
    { x: hole.x + hole.w, y: outer.y, w: Math.max(0, outer.x + outer.w - (hole.x + hole.w)), h: outer.h }, // right
  ];
  return candidates.sort((a, b) => area(b) - area(a))[0];
}

export function inferSlots(config: FreeformConfig, width: number, height: number): SemanticMaster {
  const W = width;
  const H = height;
  const canvasArea = W * H;
  const notes: string[] = [];
  const els: SlottedElement[] = config.elements.map((e) => ({ ...e, slot: (e as { slot?: Slot }).slot ?? "other" }));
  const explicit = new Set(els.filter((e) => e.slot !== "other").map((e) => e.id));
  const isExplicit = (e: SlottedElement) => explicit.has(e.id);
  const unassigned = (e: SlottedElement) => !isExplicit(e) && e.slot === "other";
  const images = els.filter((e): e is FreeformImage & { slot: Slot } => e.type === "image");
  const rects = els.filter((e): e is FreeformRect & { slot: Slot } => e.type === "rect");
  const texts = els.filter((e): e is FreeformText & { slot: Slot } => e.type === "text");
  const bandShaped = (e: Box) => e.h > 0 && e.w > 0 && (e.w / e.h >= 5 || e.h / e.w >= 5) && area(e) < canvasArea * 0.15;

  // 1. Panel: a solid rect spanning a full side (or the whole page).
  let panel =
    (rects.find((r) => r.slot === "panel") as (FreeformRect & { slot: Slot }) | undefined) ??
    rects
      .filter((r) => unassigned(r) && !r.gradient && (r.opacity ?? 1) >= 0.9)
      .filter((r) => area(r) >= canvasArea * 0.2 && (r.w >= W * 0.9 || r.h >= H * 0.9))
      .sort((a, b) => area(b) - area(a))[0] ??
    null;
  if (panel) panel.slot = "panel";

  // 2. Photo: the product image, else the largest image that is not a band.
  let photo: (FreeformImage & { slot: Slot }) | null =
    (images.find((i) => i.slot === "photo") as (FreeformImage & { slot: Slot }) | undefined) ??
    images
      .filter((i) => unassigned(i) && i.src && !bandShaped(i))
      .sort((a, b) => {
        const pa = a.role === "product" ? 1 : 0;
        const pb = b.role === "product" ? 1 : 0;
        return pb - pa || area(b) - area(a);
      })[0] ??
    null;
  if (photo && area(photo) < canvasArea * 0.15) photo = null;
  if (photo) photo.slot = "photo";
  const photoBox: Box | null = photo ? { x: photo.x, y: photo.y, w: photo.w, h: photo.h } : null;

  // 3. Scrim: a gradient or translucent rect over the photo.
  const scrim =
    (rects.find((r) => r.slot === "scrim") as (FreeformRect & { slot: Slot }) | undefined) ??
    rects
      .filter((r) => unassigned(r) && (r.gradient !== undefined || (r.opacity ?? 1) < 0.9))
      .filter((r) => !photoBox || overlapFrac(r, photoBox) > 0.3)
      .sort((a, b) => area(b) - area(a))[0] ??
    null;
  if (scrim) scrim.slot = "scrim";

  // 4. Band: a very wide (or very tall) strip that isn't the photo.
  const band =
    (images.find((i) => i.slot === "band") as (FreeformImage & { slot: Slot }) | undefined) ??
    images.filter((i) => unassigned(i) && i !== photo && bandShaped(i)).sort((a, b) => area(b) - area(a))[0] ??
    null;
  if (band) band.slot = "band";

  // 5. CTA: a rounded rect with a label inside (search pill), or a small
  //    button-shaped image. Icon = small image inside the pill.
  let cta: SemanticMaster["cta"] = (els.find((e) => e.slot === "cta" && (e.type === "rect" || e.type === "image")) as SemanticMaster["cta"]) ?? null;
  let ctaLabel: SemanticMaster["ctaLabel"] = (texts.find((t) => t.slot === "ctaLabel") as SemanticMaster["ctaLabel"]) ?? null;
  let ctaIcon: SemanticMaster["ctaIcon"] = (images.find((i) => i.slot === "ctaIcon") as SemanticMaster["ctaIcon"]) ?? null;
  if (!cta) {
    const pill = rects
      .filter((r) => unassigned(r) && (r.radius ?? 0) > 0 && r.h < Math.min(W, H) * 0.3 && r.w / Math.max(1, r.h) >= 2.2)
      .filter((r) => texts.some((t) => unassigned(t) && centreIn(t, r)))
      .sort((a, b) => area(b) - area(a))[0];
    if (pill) cta = pill;
  }
  if (!cta) {
    const button = images
      .filter((i) => unassigned(i) && i !== photo && i !== band)
      .filter((i) => i.w / Math.max(1, i.h) >= 3 && i.w / Math.max(1, i.h) <= 6 && i.h <= Math.min(W, H) * 0.25 && area(i) < canvasArea * 0.08)
      .filter((i) => !photoBox || overlapFrac(i, photoBox) < 0.5)
      .sort((a, b) => area(b) - area(a))[0];
    if (button) cta = button;
  }
  if (cta) {
    cta.slot = "cta";
    if (!ctaLabel) {
      const label = texts.filter((t) => unassigned(t) && centreIn(t, cta as Box)).sort((a, b) => area(b) - area(a))[0];
      if (label) {
        label.slot = "ctaLabel";
        ctaLabel = label;
      }
    }
    if (!ctaIcon) {
      const icon = images
        .filter((i) => unassigned(i) && i !== cta && centreIn(i, cta as Box) && area(i) < area(cta as Box) * 0.5)
        .sort((a, b) => area(b) - area(a))[0];
      if (icon) {
        icon.slot = "ctaIcon";
        ctaIcon = icon;
      }
    }
  }
  const ctaKind: SemanticMaster["ctaKind"] = !cta ? "none" : cta.type === "rect" && (cta.radius ?? 0) >= cta.h * 0.35 ? "pill" : "button";

  // 6. Panel box = panel minus photo; otherwise the canvas minus photo.
  const outer: Box = panel ? { x: panel.x, y: panel.y, w: panel.w, h: panel.h } : { x: 0, y: 0, w: W, h: H };
  const panelBox: Box | null = photoBox && overlapFrac(photoBox, outer) > 0.5 ? remainder(outer, photoBox) : panel ? outer : null;

  // 7. Logo / lockup: the brand mark, or a small wide image in the panel.
  const logo = (images.find((i) => i.slot === "logo") ?? images.find((i) => unassigned(i) && i.role === "logo")) ?? null;
  if (logo) logo.slot = "logo";
  const lockup =
    (images.find((i) => i.slot === "lockup") as (FreeformImage & { slot: Slot }) | undefined) ??
    images
      .filter((i) => unassigned(i) && i !== photo && i !== band && i !== cta && i !== ctaIcon)
      .filter((i) => i.w / Math.max(1, i.h) >= 2 && i.w / Math.max(1, i.h) <= 8 && area(i) <= canvasArea * 0.1)
      .filter((i) => (panelBox ? centreIn(i, panelBox) : true))
      .sort((a, b) => area(b) - area(a))[0] ??
    null;
  if (lockup) lockup.slot = "lockup";

  // 8. Copy: headline = biggest type; sub-headline = next block on the
  //    photo; message = biggest remaining block in the panel.
  const bySize = (a: FreeformText, b: FreeformText) => b.fontSize - a.fontSize;
  const headline =
    (texts.find((t) => t.slot === "headline") as (FreeformText & { slot: Slot }) | undefined) ??
    texts.filter((t) => unassigned(t) && t.text.trim().length > 0).sort((a, b) => (a.role === "headline" ? 0 : 1) - (b.role === "headline" ? 0 : 1) || bySize(a, b))[0] ??
    null;
  if (headline) headline.slot = "headline";
  const subheadline =
    (texts.find((t) => t.slot === "subheadline") as (FreeformText & { slot: Slot }) | undefined) ??
    texts
      .filter((t) => unassigned(t) && t !== headline && t.text.trim().length > 0)
      .filter((t) => (photoBox ? centreIn(t, photoBox) : headline ? Math.abs(t.y - (headline.y + headline.h)) < headline.fontSize * 1.5 : false))
      .sort(bySize)[0] ??
    null;
  if (subheadline) subheadline.slot = "subheadline";
  const message =
    (texts.find((t) => t.slot === "message") as (FreeformText & { slot: Slot }) | undefined) ??
    texts
      .filter((t) => unassigned(t) && t !== headline && t !== subheadline && t.text.trim().length > 0)
      .filter((t) => (panelBox ? centreIn(t, panelBox) : true))
      .sort(bySize)[0] ??
    null;
  if (message) message.slot = "message";

  // 9. Cut-outs: mid-size images sitting on the photo.
  const cutouts = images.filter(
    (i) =>
      i.slot === "cutout" ||
      (unassigned(i) && i !== photo && photoBox !== null && centreIn(i, photoBox) && area(i) >= area(photoBox) * 0.03 && area(i) <= area(photoBox) * 0.6),
  );
  for (const c of cutouts) c.slot = "cutout";

  // 10. Composition axis of the master itself.
  let axis: SemanticMaster["axis"] = "none";
  if (photoBox) {
    const fullW = photoBox.w >= W * 0.9;
    const fullH = photoBox.h >= H * 0.9;
    axis = fullW && fullH ? "overlay" : fullW ? "stacked" : fullH ? "side" : "none";
  }

  if (!photo) notes.push("No photograph found in the master.");
  if (!headline) notes.push("No headline text found in the master.");
  if (!panel) notes.push("No solid brand panel found in the master; the recomposer will add one in the panel colour.");
  if (!cta) notes.push("No call-to-action found in the master.");

  return {
    width: W,
    height: H,
    elements: els,
    photo: photo ?? null,
    cutouts,
    scrim: scrim ?? null,
    panel: panel ?? null,
    band: band ?? null,
    headline: headline ?? null,
    subheadline: subheadline ?? null,
    message: message ?? null,
    cta,
    ctaLabel,
    ctaIcon,
    lockup: lockup ?? null,
    logo: (logo as (FreeformImage & { slot: Slot }) | null) ?? null,
    axis,
    photoBox,
    panelBox,
    panelFill: panel?.fill ?? null,
    ctaKind,
    notes,
  };
}

/** Flat artwork: the copy is baked into the pixels (a JPEG of the finished
 * ad, a PSD composite, an image-only banner export) — no live text and no
 * captured kvText to re-set. Such a master can be scaled to a near-identical
 * shape but never rebuilt: designers rejected every re-cropped flat piece
 * ("just the image, no brand collateral, cropped in the wrong place"). */
export function isFlatArtwork(config: FreeformConfig): boolean {
  const hasLiveText = config.elements.some((e) => e.type === "text" && e.text.trim().length > 0);
  if (hasLiveText) return false;
  // Image layers that carry composition slots (an HTML5 export whose headline
  // and CTA layers have been recognised) are layered artwork, not flat.
  const hasLayeredSlots = config.elements.some((e) => e.type === "image" && (e.slot === "headline" || e.slot === "cta"));
  if (hasLayeredSlots) return false;
  const hasCapturedCopy = config.elements.some((e) => e.type === "image" && Array.isArray(e.kvText) && e.kvText.length > 0);
  return !hasCapturedCopy;
}
