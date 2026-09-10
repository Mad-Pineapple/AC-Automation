import { Brand, FreeformElement, Template } from "@workspace/api-client-react";
import { useEffect, useState, useSyncExternalStore } from "react";

export type LayoutOptions = {
  contentAlignment?: "top" | "center" | "bottom";
  textAlign?: "left" | "center" | "right";
  showAccentBar?: boolean;
  showLogoBar?: boolean;
  imageStyle?: "side" | "background";
  /** Render the brand strapline bottom-left (print/OOH treatment — shipped AC
   *  posters pair it with the logo tile bottom-right; social statics skip it). */
  showStrapline?: boolean;
};

export interface ResolvedConfig {
  width: number;
  height: number;
  label: string;
  dims: string;
  scale: number;
  layout?: LayoutOptions;
  kind?: string;
  elements?: FreeformElement[];
}

interface TemplateProps {
  brand: Brand;
  headline?: string | null;
  bodyText?: string | null;
  callToAction?: string | null;
  imageUrl?: string | null;
  isAnimated?: boolean;
  size?: "small" | "medium" | "large";
}

interface WrapperProps extends TemplateProps {
  templateSize: string;
  scale?: number;
  /** Render an arbitrary (possibly unsaved) config directly, bypassing the registry. */
  overrideConfig?: { width: number; height: number; layout?: LayoutOptions; kind?: string; elements?: FreeformElement[] };
}

