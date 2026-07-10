import { Brand, FreeformElement, Template } from "@workspace/api-client-react";
import { useSyncExternalStore } from "react";

export type LayoutOptions = {
  contentAlignment?: "top" | "center" | "bottom";
  textAlign?: "left" | "center" | "right";
  showAccentBar?: boolean;
  showLogoBar?: boolean;
  imageStyle?: "side" | "background";
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
  const showAccentBar = layout?.showAccentBar !== false;
  const showLogoBar = layout?.showLogoBar !== false;
  const imageMode = layout?.imageStyle ?? "background";
  // Very wide & short formats (e.g. 728×90 banners) can't use the vertical
  // headline/body/CTA stack — it crushes the headline to ~10px. They get a
  // dedicated horizontal "strip" layout instead.
  const isStrip = width >= 300 && height <= width * 0.35;
  const useSideImage = !isStrip && imageMode === "side" && !!imageUrl;
  const useBgImage = !!imageUrl && (imageMode === "background" || isStrip);
  // Legible ink for marks set on the brand's primary colour (CTA, logo bar).
  const onPrimary = readableOn(brand.primaryColor);
  const textAlign: "left" | "center" | "right" = layout?.textAlign ?? "left";
  const alignItems = textAlign === "center" ? "center" : textAlign === "right" ? "flex-end" : "flex-start";
  const justifyContent =
    layout?.contentAlignment === "top"
      ? "flex-start"
      : layout?.contentAlignment === "bottom"
        ? "flex-end"
        : layout?.contentAlignment === "center"
          ? "center"
          : imageUrl
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

  const accentBar: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: Math.max(4, height * 0.015),
    backgroundColor: brand.primaryColor,
    zIndex: 3,
  };

  const logoBar: React.CSSProperties = {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: Math.max(24, height * 0.08),
    backgroundColor: brand.primaryColor,
    display: "flex",
    alignItems: "center",
    paddingLeft: Math.max(8, width * 0.05),
    zIndex: 3,
  };

  const logoStyle: React.CSSProperties = {
    height: Math.max(12, height * 0.04),
    objectFit: "contain",
    filter: onPrimary === "#ffffff" ? "brightness(0) invert(1)" : "brightness(0)",
  };

  const contentArea: React.CSSProperties = {
    position: "absolute",
    top: Math.max(8, height * 0.05),
    left: Math.max(10, width * 0.05),
    right: useSideImage ? Math.max(10, width * 0.5) : Math.max(10, width * 0.05),
    bottom: showLogoBar ? Math.max(24, height * 0.1) : Math.max(10, height * 0.04),
    display: "flex",
    flexDirection: "column",
    justifyContent,
    alignItems,
    textAlign,
    gap: Math.max(4, height * 0.02),
    zIndex: 2,
  };

  const headlineStyle: React.CSSProperties = {
    fontSize: Math.max(10, Math.min(width * 0.065, height * 0.065)),
    fontWeight: 700,
    lineHeight: 1.15,
    color: useBgImage ? "#ffffff" : brand.textColor,
    letterSpacing: "-0.02em",
    textAlign,
    textShadow: useBgImage ? "0 1px 4px rgba(0,0,0,0.45)" : "none",
  };

  const bodyStyle: React.CSSProperties = {
    fontSize: Math.max(9, width * 0.03),
    lineHeight: 1.4,
    color: useBgImage ? "#ffffff" : brand.textColor,
    opacity: useBgImage ? 0.95 : 0.85,
    textAlign,
    textShadow: useBgImage ? "0 1px 3px rgba(0,0,0,0.4)" : "none",
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };

  const ctaStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    backgroundColor: brand.primaryColor,
    color: onPrimary,
    fontSize: Math.max(11, width * 0.028),
    fontWeight: 700,
    padding: `${Math.max(6, height * 0.022)}px ${Math.max(14, width * 0.06)}px`,
    borderRadius: 9999,
    letterSpacing: "0.05em",
    alignSelf: textAlign === "center" ? "center" : textAlign === "right" ? "flex-end" : "flex-start",
    textTransform: "uppercase",
    marginTop: Math.max(4, height * 0.01),
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

  const bgImageStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "center",
    zIndex: 0,
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
    paddingRight: stripPad,
  };
  const stripLogoStyle: React.CSSProperties = {
    height: Math.max(16, height * 0.46),
    width: "auto",
    objectFit: "contain",
    flexShrink: 0,
    filter: useBgImage ? "brightness(0) invert(1)" : "none",
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
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    maxWidth: "40%",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const contentMaxWidth = "100%";

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
      {useBgImage && <div style={isStrip ? stripScrimStyle : scrimStyle} />}

      {showAccentBar && <div style={accentBar} />}

      {useSideImage && <img src={imageUrl!} alt="" style={sideImageStyle} />}
      {useSideImage && <div style={seamStyle} />}

      {isStrip ? (
        <div style={stripContentStyle}>
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.name} style={stripLogoStyle} />
          ) : (
            <span style={stripWordmarkStyle}>{brand.name.toUpperCase()}</span>
          )}
          {headline && (
            <div style={stripHeadlineStyle} data-animate="headline">
              {headline}
            </div>
          )}
          {callToAction && (
            <div style={stripCtaStyle} data-animate="cta">
              {callToAction}
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={contentArea}>
            {headline && (
              <div style={{ ...headlineStyle, maxWidth: contentMaxWidth }} data-animate="headline">
                {headline}
              </div>
            )}
            {bodyText && (
              <div style={{ ...bodyStyle, maxWidth: contentMaxWidth }} data-animate="body">
                {bodyText}
              </div>
            )}
            {callToAction && (
              <div style={ctaStyle} data-animate="cta">
                {callToAction}
              </div>
            )}
          </div>

          {showLogoBar && (
            <div style={logoBar}>
              {brand.logoUrl ? (
                <img src={brand.logoUrl} alt={brand.name} style={logoStyle} />
              ) : (
                <span style={{ color: onPrimary, fontWeight: 700, fontSize: Math.max(8, height * 0.025), letterSpacing: "0.08em" }}>
                  {brand.name.toUpperCase()}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Pour brief content into a freeform element by its role; otherwise keep the
 *  element's own captured value. */
function fillRoleText(
  el: FreeformElement,
  props: { headline?: string | null; bodyText?: string | null; callToAction?: string | null },
): string {
  if (el.role === "headline") return props.headline ?? el.text ?? "";
  if (el.role === "body" || el.role === "subhead") return props.bodyText ?? el.text ?? "";
  if (el.role === "cta") return props.callToAction ?? el.text ?? "";
  return el.text ?? "";
}

function fillRoleSrc(el: FreeformElement, imageUrl?: string | null): string | null {
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

export function freeformRectStyle(el: FreeformElement): React.CSSProperties {
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
  return { objectFit: fit, objectPosition: "center", borderRadius: el.radius ?? 0 };
}

export function freeformTextStyle(el: FreeformElement, brandFontFamily: string): React.CSSProperties {
  return {
    fontFamily: el.fontFamily
      ? `"${el.fontFamily}", ${brandFontStack(brandFontFamily)}`
      : brandFontStack(brandFontFamily),
    fontSize: el.fontSize ?? 16,
    fontWeight: el.fontWeight ?? 400,
    fontStyle: el.fontStyle === "italic" ? "italic" : "normal",
    color: el.color ?? "#111827",
    textAlign: (el.align as React.CSSProperties["textAlign"]) ?? "left",
    lineHeight: el.lineHeight ?? 1.2,
    whiteSpace: "pre-wrap",
    overflow: "hidden",
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
              style={{ ...freeformBaseStyle(el, i + 1), height: "auto", ...freeformTextStyle(el, brand.fontFamily) }}
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
  print_a4: { width: 2480, height: 3508, label: "Print A4", dims: "2480×3508" },
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
          layout={layout}
        />
      )}
    </div>
  );
}

export function TemplateThumbnail({ templateSize, brand, headline, bodyText, callToAction, imageUrl, isAnimated, overrideConfig }: WrapperProps) {
  const custom = useCustomConfigs();
  const resolved: ResolvedConfig = overrideConfig
    ? { width: overrideConfig.width, height: overrideConfig.height, label: "", dims: "", scale: computePreviewScale(overrideConfig.width, overrideConfig.height), layout: overrideConfig.layout, kind: overrideConfig.kind, elements: overrideConfig.elements }
    : builtinConfig(templateSize) ?? custom[templateSize] ?? builtinConfig("social_square")!;
  const s = resolved.scale;
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
            layout={layout}
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
