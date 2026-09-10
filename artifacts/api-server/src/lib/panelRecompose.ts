/**
 * Panel-layout recomposition for aspect-distant adaptations.
 *
 * Imported campaign masters are often PANEL layouts: a photo panel with the
 * headline over it, a decorative pattern band on the seam, and a flat brand
 * panel carrying the call-to-action cluster (copy, search pill, logo lockup).
 * Plain geometric scaling reproduces those well at nearby aspect ratios but
 * falls apart when the target is a different shape (a 960×256 billboard
 * squeezed into 1920×1080 leaves white gutters and a floating band).
 *
 * This recompose measures the master's own structure — where the photo sits,
 * how thick the band is, what lives in the brand panel — and rebuilds the
 * same design for the target: photo panel re-cut for the new shape, band on
 * the seam, CTA cluster re-centred in the brand panel at a legible scale.
 * Everything is derived from the master's proportions; nothing is invented.
 */
import type { FreeformConfig, FreeformElement } from "./freeform";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type El = FreeformElement & Record<string, any>;

function centreIn(e: El, b: Box): boolean {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
}

export function recomposePanelLayout(
  cfg: FreeformConfig,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): FreeformConfig | null {
  const els = cfg.elements as El[];
  if (els.length < 4) return null;

  // Structure detection — bail out (null) whenever this doesn't look like a
  // panel master; the caller falls back to geometric scaling. The brand
  // panel is either a full-page rect under everything or a rect spanning
  // one full side (the flat half of a side-by-side layout); either way its
  // fill becomes the recomposed canvas background.
  const bg = els
    .filter(
      (e) =>
        e.type === "rect" &&
        e.w * e.h >= srcW * srcH * 0.3 &&
        (e.w >= srcW * 0.9 || e.h >= srcH * 0.9) &&
        !e.gradient,
    )
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const photo = els
    .filter((e) => e.type === "image" && e.role === "product")
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (!bg || !photo) return null;
  const photoArea = (photo.w * photo.h) / (srcW * srcH);
  if (photoArea < 0.25 || photoArea > 0.85) return null;
  const stackedMaster = photo.w >= srcW * 0.9; // photo spans the full width
  const sideMaster = !stackedMaster && photo.h >= srcH * 0.9; // full height
  if (!stackedMaster && !sideMaster) return null;

  // The pattern band: a very wide strip that isn't the photo.
  const band =
    els
      .filter((e) => e.type === "image" && e !== photo && e.h > 0 && e.w / e.h >= 6)
      .sort((a, b) => b.w - a.w)[0] ?? null;

  const photoBox: Box = { x: photo.x, y: photo.y, w: photo.w, h: photo.h };
  const overlay = els.filter((e) => e !== photo && e !== bg && e !== band && centreIn(e, photoBox));
  const panelEls = els.filter((e) => e !== photo && e !== bg && e !== band && !overlay.includes(e));
  if (panelEls.length === 0) return null;

  const stackedOut = dstW / dstH < 1.1;
  const frac = stackedMaster ? photo.h / srcH : photo.w / srcW;
  const bandFrac = band ? band.h / srcH : 0;

  let photoT: Box;
  let bandT: Box | null = null;
  let panelT: Box;
  if (stackedOut) {
    const ph = Math.round(dstH * (stackedMaster ? frac : 0.57));
    const bh = band ? Math.max(8, Math.round(dstH * (bandFrac || 0.055))) : 0;
    photoT = { x: 0, y: 0, w: dstW, h: ph };
    if (band) bandT = { x: 0, y: ph, w: dstW, h: bh };
    panelT = { x: 0, y: ph + bh, w: dstW, h: Math.max(1, dstH - ph - bh) };
  } else {
    const pw = Math.round(dstW * (sideMaster ? frac : 0.49));
    const bh = band ? Math.max(8, Math.min(Math.round(dstH * (bandFrac || 0.125)), Math.round(dstH * 0.16))) : 0;
    photoT = { x: 0, y: 0, w: pw, h: dstH };
    if (band) bandT = { x: pw, y: 0, w: dstW - pw, h: bh };
    panelT = { x: pw, y: bh, w: Math.max(1, dstW - pw), h: Math.max(1, dstH - bh) };
  }

  // CTA cluster: uniform scale, centred in the brand panel.
  let cbb: Box | null = null;
  for (const e of panelEls) {
    cbb = cbb
      ? {
          x: Math.min(cbb.x, e.x),
          y: Math.min(cbb.y, e.y),
          w: Math.max(cbb.x + cbb.w, e.x + e.w) - Math.min(cbb.x, e.x),
          h: Math.max(cbb.y + cbb.h, e.y + e.h) - Math.min(cbb.y, e.y),
        }
      : { x: e.x, y: e.y, w: e.w, h: e.h };
  }
  if (!cbb || cbb.w < 1 || cbb.h < 1) return null;
  const sPanel = Math.min((panelT.w * 0.86) / cbb.w, (panelT.h * 0.86) / cbb.h);
  const offX = panelT.x + (panelT.w - cbb.w * sPanel) / 2 - cbb.x * sPanel;
  const offY = panelT.y + (panelT.h - cbb.h * sPanel) / 2 - cbb.y * sPanel;

  // Photo overlay (headline, subhead, scrims): positions follow the photo
  // box on each axis; type scales with the photo's width so the headline
  // keeps its width fraction.
  const sxO = photoT.w / photoBox.w;
  const syO = photoT.h / photoBox.h;
  const sText = sxO;

  const out: El[] = [];
  for (const e of els) {
    if (e === bg) {
      out.push({ ...e, x: 0, y: 0, w: dstW, h: dstH });
    } else if (e === photo) {
      out.push({ ...e, x: photoT.x, y: photoT.y, w: photoT.w, h: photoT.h });
    } else if (band && e === band) {
      out.push({ ...e, x: bandT!.x, y: bandT!.y, w: bandT!.w, h: bandT!.h });
    } else if (overlay.includes(e)) {
      const nx = photoT.x + (e.x - photoBox.x) * sxO;
      const ny = photoT.y + (e.y - photoBox.y) * syO;
      if (e.type === "text") {
        out.push({
          ...e,
          x: nx,
          y: ny,
          w: e.w * sxO,
          h: e.h * sText,
          fontSize: Math.max(6, Math.round(e.fontSize * sText)),
          ...(e.letterSpacing !== undefined ? { letterSpacing: e.letterSpacing * sText } : {}),
        });
      } else {
        out.push({
          ...e,
          x: nx,
          y: ny,
          w: e.w * sxO,
          h: e.h * syO,
          ...(e.radius !== undefined ? { radius: e.radius * Math.min(sxO, syO) } : {}),
        });
      }
    } else {
      // CTA cluster member.
      const base = {
        ...e,
        x: offX + e.x * sPanel,
        y: offY + e.y * sPanel,
        w: e.w * sPanel,
        h: e.h * sPanel,
      };
      if (e.type === "text") {
        out.push({
          ...base,
          fontSize: Math.max(6, Math.round(e.fontSize * sPanel)),
          ...(e.letterSpacing !== undefined ? { letterSpacing: e.letterSpacing * sPanel } : {}),
        });
      } else {
        out.push({
          ...base,
          ...(e.radius !== undefined ? { radius: e.radius * sPanel } : {}),
        });
      }
    }
  }

  return { kind: "freeform", elements: out as FreeformElement[] };
}