// A robust font stack so a brand's (possibly licensed / unavailable) typeface
// degrades to the app's loaded brand face (National 2) then system sans.
// Multi-word brand fonts (e.g. "National 2") MUST be quoted or the whole
// declaration is ignored.
function brandFontStack(family?: string | null): string {
  const fam = (family ?? "").trim();
  const lead = fam ? `"${fam}", ` : "";
  return `${lead}"National 2", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
}

// Pick black or white ink for text/marks placed on a solid brand colour so the
// CTA, wordmark and logo bar stay legible for ANY brand palette (a light
// primary colour would otherwise make white CTA text disappear).
function readableOn(bgHex?: string | null): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((bgHex ?? "").trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // Compare the WCAG contrast ratio of black vs white against the colour and
  // keep whichever is stronger (a plain L>0.5 cut mis-picks mid-bright hues).
  const contrastWhite = 1.05 / (L + 0.05);
  const contrastBlack = (L + 0.05) / 0.05;
  return contrastBlack >= contrastWhite ? "#1a1a1a" : "#ffffff";
}

/** Guidelines search-bar CTA treatment: "Search" in Regular (tracking −10)
 *  + the phrase in Bold (tracking +10), sentence case, with a magnifier glyph
 *  — matching shipped AC pills ("Search bin tags", "Search dog rego").
 *  Non-search CTAs render as plain bold sentence case. */
function CtaLabel({ text }: { text: string }) {
  const m = /^search\s+(.+)$/i.exec(text.trim());
  if (!m) return <>{text}</>;
  return (
    <>
      <span style={{ fontWeight: 400, letterSpacing: "-0.01em" }}>Search&nbsp;</span>
      <span style={{ fontWeight: 700, letterSpacing: "0.01em" }}>{m[1]}</span>
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        style={{ width: "0.9em", height: "0.9em", marginLeft: "0.55em", flexShrink: 0 }}
      >
        <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.6" />
        <line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    </>
  );
}

type CanvasFormat = "ultraStrip" | "wideStrip" | "landscape" | "square" | "poster" | "story";

interface CanvasDesign {
  format: CanvasFormat;
  headlineSize: number;
  bodySize: number;
  ctaSize: number;
  bodyLines: number;
  showBody: boolean;
  /** Where the copy block sits vertically — designers don't centre everything. */
  anchor: "top" | "center" | "bottom";
  /** Insets that keep copy clear of platform UI (Meta story chrome). */
  safeTop: number;
  safeBottom: number;
  /** Copy measure: long lines are unreadable, so cap the text column. */
  copyWidth: string;
  /** Composition axis for awkward canvases (measured from shipped AC creative:
   *  wide → image left / panel right; tall → image top / panel bottom). */
  split: "none" | "vertical" | "horizontal";
  /** Fraction of the canvas the IMAGE zone occupies when split. */
  imageFraction: number;
  /** Message-line size for the panel on split canvases. */
  messageSize: number;
}

/**
 * Make the layout decisions a designer would make for THIS canvas, instead of
 * scaling one template up and down.
 *
 * Two ideas do most of the work:
 *  - Type is sized off the SHORT axis (how a designer judges a canvas), so a
 *    970×250 banner gets banner-sized type rather than type derived from its
 *    970px width, and an A4 poster gets poster-sized type.
 *  - Elements earn their place: body copy is dropped where there is no room
 *    for it, rather than being crushed to an illegible size.
 */
function designFor(
  width: number,
  height: number,
  headline: string | undefined,
  hasBody: boolean,
): CanvasDesign {
  const short = Math.min(width, height);
  const ratio = width / height;
  const area = width * height;

  const format: CanvasFormat =
    ratio >= 5 ? "ultraStrip"
    : ratio >= 2 ? "wideStrip"
    : ratio >= 1.25 ? "landscape"
    : ratio >= 0.85 ? "square"
    : ratio >= 0.62 ? "poster"
    : "story";

  // Extreme ratios use the split composition measured off the shipped Get
  // Ready statics: the axis follows the canvas. Tall posters split too when
  // they lean narrow (384×592 OOH does; A4 at 0.71 stays full-bleed).
  const split: CanvasDesign["split"] =
    format === "wideStrip" ? "vertical" : ratio <= 0.68 ? "horizontal" : "none";
  // Measured: DV360 970×250 gives the photo ~65% / panel ~35%; the talls give
  // the photo the top ~55% with the panel on the bottom ~38% (band eats the rest).
  const imageFraction = split === "vertical" ? 0.65 : 0.55;

  const margin = Math.max(8, short / 18);

  // ---- Headline: on a split canvas it lives ON THE PHOTO (every shipped
  // example does this), so it is sized against the IMAGE zone, not the panel.
  const hlBoxW = (split === "vertical" ? width * imageFraction : width) - margin * 2;
  const hlBoxH = (split === "horizontal" ? height * imageFraction : height) - margin * 2;

  // Ceilings measured off the statics: display type runs ~38% of the short
  // axis on wides, ~20% of the width on talls; full-bleed formats keep the
  // earlier scales. Box-fitting below pulls long sentences back down.
  const headlineScale: Record<CanvasFormat, number> = {
    ultraStrip: 0.34,
    wideStrip: 0.38,
    landscape: 0.12,
    square: 0.095,
    poster: 0.085,
    story: 0.115,
  };
  const hlCeiling =
    split === "horizontal" ? width * 0.2 : short * headlineScale[format];

  const chars = Math.max(1, (headline ?? "").length);
  // The share of its box the headline block may claim: most of the image zone
  // when split (nothing else lives there); less when it shares with body+CTA.
  const showBody = split !== "none" ? hasBody : hasBody && format !== "ultraStrip" && short >= 200 && area >= 120_000;
  const headlineShare = split !== "none" ? 0.7 : showBody ? 0.46 : 0.62;

  let headlineSize = hlCeiling;
  for (let i = 0; i < 40; i++) {
    const lines = Math.max(1, Math.ceil((chars * headlineSize * 0.52) / Math.max(1, hlBoxW)));
    if (lines * headlineSize * 1.1 <= hlBoxH * headlineShare) break;
    headlineSize *= 0.92;
  }
  headlineSize = Math.max(11, headlineSize);

  // ---- Panel message line (split canvases): sized to the panel, bold and
  // short — "Make a plan today." — never paragraph copy.
  const panelW = (split === "vertical" ? width * (1 - imageFraction) : width) - margin * 2;
  const messageSize = Math.min(30, Math.max(13, panelW * 0.085));

  const bodySize =
    split !== "none" ? messageSize : Math.max(9, headlineSize * (format === "poster" ? 0.3 : 0.34));
  // Shipped AC banners keep the search pill at ~43px tall on both a 300×600
  // and a 970×250 — placed at a legibility floor, not scaled with the canvas.
  const ctaFloor = Math.min(19, short * 0.075);
  const ctaSize = Math.max(11, ctaFloor, headlineSize * (format === "ultraStrip" ? 0.5 : 0.32));

  return {
    format,
    headlineSize,
    bodySize,
    ctaSize,
    bodyLines: split !== "none" ? 2 : format === "poster" ? 4 : 3,
    showBody,
    anchor: format === "story" ? "center" : format === "landscape" ? "center" : "bottom",
    safeTop: format === "story" && split === "none" ? height * 0.14 : 0,
    safeBottom: format === "story" && split === "none" ? height * 0.16 : 0,
    copyWidth: format === "landscape" ? "58%" : "100%",
    split,
    imageFraction,
    messageSize,
  };
}

function BrandCanvas({
  brand,
  headline,
  bodyText,
  callToAction,
  imageUrl,
  width,
  height,
  isAnimated,
  layout,
}: TemplateProps & { width: number; height: number; layout?: LayoutOptions }) {
  const design = designFor(width, height, headline ?? undefined, !!bodyText);
  const showAccentBar = layout?.showAccentBar !== false;
  const showLogoBar = layout?.showLogoBar !== false;
  const imageMode = layout?.imageStyle ?? "background";
  // Very wide & short formats (e.g. 728×90 banners) can't use the vertical
  // headline/body/CTA stack — it crushes the headline to ~10px. They get a
  // dedicated horizontal "strip" layout instead.
  const isStrip = design.format === "ultraStrip";
  // A split composition owns the image placement, so the legacy "side image"
  // mode must stand down — otherwise it both moves the photo to the wrong
  // half AND reserves half the canvas, collapsing the copy column to zero.
  const useSideImage = !isStrip && design.split === "none" && imageMode === "side" && !!imageUrl;
  // A split composition places the photo in its own zone, so it always uses
  // the background treatment regardless of the template's image mode.
  const useBgImage = !!imageUrl && (imageMode === "background" || isStrip || design.split !== "none");
  // Legible ink for marks set on the brand's primary colour (CTA, logo bar).
  const onPrimary = readableOn(brand.primaryColor);
  // Split-canvas panels are centre-aligned in every shipped example,
  // regardless of what the template's layout options say.
  const textAlign: "left" | "center" | "right" =
    design.split !== "none" ? "center" : (layout?.textAlign ?? "left");
  const alignItems = textAlign === "center" ? "center" : textAlign === "right" ? "flex-end" : "flex-start";
  const justifyContent =
    layout?.contentAlignment === "top"
      ? "flex-start"
      : layout?.contentAlignment === "bottom"
        ? "flex-end"
        : layout?.contentAlignment === "center"
          ? "center"
          : design.split !== "none"
            ? "center"
            : design.anchor === "top"
              ? "flex-start"
              : design.anchor === "bottom"
                ? "flex-end"
                : "center";

  const style: React.CSSProperties = {
    width,
    height,
    backgroundColor: brand.backgroundColor,
    color: brand.textColor,
    fontFamily: brandFontStack(brand.fontFamily),
    position: "relative",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  };

  // ---- AC grid system (brand guidelines + shipped creative) -------------
  // The pōhutukawa tile is the building block; page margin = 1/3 tile; the
  // master logo (colour mark in its white square tile — never recoloured)
  // sits bottom-right of campaign artwork. Shipped AC creative (Food Scraps
  // FY26 OOH/HTML5 dispatch) uses a ~6-division tile, so that's the ratio
  // here. Every format derives its margins from this grid so imagery, copy
  // and logo placement stay consistent across sizes.
  const tile = Math.max(24, Math.round(Math.min(width, height) / 6));
  const stripTile = Math.round(height * 0.64);
  const margin = isStrip
    ? Math.round((height - stripTile) / 2)
    : Math.max(8, Math.round(tile / 3));
  const showLogoTile = showLogoBar && !!brand.logoUrl;

  const accentBar: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: Math.max(4, height * 0.015),
    backgroundColor: brand.primaryColor,
    zIndex: 3,
  };

  // The logoUrl asset IS the master logo tile (colour mark on white square),
  // so it renders verbatim — no tint/invert filters, per the guidelines.
  // The tile sits FLUSH to the bottom-right corner: it occupies the corner
  // grid cell (grid cells run edge to edge), and the mark's clearspace comes
  // from the 1/8 padding inside the white box. The 1/3-tile page margin
  // applies to copy and patterns, not the tile — see shipped AC creative.
  const logoTileStyle: React.CSSProperties = {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: tile,
    height: tile,
    objectFit: "cover",
    zIndex: 3,
  };

  // Reserve the logo tile's column so copy never collides with it.
  const contentRight = showLogoTile ? tile + margin : margin;

  // Print/OOH treatment (matches shipped AC posters): the strapline sits
  // bottom-left, paired with the tile bottom-right. Social statics leave it
  // off ("less is more"). The lines come from the brand record — no brand
  // strapline, no treatment (white-label safe).
  const straplineLines = (brand.strapline ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const showStrapline = layout?.showStrapline === true && straplineLines.length > 0;
  const straplineStyle: React.CSSProperties = {
    position: "absolute",
    left: margin,
    bottom: margin,
    zIndex: 3,
    color: useBgImage ? "#ffffff" : brand.textColor,
    fontWeight: 700,
    fontSize: Math.max(10, Math.round(tile * 0.17)),
    lineHeight: 1.35,
    textShadow: useBgImage ? "0 1px 3px rgba(0,0,0,0.4)" : "none",
  };

  const contentArea: React.CSSProperties = {
    position: "absolute",
    // On a split canvas this area IS the message panel (the headline lives
    // over the photo, rendered separately): message + CTA, centred.
    top:
      design.split === "horizontal"
        ? `calc(${design.imageFraction * 100}% + ${margin}px)`
        : margin + design.safeTop,
    left: design.split === "vertical" ? `calc(${design.imageFraction * 100}% + ${margin}px)` : margin,
    right: design.split !== "none" ? margin : useSideImage ? Math.max(contentRight, width * 0.5) : contentRight,
    bottom:
      design.split !== "none"
        ? margin + (showLogoTile ? Math.round(tile * 0.4) : 0)
        : (showStrapline ? margin + Math.round(tile * 0.55) : margin) + design.safeBottom,
    display: "flex",
    flexDirection: "column",
    justifyContent,
    alignItems,
    textAlign,
    gap: Math.max(4, height * 0.02),
    zIndex: 2,
  };

  const headlineStyle: React.CSSProperties = {
    fontSize: design.headlineSize,
    fontWeight: 700,
    // Display type sets tighter; small type needs air.
    lineHeight: design.headlineSize > 48 ? 1.05 : 1.15,
    color: useBgImage ? "#ffffff" : brand.textColor,
    letterSpacing: "-0.02em",
    textAlign,
    textShadow: useBgImage ? "0 1px 4px rgba(0,0,0,0.45)" : "none",
  };

  const bodyStyle: React.CSSProperties =
    design.split !== "none"
      ? {
          // The panel message line — "Make a plan today." — bold, Kōwhai
          // yellow on a dark panel (as in every Get Ready static), dark ink
          // on a light one.
          fontSize: design.messageSize,
          lineHeight: 1.25,
          fontWeight: 700,
          color: onPrimary === "#ffffff" ? "#ffe104" : brand.textColor,
          textAlign,
          display: "-webkit-box",
          WebkitLineClamp: design.bodyLines,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }
      : {
          fontSize: design.bodySize,
          lineHeight: 1.4,
          color: useBgImage ? "#ffffff" : brand.textColor,
          opacity: useBgImage ? 0.95 : 0.85,
          textAlign,
          textShadow: useBgImage ? "0 1px 3px rgba(0,0,0,0.4)" : "none",
          display: "-webkit-box",
          WebkitLineClamp: design.bodyLines,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        };

  // Sized to shipped AC posters: the search pill is discreet — text at body
  // size, total pill height ≈ 4% of the canvas, snug horizontal padding so
  // the pill text sits close to the copy block's left edge above it.
  const ctaStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    // On a split canvas the pill sits on the solid brand panel, so it flips to
    // white-on-dark exactly like the shipped Get Ready OOH search bars.
    backgroundColor: design.split === "none" ? brand.primaryColor : "#ffffff",
    color: design.split === "none" ? onPrimary : brand.primaryColor,
    fontSize: design.ctaSize,
    fontWeight: 700,
    padding: `${Math.max(5, design.ctaSize * 0.55)}px ${Math.max(12, design.ctaSize * 1.25)}px`,
    borderRadius: 9999,
    // Guidelines: CTAs are sentence case (search-bar treatment supplies its
    // own per-word weights/tracking via CtaLabel) — never uppercase.
    alignSelf: textAlign === "center" ? "center" : textAlign === "right" ? "flex-end" : "flex-start",
    marginTop: Math.max(4, height * 0.01),
    whiteSpace: "nowrap" as const,
    maxWidth: "100%",
  };

  const sideImageStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: "46%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "center",
    zIndex: 1,
  };

  // Soft seam so the full-bleed image melts into the background instead of
  // sitting on the canvas as a hard-edged rectangle.
  const bgHex = brand.backgroundColor || "#ffffff";
  const bgTransparent = /^#[0-9a-fA-F]{6}$/.test(bgHex) ? `${bgHex}00` : "transparent";
  const seamStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "50%",
    width: "14%",
    background: `linear-gradient(90deg, ${bgHex} 0%, ${bgTransparent} 100%)`,
    zIndex: 1,
    pointerEvents: "none",
  };

  // When the canvas is split, the photo is confined to its zone and
  // cover-cropped inside it (shipped AC creative crops oversized and offsets
  // the subject rather than letterboxing).
  const bgImageStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    width: design.split === "vertical" ? `${design.imageFraction * 100}%` : "100%",
    height: design.split === "horizontal" ? `${design.imageFraction * 100}%` : "100%",
    objectFit: "cover",
    objectPosition: "center",
    zIndex: 0,
  };

  // On split canvases the display headline sits ON the photograph, centred in
  // the image zone — every shipped Get Ready static does this in every size.
  const imageHeadlineStyle: React.CSSProperties = {
    position: "absolute",
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: margin,
    color: "#ffffff",
    fontWeight: 700,
    fontSize: design.headlineSize,
    lineHeight: design.headlineSize > 48 ? 1.05 : 1.15,
    letterSpacing: "-0.02em",
    textShadow: "0 2px 8px rgba(0,0,0,0.55)",
    ...(design.split === "vertical"
      ? { top: 0, bottom: 0, left: 0, width: `${design.imageFraction * 100}%` }
      : { top: 0, left: 0, right: 0, height: `${design.imageFraction * 100}%` }),
  };

  // Light scrim over just the image zone so the headline stays legible.
  const imageZoneScrimStyle: React.CSSProperties = {
    position: "absolute",
    zIndex: 1,
    background: "linear-gradient(180deg, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0.30) 100%)",
    ...(design.split === "vertical"
      ? { top: 0, bottom: 0, left: 0, width: `${design.imageFraction * 100}%` }
      : { top: 0, left: 0, right: 0, height: `${design.imageFraction * 100}%` }),
  };

  // The solid brand-colour message panel that carries copy on split canvases.
  const panelStyle: React.CSSProperties = {
    position: "absolute",
    zIndex: 1,
    backgroundColor: brand.primaryColor,
    ...(design.split === "vertical"
      ? { top: 0, bottom: 0, right: 0, width: `${(1 - design.imageFraction) * 100}%` }
      : { left: 0, right: 0, bottom: 0, height: `${(1 - design.imageFraction) * 100}%` }),
  };

  // Kotahitanga pattern band on the seam between image and panel — Kōwhai and
  // Shore tohu shapes on Ocean, as used on the Get Ready OOH.
  const seamBand = Math.max(6, Math.round(Math.min(width, height) * 0.055));
  const bandStyle: React.CSSProperties = {
    position: "absolute",
    zIndex: 2,
    backgroundColor: brand.primaryColor,
    backgroundImage:
      `repeating-linear-gradient(90deg, #ffe104 0 ${seamBand * 0.5}px, transparent ${seamBand * 0.5}px ${seamBand}px),` +
      `repeating-linear-gradient(90deg, transparent 0 ${seamBand}px, #0073bd ${seamBand}px ${seamBand * 1.6}px)`,
    ...(design.split === "vertical"
      ? { top: 0, right: 0, width: `${(1 - design.imageFraction) * 100}%`, height: seamBand }
      : { left: 0, right: 0, top: `${design.imageFraction * 100}%`, height: seamBand, transform: `translateY(-${seamBand / 2}px)` }),
  };

  // Darker at top and (especially) bottom where copy sits, lighter through the
  // middle so the image still reads. Paired with text-shadows this keeps the
  // headline legible regardless of how bright the underlying image is.
  const scrimStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    background:
      "linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.10) 32%, rgba(0,0,0,0.68) 100%)",
    zIndex: 1,
  };

  // ---- Strip (wide banner) layout styles -------------------------------
  const stripPad = Math.max(10, width * 0.02);
  const textOnStrip = useBgImage ? "#ffffff" : brand.textColor;
  const stripScrimStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    background:
      "linear-gradient(90deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.45) 55%, rgba(0,0,0,0.30) 100%)",
    zIndex: 1,
  };
  const stripContentStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    gap: Math.max(8, width * 0.02),
    paddingLeft: stripPad,
    // No right padding when the tile shows: the tile sits flush against the
    // right edge (corner grid cell), like shipped AC banner creative.
    paddingRight: showLogoBar && brand.logoUrl ? 0 : stripPad,
  };
  // Strip logo = the same master tile, full height, flush to the right edge
  // (guidelines: the tile occupies the corner grid cell). Never filtered.
  const stripLogoStyle: React.CSSProperties = {
    height,
    width: height,
    objectFit: "cover",
    flexShrink: 0,
  };
  const stripWordmarkStyle: React.CSSProperties = {
    color: textOnStrip,
    fontWeight: 800,
    fontSize: Math.max(11, height * 0.26),
    letterSpacing: "0.04em",
    whiteSpace: "nowrap",
    flexShrink: 0,
    // Capped so wordmark + CTA (each rigid) can't sum past the strip width and
    // crush/overflow the headline; the headline is the element that yields.
    maxWidth: "42%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    textShadow: useBgImage ? "0 1px 2px rgba(0,0,0,0.5)" : "none",
  };
  const stripHeadlineStyle: React.CSSProperties = {
    flex: "1 1 auto",
    fontSize: Math.max(13, Math.min(height * 0.36, width * 0.05)),
    fontWeight: 700,
    lineHeight: 1.05,
    color: textOnStrip,
    letterSpacing: "-0.01em",
    textShadow: useBgImage ? "0 1px 3px rgba(0,0,0,0.5)" : "none",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
  };
  const stripCtaStyle: React.CSSProperties = {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    backgroundColor: brand.primaryColor,
    color: onPrimary,
    fontSize: Math.max(11, Math.min(height * 0.24, width * 0.03)),
    fontWeight: 700,
    padding: `${Math.max(5, height * 0.15)}px ${Math.max(12, width * 0.022)}px`,
    borderRadius: 9999,
    // Sentence case per guidelines; CtaLabel supplies search-bar weights.
    whiteSpace: "nowrap",
    maxWidth: "40%",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const contentMaxWidth = design.copyWidth;

  const animationStyle = isAnimated
    ? { animation: "brandPulse 2.5s ease-in-out infinite" }
    : {};

  return (
    <div style={{ ...style, ...animationStyle }} data-template="canvas">
      <style>{`
        @keyframes brandPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.92; transform: scale(1.01); }
        }
        @keyframes textSlide {
          0% { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        [data-template="canvas"] [data-animate="headline"] {
          ${isAnimated ? "animation: textSlide 0.8s ease forwards;" : ""}
        }
        [data-template="canvas"] [data-animate="body"] {
          ${isAnimated ? "animation: textSlide 0.8s ease 0.3s both forwards;" : ""}
        }
        [data-template="canvas"] [data-animate="cta"] {
          ${isAnimated ? "animation: textSlide 0.8s ease 0.6s both forwards;" : ""}
        }
      `}</style>

      {useBgImage && <img src={imageUrl!} alt="" style={bgImageStyle} />}
      {useBgImage && design.split === "none" && <div style={isStrip ? stripScrimStyle : scrimStyle} />}
      {design.split !== "none" && (
        <>
          {useBgImage && <div style={imageZoneScrimStyle} />}
          <div style={panelStyle} />
          <div style={bandStyle} />
          {headline && (
            <div style={imageHeadlineStyle} data-animate="headline">
              <span>{headline}</span>
            </div>
          )}
        </>
      )}

      {showAccentBar && <div style={accentBar} />}

      {useSideImage && <img src={imageUrl!} alt="" style={sideImageStyle} />}
      {useSideImage && <div style={seamStyle} />}

      {isStrip ? (
        <div style={stripContentStyle}>
          {headline && (
            <div style={stripHeadlineStyle} data-animate="headline">
              {headline}
            </div>
          )}
          {callToAction && (
            <div style={stripCtaStyle} data-animate="cta">
              <CtaLabel text={callToAction} />
            </div>
          )}
          {showLogoTile ? (
            <img src={brand.logoUrl!} alt={brand.name} style={stripLogoStyle} />
          ) : (
            <span style={stripWordmarkStyle}>{brand.name.toUpperCase()}</span>
          )}
        </div>
      ) : (
        <>
          <div style={contentArea}>
            {headline && design.split === "none" && (
              <div style={{ ...headlineStyle, maxWidth: contentMaxWidth }} data-animate="headline">
                {headline}
              </div>
            )}
            {bodyText && design.showBody && (
              <div style={{ ...bodyStyle, maxWidth: contentMaxWidth }} data-animate="body">
                {bodyText}
              </div>
            )}
            {callToAction && (
              <div style={ctaStyle} data-animate="cta">
                <CtaLabel text={callToAction} />
              </div>
            )}
          </div>

          {showStrapline && (
            <div style={straplineStyle}>
              {straplineLines.map((line, i) => (
                <span key={i}>
                  {i > 0 && <br />}
                  {line}
                </span>
              ))}
            </div>
          )}

          {showLogoTile && (
            <img src={brand.logoUrl!} alt={brand.name} style={logoTileStyle} />
          )}
        </>
      )}
    </div>
  );
}

/** Pour brief content into a freeform element by its role; otherwise keep the
 *  element's own captured value. Locked elements are pinned brand furniture —
 *  their captured content always renders, regardless of role. */
function fillRoleText(
  el: FreeformElement,
  props: { headline?: string | null; bodyText?: string | null; callToAction?: string | null },
): string {
  if (el.locked) return el.text ?? "";
  if (el.role === "headline") return props.headline ?? el.text ?? "";
  if (el.role === "body" || el.role === "subhead") return props.bodyText ?? el.text ?? "";
  if (el.role === "cta") return props.callToAction ?? el.text ?? "";
  return el.text ?? "";
}

function fillRoleSrc(el: FreeformElement, imageUrl?: string | null): string | null {
  if (el.locked) return el.src ?? null;
  if (el.role === "product") return imageUrl ?? el.src ?? null;
  return el.src ?? null;
}

// ---- Shared freeform element styling (renderer + editor must not drift) -----

export function freeformBaseStyle(el: FreeformElement, zIndex: number): React.CSSProperties {
  return {
    position: "absolute",
    left: el.x ?? 0,
    top: el.y ?? 0,
    width: el.w ?? 0,
    height: el.h ?? 0,
    zIndex,
    opacity: el.opacity ?? 1,
  };
}

/** Hex + alpha -> rgba() (freeform gradients store alpha per stop). */
function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return hex;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}

export function freeformRectStyle(el: FreeformElement): React.CSSProperties {
  // Directional opacity gradients (e.g. imported InDesign gradient feathers —
  // a scrim fading over photography) render as a CSS linear-gradient.
  const grad = (el as { gradient?: { angle: number; stops: { color: string; alpha: number; at: number }[] } }).gradient;
  if (grad && Array.isArray(grad.stops) && grad.stops.length >= 2) {
    const stops = grad.stops
      .map((s) => `${hexWithAlpha(s.color, s.alpha)} ${Math.round(s.at * 100)}%`)
      .join(", ");
    return {
      background: `linear-gradient(${Math.round(grad.angle)}deg, ${stops})`,
      borderRadius: el.radius ?? 0,
      boxSizing: "border-box",
    };
  }
  return {
    backgroundColor: el.fill ?? "transparent",
    borderRadius: el.radius ?? 0,
    boxSizing: "border-box",
    ...(el.borderWidth ? { border: `${el.borderWidth}px solid ${el.borderColor ?? "#000000"}` } : {}),
  };
}

// Logos must never be cropped, so they default to "contain"; photos/decoration
// default to "cover" (fills the area). Shared by the renderer and the editor so
// the "follows role" default can't drift between them.
export function defaultImageFit(role: string | undefined | null): "cover" | "contain" {
  return role === "logo" ? "contain" : "cover";
}

export function freeformImageStyle(el: FreeformElement): React.CSSProperties {
  // An explicit `fit` always wins; otherwise fall back to the role default.
  const fit: "cover" | "contain" =
    el.fit === "contain" || el.fit === "cover" ? el.fit : defaultImageFit(el.role);
  // Key-visual artwork carries a focal point so cover crops frame the hero.
  const objectPosition =
    typeof el.focusX === "number" || typeof el.focusY === "number"
      ? `${Math.round((el.focusX ?? 0.5) * 100)}% ${Math.round((el.focusY ?? 0.5) * 100)}%`
      : "center";
  return { objectFit: fit, objectPosition, borderRadius: el.radius ?? 0 };
}

/**
 * Cap-height frames (`baselineFit: "cap"`): InDesign auto-sized frames hug
 * the cap height, and the server renderer puts the single line's baseline on
 * the frame's bottom edge. CSS would instead top-align the line box, sitting
 * the glyphs ~0.25em lower than the export. Measure the resolved font and
 * shift the line so its baseline lands on the frame bottom too.
 */
let capFitCanvas: CanvasRenderingContext2D | null | undefined;
export function capFitShift(el: FreeformElement, fontFamilyCss: string): number {
  const fit = (el as { baselineFit?: string }).baselineFit;
  if (fit !== "cap" || !el.text || el.text.includes("\n") || !(el.h && el.h > 0)) return 0;
  try {
    if (capFitCanvas === undefined) capFitCanvas = document.createElement("canvas").getContext("2d");
    if (!capFitCanvas) return 0;
    const fs = el.fontSize ?? 16;
    capFitCanvas.font = `${el.fontStyle === "italic" ? "italic" : "normal"} ${el.fontWeight ?? 400} ${fs}px ${fontFamilyCss}`;
    const m = capFitCanvas.measureText("Hg");
    const asc = m.fontBoundingBoxAscent ?? fs * 0.8;
    const desc = m.fontBoundingBoxDescent ?? fs * 0.2;
    const lineHeightPx = (el.lineHeight ?? 1.2) * fs;
    const baselineFromTop = (lineHeightPx - (asc + desc)) / 2 + asc;
    return Math.round((el.h - baselineFromTop) * 10) / 10;
  } catch {
    return 0;
  }
}

/** Re-render once web fonts finish loading so cap-fit measurements use the real face. */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState<boolean>(() => (typeof document !== "undefined" && "fonts" in document ? document.fonts.status === "loaded" : true));
  useEffect(() => {
    if (ready || typeof document === "undefined" || !("fonts" in document)) return;
    let alive = true;
    document.fonts.ready.then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [ready]);
  return ready;
}

export function freeformTextStyle(el: FreeformElement, brandFontFamily: string): React.CSSProperties {
  const fontFamilyCss = el.fontFamily ? `"${el.fontFamily}", ${brandFontStack(brandFontFamily)}` : brandFontStack(brandFontFamily);
  const shift = capFitShift(el, fontFamilyCss);
  return {
    ...(shift ? { transform: `translateY(${shift}px)` } : {}),
    fontFamily: fontFamilyCss,
    fontSize: el.fontSize ?? 16,
    fontWeight: el.fontWeight ?? 400,
    fontStyle: el.fontStyle === "italic" ? "italic" : "normal",
    color: el.color ?? "#111827",
    textAlign: (el.align as React.CSSProperties["textAlign"]) ?? "left",
    lineHeight: el.lineHeight ?? 1.2,
    whiteSpace: "pre-wrap",
    // Copy is never cropped by its box: the box is a layout guide, the text
    // may extend past it (composer/editor size boxes from a wrap estimate).
    overflow: "visible",
    ...(el.letterSpacing != null ? { letterSpacing: el.letterSpacing } : {}),
  };
}

function FreeformCanvas({
  brand,
  headline,
  bodyText,
  callToAction,
  imageUrl,
  width,
  height,
  isAnimated,
  elements,
}: TemplateProps & { width: number; height: number; elements: FreeformElement[] }) {
  useFontsReady();
  const containerStyle: React.CSSProperties = {
    width,
    height,
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#ffffff",
    fontFamily: brandFontStack(brand.fontFamily),
  };

  return (
    <div style={containerStyle} data-template="freeform">
      <style>{`
        @keyframes ffSlide {
          0% { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        [data-template="freeform"] [data-animate="headline"] { ${isAnimated ? "animation: ffSlide 0.8s ease forwards;" : ""} }
        [data-template="freeform"] [data-animate="body"] { ${isAnimated ? "animation: ffSlide 0.8s ease 0.3s both forwards;" : ""} }
        [data-template="freeform"] [data-animate="cta"] { ${isAnimated ? "animation: ffSlide 0.8s ease 0.6s both forwards;" : ""} }
      `}</style>

      {elements.map((el, i) => {
        if (el.type === "rect") {
          return <div key={el.id ?? `el-${i}`} style={{ ...freeformBaseStyle(el, i + 1), ...freeformRectStyle(el) }} />;
        }

        if (el.type === "image") {
          const src = fillRoleSrc(el, imageUrl);
          if (!src) return null;
          return (
            <img
              key={el.id ?? `el-${i}`}
              src={src}
              alt={el.role ?? ""}
              style={{ ...freeformBaseStyle(el, i + 1), ...freeformImageStyle(el) }}
            />
          );
        }

        if (el.type === "text") {
          const text = fillRoleText(el, { headline, bodyText, callToAction });
          if (!text) return null;
          const animate = el.role === "headline" || el.role === "body" || el.role === "cta" ? el.role : undefined;
          return (
            <div
              key={el.id ?? `el-${i}`}
              data-animate={animate}
              // Copy always sits on top: text z-indexes live in a band above
              // every image/rect layer, preserving order among the texts.
              style={{ ...freeformBaseStyle(el, i + 1001), height: "auto", ...freeformTextStyle(el, brand.fontFamily) }}
            >
              {text}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

const SIZE_CONFIGS = {
  social_square: { width: 1080, height: 1080, label: "Social Square", dims: "1080×1080" },
  story: { width: 1080, height: 1920, label: "Story", dims: "1080×1920" },
  banner: { width: 728, height: 90, label: "Banner", dims: "728×90" },
  print_a4: { width: 2480, height: 3508, label: "Print A4", dims: "2480×3508", layout: { showStrapline: true } },
  animated_social: { width: 1080, height: 1080, label: "Animated Social", dims: "1080×1080" },
};

const PREVIEW_SCALES: Record<string, number> = {
  social_square: 0.22,
  story: 0.14,
  banner: 0.45,
  print_a4: 0.1,
  animated_social: 0.22,
};

const BUILTIN_LABELS: Record<string, string> = {
  social_square: "Social Square (1080×1080)",
  story: "Story (1080×1920)",
  banner: "Banner (728×90)",
  print_a4: "Print A4",
  animated_social: "Animated Social",
  html_banner: "HTML Banner (AI)",
};

// ---- Reactive registry for user-defined custom templates -------------------

export function computePreviewScale(width: number, height: number): number {
  const target = 240;
  return Math.min(0.5, Math.max(0.04, target / Math.max(width, height)));
}

let CUSTOM_CONFIGS: Record<string, ResolvedConfig> = {};
const listeners = new Set<() => void>();

export function registerTemplateConfigs(templates: Template[]): void {
  const next: Record<string, ResolvedConfig> = {};
  for (const t of templates) {
    next[t.key] = {
      width: t.width,
      height: t.height,
      label: `${t.name} (${t.dims})`,
      dims: t.dims,
      scale: computePreviewScale(t.width, t.height),
      layout: t.config as LayoutOptions,
      kind: t.config?.kind,
      elements: t.config?.elements,
    };
  }
  CUSTOM_CONFIGS = next;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getCustomSnapshot(): Record<string, ResolvedConfig> {
  return CUSTOM_CONFIGS;
}

function useCustomConfigs(): Record<string, ResolvedConfig> {
  return useSyncExternalStore(subscribe, getCustomSnapshot, getCustomSnapshot);
}

function builtinConfig(key: string): ResolvedConfig | undefined {
  const c = SIZE_CONFIGS[key as keyof typeof SIZE_CONFIGS];
  if (!c) return undefined;
  return { ...c, scale: PREVIEW_SCALES[key] ?? 0.22 };
}

/** Resolve a template config for use OUTSIDE React (e.g. gif export). */
export function getTemplateConfig(key: string): ResolvedConfig {
  return builtinConfig(key) ?? CUSTOM_CONFIGS[key] ?? builtinConfig("social_square")!;
}

/** Resolve a human-readable label for any template key (built-in or custom). */
export function getTemplateLabel(key: string): string {
  return BUILTIN_LABELS[key] ?? CUSTOM_CONFIGS[key]?.label ?? key;
}

/** 1080×1080 organic/paid social tiles carry no pōhutukawa logo — the channel
 *  profile picture provides the branding (AC brand guidelines, social rules).
 *  An explicit layout.showLogoBar still overrides either way. */
const SOCIAL_NO_LOGO_SIZES = new Set(["social_square", "animated_social"]);
function applySocialLogoRule(templateSize: string, layout?: LayoutOptions): LayoutOptions | undefined {
  if (!SOCIAL_NO_LOGO_SIZES.has(templateSize)) return layout;
  if (layout?.showLogoBar !== undefined) return layout;
  return { ...layout, showLogoBar: false };
}

export function TemplateRenderer({ templateSize, brand, headline, bodyText, callToAction, imageUrl, isAnimated, scale, overrideConfig }: WrapperProps) {
  const custom = useCustomConfigs();
  const resolved: ResolvedConfig = overrideConfig
    ? { width: overrideConfig.width, height: overrideConfig.height, label: "", dims: "", scale: computePreviewScale(overrideConfig.width, overrideConfig.height), layout: overrideConfig.layout, kind: overrideConfig.kind, elements: overrideConfig.elements }
    : builtinConfig(templateSize) ?? custom[templateSize] ?? builtinConfig("social_square")!;
  const s = scale ?? resolved.scale;
  const { width, height, layout, kind, elements } = resolved;
  const animated = isAnimated ?? templateSize === "animated_social";

  return (
    <div style={{ transform: `scale(${s})`, transformOrigin: "top left", width: width, height: height, flexShrink: 0 }}>
      {kind === "freeform" && elements ? (
        <FreeformCanvas
          brand={brand}
          headline={headline}
          bodyText={bodyText}
          callToAction={callToAction}
          imageUrl={imageUrl}
          isAnimated={animated}
          width={width}
          height={height}
          elements={elements}
        />
      ) : (
        <BrandCanvas
          brand={brand}
          headline={headline}
          bodyText={bodyText}
          callToAction={callToAction}
          imageUrl={imageUrl}
          isAnimated={animated}
          width={width}
          height={height}
          layout={applySocialLogoRule(templateSize, layout)}
        />
      )}
    </div>
  );
}

export function TemplateThumbnail({
  templateSize,
  brand,
  headline,
  bodyText,
  callToAction,
  imageUrl,
  isAnimated,
  overrideConfig,
  maxWidth,
  maxHeight,
}: WrapperProps & { maxWidth?: number; maxHeight?: number }) {
  const custom = useCustomConfigs();
  const resolved: ResolvedConfig = overrideConfig
    ? { width: overrideConfig.width, height: overrideConfig.height, label: "", dims: "", scale: computePreviewScale(overrideConfig.width, overrideConfig.height), layout: overrideConfig.layout, kind: overrideConfig.kind, elements: overrideConfig.elements }
    : builtinConfig(templateSize) ?? custom[templateSize] ?? builtinConfig("social_square")!;
  // A preview always shows the WHOLE format: fit inside the box it's given
  // on both axes (tall and wide formats alike), never crop.
  const s = Math.min(
    resolved.scale,
    maxWidth ? maxWidth / resolved.width : Infinity,
    maxHeight ? maxHeight / resolved.height : Infinity,
  );
  const { width, height, layout, kind, elements } = resolved;
  const animated = isAnimated ?? templateSize === "animated_social";
  const previewW = Math.round(width * s);
  const previewH = Math.round(height * s);

  return (
    <div style={{ width: previewW, height: previewH, overflow: "hidden", flexShrink: 0, position: "relative" }}>
      <div style={{ transform: `scale(${s})`, transformOrigin: "top left", width, height, position: "absolute" }}>
        {kind === "freeform" && elements ? (
          <FreeformCanvas
            brand={brand}
            headline={headline}
            bodyText={bodyText}
            callToAction={callToAction}
            imageUrl={imageUrl}
            isAnimated={animated}
            width={width}
            height={height}
            elements={elements}
          />
        ) : (
          <BrandCanvas
            brand={brand}
            headline={headline}
            bodyText={bodyText}
            callToAction={callToAction}
            imageUrl={imageUrl}
            isAnimated={animated}
            width={width}
            height={height}
            layout={applySocialLogoRule(templateSize, layout)}
          />
        )}
      </div>
    </div>
  );
}

/** Built-in label map kept for backward compatibility (built-in keys only). */
export const TEMPLATE_SIZE_LABELS: Record<string, string> = BUILTIN_LABELS;

export const ALL_TEMPLATE_SIZES = [...Object.keys(SIZE_CONFIGS), "html_banner"];
export { SIZE_CONFIGS };
