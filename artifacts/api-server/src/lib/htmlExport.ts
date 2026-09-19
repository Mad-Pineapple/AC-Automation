/**
 * HTML5 ad package exporter — freeform template → self-contained creative.
 *
 * Deterministic (no AI): every element is written as absolutely-positioned
 * HTML/CSS matching the app's renderer, with National 2 embedded from the
 * deployment's own font files and images packaged alongside. The package
 * carries everything media partners validate and everything the studio
 * needs to measure it:
 *
 *  - `<meta name="ad.size">` + CM360/DV360 `clickTag` wiring
 *  - a creative ID and campaign / format / variant / layout tags as data
 *    attributes, appended to click-throughs as UTM parameters
 *  - analytics beacons (impression, viewable ≥50% for 1s with in-view time,
 *    first interaction, click) to the studio's /track/c/<token> endpoints
 *  - dynamic content: text and image elements read overrides from URL
 *    parameters (?headline=…&body=…&cta=…&image=…) or a JSON feed (?feed=…),
 *    with the baked copy as fallback so the creative never renders empty
 *  - fluid mode: the creative scales to its container when `?fluid=1`
 *  - an entrance animation (artwork → copy → logo) in pure CSS
 */
import JSZip from "jszip";
import sharp from "sharp";
import type { FreeformConfig, FreeformElement, FreeformImage, FreeformRect, FreeformText } from "./freeform";
import { inferSlots } from "./slots";

export interface CreativeTags {
  token: string;
  name: string;
  campaign?: string | null;
  format: string;
  variant?: string | null;
  layoutLabel?: string | null;
}

export type AnimationPreset = "none" | "entrance" | "kenburns" | "frames" | "reveal" | "getready";
/** Canva-style motion library: artwork and copy move independently. */
export type ArtworkMotion = "none" | "kenburns" | "drift" | "zoomout" | "breathe" | "wipe";
export type CopyMotion = "none" | "fade" | "rise" | "pan" | "pop" | "wipe" | "baseline" | "tumble" | "typewriter" | "block";
export const ARTWORK_MOTIONS: ArtworkMotion[] = ["none", "kenburns", "drift", "zoomout", "breathe", "wipe"];
export const COPY_MOTIONS: CopyMotion[] = ["none", "fade", "rise", "pan", "pop", "wipe", "baseline", "tumble", "typewriter", "block"];

export interface HtmlExportOptions {
  width: number;
  height: number;
  config: FreeformConfig;
  tags: CreativeTags;
  /** Landing page; UTM tags are appended. */
  clickUrl?: string | null;
  /** Absolute origin of the studio (beacons + asset fetching). */
  studioBase: string;
  brandFontFamily?: string;
  /** Kept for callers that only know on/off: false => "none". */
  animate?: boolean;
  /** Motion preset. All CSS, spec-checked: ends within durationSec, loops ≤ 3,
   * reduced-motion respected, clickTag layer untouched. */
  animation?: AnimationPreset;
  /** Replay the motion captured from the HTML key visual the artwork came
   *  from, when its layers carry motion tracks (default true). The preset
   *  and motion library apply only to artwork without captured motion. */
  matchKeyVisual?: boolean;
  /** Motion library (takes precedence over `animation` when given). */
  artworkMotion?: ArtworkMotion;
  copyMotion?: CopyMotion;
  storyFrames?: boolean;
  /** Brand colour for block reveals. */
  accentColor?: string;
  /** Total duration of one cycle in seconds (IAB display: ≤ 15s). */
  durationSec?: number;
  /** Cycles (IAB display: ≤ 3). */
  loops?: number;
  fluid?: boolean;
  /** Third-party tracking pixel URLs (Floodlight/conversion pixels) fired on
   * load; https only. Ad-server macros are left untouched for expansion. */
  pixelUrls?: string[];
  /** Preview mode: inline fonts/images as data URIs (single self-contained
   * HTML for an iframe srcdoc) and send no analytics beacons. */
  inline?: boolean;
  /** Campaign fonts available for embedding (only families the creative's
   * copy references are packaged). */
  customFonts?: { family: string; src: string; format: "truetype" | "opentype" }[];
  /** Fetch bytes for a src (storage object, public file, absolute URL). */
  loadAsset: (src: string) => Promise<{ bytes: Buffer; contentType: string } | null>;
  /** Internal (responsive packages): share one zip and file list across
   * sizes, prefix asset and keyframe names per size, load fonts once. */
  _zip?: JSZip;
  _files?: string[];
  _sizeIndex?: number;
  _skipFonts?: boolean;
}

/** One size's rendered stage, for assembling several into one document. */
export interface RenderedStage {
  width: number;
  height: number;
  format: string;
  body: string;
  keyframes: string;
  fontFaces: string[];
  durationSec: number;
  loops: number;
  motionSource: "key-visual" | "studio";
  animation: string;
  artworkMotion: ArtworkMotion;
  copyMotion: CopyMotion;
  storyFrames: boolean;
  wipeStage: boolean;
  /** Ground colour of the artwork, worn by the stage. */
  bg?: string;
}

export interface HtmlPackage {
  zip: Buffer;
  html: string;
  files: string[];
  stage?: RenderedStage;
}

const FONT_FILES = [
  { file: "fonts/national2-regular.woff", weight: 400, src: "/fonts/national2-regular.woff" },
  { file: "fonts/national2-bold.woff", weight: 700, src: "/fonts/national2-bold.woff" },
];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${Math.max(0, Math.min(1, alpha))})`;
}

function safeFileName(src: string, index: number, contentType: string, prefix = ""): string {
  const ext =
    contentType.includes("png") ? "png"
    : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg"
    : contentType.includes("svg") ? "svg"
    : contentType.includes("webp") ? "webp"
    : contentType.includes("gif") ? "gif"
    : (src.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "").slice(0, 4) || "bin";
  return `assets/${prefix}img-${index}.${ext}`;
}

/**
 * Ad weight matters (publishers cap standard display around 150–200KB), so
 * every packaged image is resized to what the creative can actually show:
 * at most 2× the element box (retina), re-encoded as JPEG unless it has
 * transparency (logos), which stays PNG. Originals are never modified.
 */
async function optimizeForExport(
  bytes: Buffer,
  contentType: string,
  boxW: number,
  boxH: number,
): Promise<{ bytes: Buffer; contentType: string }> {
  try {
    if (contentType.includes("svg")) return { bytes, contentType };
    const img = sharp(bytes, { failOn: "none" });
    const meta = await img.metadata();
    const maxW = Math.max(16, Math.round(boxW * 2));
    const maxH = Math.max(16, Math.round(boxH * 2));
    const needsResize = (meta.width ?? 0) > maxW || (meta.height ?? 0) > maxH;
    const pipeline = needsResize ? img.resize({ width: maxW, height: maxH, fit: "inside", withoutEnlargement: true }) : img;
    // An alpha CHANNEL is not transparency: photos cropped from a document
    // PDF are RGBA with every pixel opaque, and keeping them PNG shipped a
    // 430KB photograph in a 160×600 banner. Only real transparency stays PNG.
    let transparent = !!meta.hasAlpha;
    if (transparent) {
      try { transparent = !(await sharp(bytes, { failOn: "none" }).stats()).isOpaque; } catch { /* keep PNG */ }
    }
    if (transparent) {
      return { bytes: await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer(), contentType: "image/png" };
    }
    if (meta.hasAlpha) {
      return { bytes: await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer(), contentType: "image/jpeg" };
    }
    return { bytes: await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer(), contentType: "image/jpeg" };
  } catch {
    return { bytes, contentType };
  }
}

/**
 * A cover-fit photograph is usually far larger than the part of it a banner
 * can show: the 160×600 Storms photo is a 467×418 box on a 160px canvas, and
 * two thirds of its pixels were shipped to sit outside the stage. Crop to
 * the part that falls on the canvas (plus a margin the artwork motion can
 * move into) before the resize. Returns the box the cropped image occupies.
 */
async function cropToCanvas(
  bytes: Buffer,
  el: FreeformImage,
  canvasW: number,
  canvasH: number,
  margin: number,
): Promise<{ bytes: Buffer; box: { x: number; y: number; w: number; h: number } } | null> {
  try {
    if (el.fit !== "cover" || (el.radius ?? 0) > 0) return null;
    const meta = await sharp(bytes, { failOn: "none" }).metadata();
    const nw = meta.width ?? 0, nh = meta.height ?? 0;
    if (nw < 2 || nh < 2 || el.w < 2 || el.h < 2) return null;
    const vx0 = Math.max(0, -el.x - margin), vy0 = Math.max(0, -el.y - margin);
    const vx1 = Math.min(el.w, canvasW - el.x + margin), vy1 = Math.min(el.h, canvasH - el.y + margin);
    if (vx1 - vx0 < 2 || vy1 - vy0 < 2) return null;
    // Only worth it when a real share of the picture is off-stage.
    if ((vx1 - vx0) * (vy1 - vy0) > el.w * el.h * 0.8) return null;
    const k = Math.max(el.w / nw, el.h / nh);
    const dw = nw * k, dh = nh * k;
    const ox = (el.w - dw) * (el.focusX ?? 0.5), oy = (el.h - dh) * (el.focusY ?? 0.5);
    const left = Math.max(0, Math.floor((vx0 - ox) / k)), top = Math.max(0, Math.floor((vy0 - oy) / k));
    const width = Math.min(nw - left, Math.ceil((vx1 - vx0) / k)), height = Math.min(nh - top, Math.ceil((vy1 - vy0) / k));
    if (width < 2 || height < 2) return null;
    const out = await sharp(bytes, { failOn: "none" }).extract({ left, top, width, height }).toBuffer();
    return { bytes: out, box: { x: el.x + vx0, y: el.y + vy0, w: vx1 - vx0, h: vy1 - vy0 } };
  } catch {
    return null;
  }
}

function rectStyle(el: FreeformRect): string {
  const parts: string[] = [];
  if (el.gradient && el.gradient.stops.length >= 2) {
    const stops = el.gradient.stops.map((s) => `${hexWithAlpha(s.color, s.alpha)} ${Math.round(s.at * 100)}%`).join(", ");
    parts.push(`background:linear-gradient(${Math.round(el.gradient.angle)}deg, ${stops})`);
  } else {
    parts.push(`background-color:${el.fill}`);
  }
  if (el.radius) parts.push(`border-radius:${el.radius}px`);
  if (el.borderWidth) parts.push(`border:${el.borderWidth}px solid ${el.borderColor ?? "#000"}`);
  return parts.join(";");
}

function imageStyle(el: FreeformImage): string {
  const fit = el.fit ?? (el.role === "logo" ? "contain" : "cover");
  const pos =
    typeof el.focusX === "number" || typeof el.focusY === "number"
      ? `${Math.round((el.focusX ?? 0.5) * 100)}% ${Math.round((el.focusY ?? 0.5) * 100)}%`
      : "center";
  return `object-fit:${fit};object-position:${pos};border-radius:${el.radius ?? 0}px`;
}

function textStyle(el: FreeformText, brandFont: string): string {
  // Single quotes: these land inside a double-quoted style attribute.
  const fam = el.fontFamily ? `'${el.fontFamily.replace(/'/g, "")}', ` : "";
  return [
    `font-family:${fam}'National 2', '${brandFont.replace(/'/g, "")}', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
    `font-size:${el.fontSize ?? 16}px`,
    `font-weight:${el.fontWeight ?? 400}`,
    `font-style:${el.fontStyle === "italic" ? "italic" : "normal"}`,
    `color:${el.color ?? "#111827"}`,
    `text-align:${el.align ?? "left"}`,
    `line-height:${el.lineHeight ?? 1.2}`,
    "white-space:pre-wrap",
    "overflow:visible",
    ...(el.letterSpacing != null ? [`letter-spacing:${el.letterSpacing}px`] : []),
  ].join(";");
}

function dynamicKey(el: FreeformText): string | null {
  switch (el.role) {
    case "headline": return "headline";
    case "subhead": return "subhead";
    case "body": return "body";
    case "cta": return "cta";
    default: return null;
  }
}

const SHARED_KEYFRAMES = `@keyframes enter{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes kenburns{from{transform:scale(1)}to{transform:scale(1.08)}}
@keyframes drift{0%{transform:scale(1.06) translate(0,0)}100%{transform:scale(1.06) translate(-2.5%,1.5%)}}
@keyframes zoomout{from{transform:scale(1.12)}to{transform:scale(1)}}
@keyframes breathe{from{transform:scale(1)}to{transform:scale(1.035)}}
@keyframes fadein{from{opacity:0}to{opacity:1}}
@keyframes pan{from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:none}}
@keyframes pop{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:scale(1)}}
@keyframes wipein{from{clip-path:inset(0 100% 0 0);opacity:1}to{clip-path:inset(0 0 0 0);opacity:1}}
@keyframes baseline{from{clip-path:inset(0 0 100% 0);transform:translateY(18px)}to{clip-path:inset(0 0 0 0);transform:none}}
@keyframes tumble{from{opacity:0;transform:rotate(-5deg) translateY(16px);transform-origin:left bottom}to{opacity:1;transform:none}}
@keyframes blockwipe{0%{transform:scaleX(0);transform-origin:left center}45%{transform:scaleX(1);transform-origin:left center}55%{transform:scaleX(1);transform-origin:right center}100%{transform:scaleX(0);transform-origin:right center}}
.tw .w{opacity:0;animation:fadein .18s ease-out both}
@keyframes wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
/* Story frames: 1 = hook, 2 = support, 3 = end-frame (holds). */
@keyframes frame1{0%{opacity:0;transform:translateY(12px)}6%{opacity:1;transform:none}36%{opacity:1}42%{opacity:0;transform:translateY(-8px)}100%{opacity:0}}
@keyframes frame2{0%{opacity:0}40%{opacity:0;transform:translateY(12px)}46%{opacity:1;transform:none}66%{opacity:1}72%{opacity:0;transform:translateY(-8px)}100%{opacity:0}}
@keyframes frame3{0%{opacity:0}70%{opacity:0;transform:translateY(12px)}76%{opacity:1;transform:none}100%{opacity:1}}`;

export async function buildHtmlPackage(opts: HtmlExportOptions): Promise<HtmlPackage> {
  const { width, height, config, tags, studioBase } = opts;
  const zip = opts._zip ?? new JSZip();
  const files: string[] = opts._files ?? [];
  const brandFont = opts.brandFontFamily ?? "National 2";
  const sizePrefix = opts._sizeIndex != null ? `s${opts._sizeIndex}-` : "";
  const kvPrefix = opts._sizeIndex != null ? `s${opts._sizeIndex}_` : "";

  // Fonts: embedded from the deployment's own files.
  const fontFaces: string[] = [];
  // Only the weights this banner sets: every package carried both National 2
  // files (95KB) though most banners set bold alone.
  const brandWeights = new Set<number>();
  for (const e of config.elements) {
    if (e.type !== "text") continue;
    const fam = (e.fontFamily ?? "").toLowerCase();
    if (fam && fam !== "national 2" && fam !== brandFont.toLowerCase()) { brandWeights.add(e.fontWeight === 700 ? 700 : 400); continue; }
    brandWeights.add(e.fontWeight === 700 ? 700 : 400);
  }
  for (const f of opts._skipFonts ? [] : FONT_FILES) {
    if (brandWeights.size > 0 && !brandWeights.has(f.weight)) continue;
    const asset = await opts.loadAsset(f.src);
    if (asset) {
      let ref = f.file;
      if (opts.inline) {
        ref = `data:font/woff;base64,${asset.bytes.toString("base64")}`;
      } else {
        zip.file(f.file, asset.bytes);
        files.push(f.file);
      }
      fontFaces.push(`@font-face{font-family:"National 2";font-weight:${f.weight};font-style:normal;src:url("${ref}") format("woff");font-display:block}`);
    }
  }

  // Campaign fonts (from imported InDesign packages) that the creative's
  // copy actually uses — e.g. the Get Ready digital-clock face.
  const usedFamilies = new Set(
    config.elements
      .filter((e): e is FreeformText => e.type === "text" && !!e.fontFamily)
      .map((e) => String(e.fontFamily)),
  );
  let customIdx = 0;
  for (const f of opts._skipFonts ? [] : (opts.customFonts ?? [])) {
    if (!usedFamilies.has(f.family) || f.family === "National 2") continue;
    const asset = await opts.loadAsset(f.src);
    if (!asset) continue;
    const ext = f.format === "opentype" ? "otf" : "ttf";
    const fileName = `fonts/custom-${customIdx++}.${ext}`;
    let ref = fileName;
    if (opts.inline) {
      ref = `data:font/${ext};base64,${asset.bytes.toString("base64")}`;
    } else {
      zip.file(fileName, asset.bytes);
      files.push(fileName);
    }
    const fam = f.family.replace(/"/g, "");
    fontFaces.push(
      `@font-face{font-family:"${fam}";font-weight:100 900;font-style:normal;src:url("${ref}") format("${f.format}");font-display:block}`,
    );
  }

  // Motion preset + spec guards (IAB display: ≤15s, ≤3 loops).
  const preset: AnimationPreset = opts.animate === false ? "none" : (opts.animation ?? "entrance");
  const L = Math.min(3, Math.max(1, Math.round(opts.loops ?? 1)));
  // Key-visual motion: layers that came from an HTML example carry their
  // own choreography. Replay it, scaled to each layer's size here, instead
  // of a studio preset — the brief is that motion matches the key visual.
  const kvLayers = config.elements.filter((e): e is FreeformImage => e.type === "image" && !!e.motion && e.motion.frames.length >= 2);
  const useKv = opts.animate !== false && opts.matchKeyVisual !== false && kvLayers.length > 0;
  const kvDur = useKv ? Math.max(...kvLayers.map((e) => e.motion!.dur)) : 0;
  const D = useKv
    ? Math.min(15, Math.max(1, kvDur))
    : Math.min(15, Math.max(2, opts.durationSec ?? (preset === "frames" ? 12 : preset === "getready" ? 11.5 : preset === "kenburns" ? 8 : 3)));
  const kvKeyframes: string[] = [];
  const kvAnimFor = (el: FreeformImage, idx: number): string => {
    const m = el.motion!;
    const kx = el.w / Math.max(1, m.w0), ky = el.h / Math.max(1, m.h0);
    const fr = (v: number) => Math.round(v * 100) / 100;
    const stops = m.frames.map((f) => {
      const pct = fr((f.t * m.dur / Math.max(0.01, kvDur)) * 100);
      return `${pct}%{transform:translate(${fr(f.dx * kx)}px,${fr(f.dy * ky)}px) scale(${fr(f.sx)},${fr(f.sy)});opacity:${fr(f.o)}}`;
    });
    // A layer whose own timeline ends before the banner's holds its last state.
    if (m.dur < kvDur - 0.01) {
      const last = m.frames[m.frames.length - 1];
      stops.push(`100%{transform:translate(${fr(last.dx * kx)}px,${fr(last.dy * ky)}px) scale(${fr(last.sx)},${fr(last.sy)});opacity:${fr(last.o)}}`);
    }
    kvKeyframes.push(`@keyframes kv${kvPrefix}${idx}{${stops.join("")}}`);
    return `animation:kv${kvPrefix}${idx} ${D}s linear 0s ${L} normal forwards;transform-origin:0 0`;
  };
  const bgImage = config.elements.find((e): e is FreeformImage => e.type === "image" && e.role !== "logo");
  const kbOrigin = `${Math.round((bgImage?.focusX ?? 0.5) * 100)}% ${Math.round((bgImage?.focusY ?? 0.5) * 100)}%`;

  // Elements.
  const body: string[] = [];
  let imgIndex = 0;
  let seq = 0;
  const delayFor = (el: FreeformElement): number => {
    // Entrance order: artwork first, then shapes, then copy, logo last.
    if (el.type === "image" && (el.role === "logo" || el.slot === "lockup")) return 0.9;
    if (el.type === "image" && !isArt(el)) return 0.75;
    if (el.type === "image") return 0;
    if (el.type === "rect") return 0.15;
    return 0.45 + Math.min(0.3, (seq++) * 0.12);
  };
  /** Story frames: which frame an element belongs to (artwork/scrim always on). */
  const frameOf = (el: FreeformElement): 0 | 1 | 2 | 3 => {
    if (el.type === "rect") return 0;
    if (el.type === "image") return el.role === "logo" || el.slot === "lockup" ? 3 : 0;
    if (el.role === "headline") return 1;
    if (el.role === "cta") return 3;
    return 2; // subhead / body / other
  };
  // Resolve the motion library from either the explicit axes or the legacy preset.
  const legacy: { art: ArtworkMotion; copy: CopyMotion; frames: boolean } =
    preset === "none" ? { art: "none", copy: "none", frames: false }
    : preset === "kenburns" ? { art: "kenburns", copy: "rise", frames: false }
    : preset === "frames" ? { art: "none", copy: "rise", frames: true }
    : preset === "reveal" ? { art: "wipe", copy: "rise", frames: false }
    // "Get Ready" choreography, measured off the shipped AEM GWD banners:
    // background drifts for the whole spot, copy types on, CTA lands last.
    : preset === "getready" ? { art: "drift", copy: "typewriter", frames: false }
    : { art: "none", copy: "rise", frames: false };
  const artMotion: ArtworkMotion = opts.artworkMotion ?? legacy.art;
  const copyMotion: CopyMotion = opts.copyMotion ?? legacy.copy;
  const storyFrames = opts.storyFrames ?? legacy.frames;
  const copyLead = artMotion === "wipe" ? 0.8 : 0.3;
  // Artwork is the photograph (and a cut-out riding on it). Bands, lockups
  // and the pill's icon are furniture or copy: they used to be treated as
  // artwork, so a Ken Burns preset slowly zoomed the logo lockup and the
  // search icon along with the photo.
  const isArt = (el: FreeformElement) =>
    el.type === "image" && (el.slot === "photo" || el.slot === "cutout" || (!el.slot && el.role === "product"));
  const isStill = (el: FreeformElement) => el.type === "rect" || (el.type === "image" && el.slot === "band");
  const isCopy = (el: FreeformElement) => el.type === "text" || (el.type === "image" && !isArt(el) && !isStill(el));

  // The call-to-action is ONE object: pill, label and icon enter together.
  // As separate layers the icon arrived first (it counted as artwork), then
  // the pill faded in, then the label rose into it.
  const ctaUnit = (() => {
    if (useKv) return null;
    const bySlot = (slot: string) => config.elements.find((e) => e.slot === slot);
    let cta = bySlot("cta"), label = bySlot("ctaLabel"), icon = bySlot("ctaIcon");
    if (!cta) {
      const sem = inferSlots(config, width, height);
      const byId = (id?: string) => (id ? config.elements.find((e) => e.id === id) : undefined);
      cta = byId(sem.cta?.id); label = byId(sem.ctaLabel?.id); icon = byId(sem.ctaIcon?.id);
    }
    if (!cta || !label || label.type !== "text" || (cta.type !== "rect" && cta.type !== "image")) return null;
    const cx = label.x + label.w / 2, cy = label.y + label.h / 2;
    if (cx < cta.x || cx > cta.x + cta.w || cy < cta.y || cy > cta.y + cta.h) return null;
    return { cta, members: [cta, label, ...(icon ? [icon] : [])] as FreeformElement[] };
  })();
  const inUnit = (el: FreeformElement) => !!ctaUnit && ctaUnit.members.includes(el);

  const animFor = (el: FreeformElement): string => {
    // Key-visual choreography replaces every preset for this artwork: layers
    // with a track replay it; furniture added by the adapter (panel ground,
    // logo tile) stays still, as the original's static layers do.
    if (useKv) {
      if (el.type === "image" && el.motion && el.motion.frames.length >= 2) return kvAnimFor(el, kvLayers.indexOf(el));
      return "";
    }
    // Artwork layer.
    if (isArt(el)) {
      switch (artMotion) {
        case "kenburns": return `animation:kenburns ${D}s ease-out both;transform-origin:${kbOrigin}`;
        case "drift": return `animation:drift ${D}s ease-in-out both;transform-origin:${kbOrigin}`;
        case "zoomout": return `animation:zoomout ${D}s ease-out both;transform-origin:${kbOrigin}`;
        case "breathe": return `animation:breathe ${Math.max(4, D)}s ease-in-out ${L === 1 ? 2 : L * 2} alternate both;transform-origin:${kbOrigin}`;
        default: return ""; // none / wipe (wipe is applied to the stage)
      }
    }
    // Panels, scrims and pattern bands are the page itself: they are there
    // from the first frame. Fading them in showed a white stage with the
    // photo and a lone icon on it for the first half second.
    if (isStill(el)) return "";
    // Copy + logo.
    if (storyFrames) {
      const f = frameOf(el);
      return f === 0 ? "" : `animation:frame${f} ${D}s ease-in-out ${L} both`;
    }
    // Get Ready choreography: the CTA is the finale — it pops in near the
    // end of the spot rather than with the rest of the copy.
    if (preset === "getready" && el.type === "text" && el.role === "cta") {
      return `animation:pop .5s cubic-bezier(.34,1.56,.64,1) ${(D * 0.8).toFixed(2)}s both`;
    }
    const d = (copyLead + delayFor(el)).toFixed(2);
    switch (copyMotion) {
      case "fade": return `animation:fadein .7s ease-out ${d}s both`;
      case "rise": return `animation:enter .6s ease-out ${d}s both`;
      case "pan": return `animation:pan .7s cubic-bezier(.2,.8,.2,1) ${d}s both`;
      case "pop": return `animation:pop .55s cubic-bezier(.34,1.56,.64,1) ${d}s both`;
      case "wipe": return `animation:wipein .7s cubic-bezier(.4,0,.2,1) ${d}s both`;
      case "baseline": return `animation:baseline .7s cubic-bezier(.2,.8,.2,1) ${d}s both`;
      case "tumble": return `animation:tumble .7s cubic-bezier(.2,.8,.2,1) ${d}s both`;
      case "typewriter": return el.type === "text" ? "" : `animation:fadein .6s ease-out ${d}s both`;
      case "block": return `animation:fadein .01s linear ${(Number(d) + 0.45).toFixed(2)}s both`;
      default: return "";
    }
  };
  const accent = opts.accentColor ?? "#11263d";

  const artMargin = artMotion === "none" || artMotion === "wipe" ? 0 : Math.round(Math.max(width, height) * 0.05);
  /** One element's markup. `dx/dy` re-base it inside a group box. */
  const renderEl = async (el: FreeformElement, anim: string, dx = 0, dy = 0): Promise<string> => {
    const body: string[] = [];
    let base = `position:absolute;left:${el.x - dx}px;top:${el.y - dy}px;width:${el.w}px;height:${el.h}px;opacity:${el.opacity ?? 1}`;
    if (el.type === "rect") {
      body.push(`<div class="el rect" style="${base};${rectStyle(el)};${anim}"></div>`);
    } else if (el.type === "image") {
      let src = "";
      if (el.src) {
        let raw = await opts.loadAsset(el.src);
        let boxW = el.w, boxH = el.h;
        if (raw && !useKv && isArt(el) && el.slot !== "cutout") {
          const cropped = await cropToCanvas(raw.bytes, el, width, height, artMargin);
          if (cropped) {
            raw = { ...raw, bytes: cropped.bytes };
            boxW = cropped.box.w; boxH = cropped.box.h;
            // The motion's origin stays on the same point of the picture.
            const fxPx = (el.focusX ?? 0.5) * el.w - (cropped.box.x - el.x), fyPx = (el.focusY ?? 0.5) * el.h - (cropped.box.y - el.y);
            base = `position:absolute;left:${cropped.box.x - dx}px;top:${cropped.box.y - dy}px;width:${boxW}px;height:${boxH}px;opacity:${el.opacity ?? 1}`;
            anim = anim.replace(/transform-origin:[^;]+/, `transform-origin:${Math.round(fxPx)}px ${Math.round(fyPx)}px`);
          }
        }
        const asset = raw ? await optimizeForExport(raw.bytes, raw.contentType, boxW, boxH) : null;
        if (asset) {
          if (opts.inline) {
            src = `data:${asset.contentType};base64,${asset.bytes.toString("base64")}`;
          } else {
            const name = safeFileName(el.src, imgIndex++, asset.contentType, sizePrefix);
            zip.file(name, asset.bytes);
            files.push(name);
            src = name;
          }
        }
      }
      const dyn = el.role === "product" ? ` data-dynamic="image"` : "";
      if (useKv && el.motionParts && el.motionParts.length >= 2) {
        // A merged glyph headline: play each glyph's own reveal inside a
        // group box that carries the group's motion.
        const parts: string[] = [];
        for (const [pi, part] of el.motionParts.entries()) {
          const pw = Math.max(1, Math.round(part.fw * el.w)), ph = Math.max(1, Math.round(part.fh * el.h));
          let psrc = "";
          const praw = await opts.loadAsset(part.src);
          const passet = praw ? await optimizeForExport(praw.bytes, praw.contentType, pw, ph) : null;
          if (passet) {
            if (opts.inline) psrc = `data:${passet.contentType};base64,${passet.bytes.toString("base64")}`;
            else {
              const pname = safeFileName(part.src, imgIndex++, passet.contentType, sizePrefix);
              zip.file(pname, passet.bytes);
              files.push(pname);
              psrc = pname;
            }
          }
          let panim = "";
          if (part.motion && part.motion.frames.length >= 2) {
            const m = part.motion;
            const kx = pw / Math.max(1, m.w0), ky = ph / Math.max(1, m.h0);
            const fr = (v: number) => Math.round(v * 100) / 100;
            const stops = m.frames.map((f) => `${fr((f.t * m.dur / Math.max(0.01, kvDur)) * 100)}%{transform:translate(${fr(f.dx * kx)}px,${fr(f.dy * ky)}px) scale(${fr(f.sx)},${fr(f.sy)});opacity:${fr(f.o)}}`);
            const name = `kvp${kvPrefix}${kvLayers.indexOf(el)}_${pi}`;
            kvKeyframes.push(`@keyframes ${name}{${stops.join("")}}`);
            panim = `animation:${name} ${D}s linear 0s ${L} normal forwards;transform-origin:0 0`;
          }
          parts.push(`<img class="el img part" src="${esc(psrc)}" alt="" style="position:absolute;left:${Math.round(part.fx * el.w)}px;top:${Math.round(part.fy * el.h)}px;width:${pw}px;height:${ph}px;object-fit:fill;${panim}">`);
        }
        body.push(`<div class="el group ${el.role}" style="${base};${anim}">\n${parts.join("\n")}\n</div>`);
        return body.join("\n");
      }
      body.push(
        `<img class="el img ${el.role}" src="${esc(src)}" alt=""${dyn} style="${base};${imageStyle(el)};${anim}">`,
      );
    } else if (el.type === "text") {
      const key = dynamicKey(el);
      const dyn = key ? ` data-dynamic="${key}"` : "";
      const extraCls = !storyFrames && copyMotion === "typewriter" && typing ? " tw" : "";
      const blockDelay = (copyLead + delayFor(el)).toFixed(2);
      const blockMarkup =
        !storyFrames && copyMotion === "block" && typing
          ? `<div class="block-reveal" style="position:absolute;left:${el.x - dx}px;top:${el.y - dy}px;width:${el.w}px;height:${el.h}px;background:${accent};animation:blockwipe .9s cubic-bezier(.7,0,.3,1) ${blockDelay}s both;transform-origin:left center;pointer-events:none"></div>\n`
          : "";
      // Cap-height frames (baselineFit "cap"): the frame hugs the capitals
      // and the PNG renderer sits the baseline on the frame's bottom edge.
      // Plain CSS would hang a full line box from the frame's top and set
      // the type ~0.3em low. An empty inline-block strut as tall as the
      // frame has its baseline at its own bottom, so the line's baseline
      // lands on the frame bottom in any font, with no metrics needed. The
      // dynamic-copy and typewriter hooks move to the inner span because
      // both replace textContent.
      const capFit = el.baselineFit === "cap" && !!el.text && !el.text.includes("\n") && el.h > 0;
      if (capFit) {
        const delay = (copyLead + delayFor(el)).toFixed(2);
        body.push(
          `${blockMarkup}<div class="el text ${el.role}" style="${base};${textStyle(el, brandFont)};line-height:0;white-space:nowrap;${anim}"><span style="display:inline-block;width:0;height:${el.h}px"></span><span class="capline${extraCls}"${dyn} data-delay="${delay}">${esc(el.text)}</span></div>`,
        );
        return body.join("\n");
      }
      body.push(
        `${blockMarkup}<div class="el text ${el.role}${extraCls}"${dyn} data-delay="${(copyLead + delayFor(el)).toFixed(2)}" style="${base};${textStyle(el, brandFont)};${anim}">${esc(el.text)}</div>`,
      );
    }
    return body.join("\n");
  };

  // The pill unit's own entrance: last of the copy, before the lockup.
  const unitAnim = (): string => {
    if (storyFrames) return `animation:frame3 ${D}s ease-in-out ${L} both`;
    if (preset === "getready") return `animation:pop .5s cubic-bezier(.34,1.56,.64,1) ${(D * 0.8).toFixed(2)}s both`;
    const d = (copyLead + 0.8).toFixed(2);
    switch (copyMotion) {
      case "none": return "";
      case "fade": case "typewriter": case "block": return `animation:fadein .6s ease-out ${d}s both`;
      case "pan": return `animation:pan .7s cubic-bezier(.2,.8,.2,1) ${d}s both`;
      case "pop": return `animation:pop .55s cubic-bezier(.34,1.56,.64,1) ${d}s both`;
      case "wipe": return `animation:wipein .7s cubic-bezier(.4,0,.2,1) ${d}s both`;
      default: return `animation:enter .6s ease-out ${d}s both`;
    }
  };

  let typing = true;
  for (const el of config.elements) {
    if (ctaUnit && el === ctaUnit.cta) {
      const c = ctaUnit.cta;
      typing = false;
      const inner: string[] = [];
      for (const m of ctaUnit.members) inner.push(await renderEl(m, "", c.x, c.y));
      typing = true;
      body.push(`<div class="el group cta-unit" style="position:absolute;left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;transform-origin:50% 50%;${unitAnim()}">\n${inner.join("\n")}\n</div>`);
      continue;
    }
    if (inUnit(el)) continue;
    body.push(await renderEl(el, animFor(el)));
  }

  // The stage wears the artwork's ground colour, so nothing ever flashes
  // white behind a layer that is still arriving.
  const ground = config.elements.find((e): e is FreeformRect => e.type === "rect" && !e.gradient && (e.opacity ?? 1) >= 1 && e.w >= width * 0.95 && e.h >= height * 0.95 && /^#[0-9a-f]{3,8}$/i.test(e.fill ?? ""));
  const stageBg = ground?.fill ?? "#ffffff";
  const stage: RenderedStage = {
    bg: stageBg,
    width, height, format: `${width}x${height}`,
    body: body.join("\n"),
    keyframes: useKv ? kvKeyframes.join("\n") : "",
    fontFaces,
    durationSec: D, loops: L,
    motionSource: useKv ? "key-visual" : "studio",
    animation: useKv ? "key-visual" : preset,
    artworkMotion: artMotion, copyMotion, storyFrames,
    wipeStage: !useKv && artMotion === "wipe",
  };

  const utm = new URLSearchParams({
    utm_source: "brand-studio",
    utm_medium: "display",
    utm_campaign: tags.campaign ?? "",
    utm_content: `${tags.format}${tags.variant ? `-${tags.variant}` : ""}`,
    utm_term: tags.token,
  });
  const landing = opts.clickUrl ? `${opts.clickUrl}${opts.clickUrl.includes("?") ? "&" : "?"}${utm.toString()}` : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="ad.size" content="width=${width},height=${height}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(tags.name)}</title>
<style>
${fontFaces.join("\n")}
html,body{margin:0;padding:0;background:transparent}
#stage{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${stageBg};transform-origin:top left}
#fluid{position:relative;width:100%;}
.el{box-sizing:border-box;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.img{display:block}
${SHARED_KEYFRAMES}
${useKv ? kvKeyframes.join("\n") : artMotion === "wipe" ? `#stage{animation:wipe .9s cubic-bezier(.4,0,.2,1) both}` : ""}
@media (prefers-reduced-motion:reduce){.el,#stage{animation:none!important;clip-path:none!important}}
#clicktag-layer{position:absolute;left:0;top:0;width:${width}px;height:${height}px;z-index:2147483647;display:block;text-decoration:none;background:transparent;cursor:pointer}
</style>
<script type="text/javascript">var clickTag = window.clickTag || ${JSON.stringify(landing)};</script>
</head>
<body>
<div id="fluid">
<div id="stage"
  data-creative="${esc(tags.token)}"
  data-name="${esc(tags.name)}"
  data-campaign="${esc(tags.campaign ?? "")}"
  data-format="${esc(tags.format)}"
  data-variant="${esc(tags.variant ?? "")}"
  data-layout="${esc(tags.layoutLabel ?? "")}"
  data-animation="${useKv ? "key-visual" : preset}" data-motion-source="${useKv ? "key-visual" : "studio"}" data-artwork-motion="${artMotion}" data-copy-motion="${copyMotion}" data-story-frames="${storyFrames}" data-duration="${D}" data-loops="${L}">
${body.join("\n")}
${(opts.pixelUrls ?? [])
  .filter((u) => /^https:\/\//i.test(u))
  .slice(0, 5)
  .map((u) => `<img src="${esc(u)}" alt="" width="1" height="1" style="position:absolute;left:-9999px;top:0" aria-hidden="true">`)
  .join("\n")}
<a href="javascript:void(0)" id="clicktag-layer" aria-label="${esc(tags.name)}"></a>
</div>
</div>
<script>
(function(){
  var STUDIO=${JSON.stringify(studioBase)};
  var TOKEN=${JSON.stringify(tags.token)};
  var W=${width},H=${height};
  var stage=document.getElementById('stage');
  var params=new URLSearchParams(location.search);
  var dynKey='';

  // ---- Dynamic content: URL params or a JSON feed override baked copy. ----
  function applyDynamic(data){
    if(!data) return;
    var keys=['headline','subhead','body','cta','image'];
    keys.forEach(function(k){
      if(data[k]==null||data[k]==='') return;
      var els=stage.querySelectorAll('[data-dynamic="'+k+'"]');
      for(var i=0;i<els.length;i++){
        if(k==='image') els[i].setAttribute('src',data[k]); else els[i].textContent=data[k];
      }
    });
    dynKey=data.key||data.variant||'';
  }
  var urlData={};
  ['headline','subhead','body','cta','image','key','variant'].forEach(function(k){ if(params.get(k)) urlData[k]=params.get(k); });
  applyDynamic(urlData);
  if(params.get('feed')){
    try{ fetch(params.get('feed'),{mode:'cors'}).then(function(r){return r.json();}).then(applyDynamic).catch(function(){}); }catch(e){}
  }

  // ---- Typewriter: reveal copy word by word (keeps line breaks). ----
  document.querySelectorAll('.tw').forEach(function(el){
    var text=el.textContent||''; var delay=parseFloat(el.getAttribute('data-delay')||'0');
    el.textContent='';
    var i=0;
    text.split(/(\\n)/).forEach(function(part){
      if(part==='\\n'){ el.appendChild(document.createTextNode('\\n')); return; }
      part.split(/(\\s+)/).forEach(function(tok){
        if(!tok) return;
        if(/^\\s+$/.test(tok)){ el.appendChild(document.createTextNode(tok)); return; }
        var sp=document.createElement('span'); sp.className='w'; sp.textContent=tok; sp.style.animationDelay=(delay+i*0.09).toFixed(2)+'s'; el.appendChild(sp); i++;
      });
    });
  });

  // ---- Fluid mode: scale the stage to its container. ----
  var fluid=params.get('fluid')==='1'||${opts.fluid ? "true" : "false"};
  function fit(){
    if(!fluid) return;
    var box=document.getElementById('fluid');
    var s=Math.min(box.clientWidth/W, (window.innerHeight||H)/H);
    if(!isFinite(s)||s<=0) s=1;
    stage.style.transform='scale('+s+')';
    box.style.height=(H*s)+'px';
  }
  fit(); window.addEventListener('resize',fit);

  // ---- Analytics beacons (fire-and-forget; never block the creative). ----
  var TRACK=${opts.inline ? "false" : "true"};
  function beacon(type,extra){
    if(!TRACK) return;
    try{
      var q='?t='+encodeURIComponent(type)+(dynKey?'&k='+encodeURIComponent(dynKey):'')+(extra||'');
      var url=STUDIO+'/track/c/'+TOKEN+q;
      if(navigator.sendBeacon){ navigator.sendBeacon(url); } else { (new Image()).src=url+'&_='+Date.now(); }
    }catch(e){}
  }
  beacon('impression');
  // GTM hook: when this creative runs on a page carrying Google Tag Manager
  // (same-origin embeds), push creative events to the dataLayer so the
  // site's own tags can react. No-op everywhere else.
  function dl(event){
    try{
      var w=window; try{ if(w.parent && w.parent.dataLayer) w=w.parent; }catch(e){}
      if(w.dataLayer && typeof w.dataLayer.push==='function'){
        w.dataLayer.push({event:event, creative_id:TOKEN, creative_name:stage.getAttribute('data-name'),
          creative_campaign:stage.getAttribute('data-campaign'), creative_format:stage.getAttribute('data-format'),
          creative_variant:stage.getAttribute('data-variant')});
      }
    }catch(e){}
  }
  dl('creative_impression');
  var viewMs=0,inView=false,since=0,viewableSent=false;
  function flush(){ if(inView){ viewMs+=Date.now()-since; since=Date.now(); } }
  if('IntersectionObserver' in window){
    new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.intersectionRatio>=0.5 && !inView){ inView=true; since=Date.now(); }
        else if(e.intersectionRatio<0.5 && inView){ flush(); inView=false; }
      });
    },{threshold:[0,0.5,1]}).observe(stage);
  } else { inView=true; since=Date.now(); }
  setInterval(function(){ flush(); if(!viewableSent && viewMs>=1000){ viewableSent=true; beacon('viewable','&ms='+viewMs); } },500);
  window.addEventListener('pagehide',function(){ flush(); if(viewMs>0) beacon('view','&ms='+viewMs); });
  var interacted=false;
  function onInteract(){ if(interacted) return; interacted=true; beacon('interaction'); }
  stage.addEventListener('pointerenter',onInteract); stage.addEventListener('touchstart',onInteract,{passive:true});

  document.getElementById('clicktag-layer').addEventListener('click',function(ev){
    ev.preventDefault();
    beacon('click');
    dl('creative_click');
    var url=window.clickTag||'';
    if(url){ window.open(url,'_blank'); }
  });
})();
</script>
</body>
</html>`;

  if (opts.inline || opts._zip) return { zip: Buffer.alloc(0), html, files: opts._zip ? files : ["index.html"], stage };
  zip.file("index.html", html);
  files.unshift("index.html");
  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { zip: zipBuf, html, files, stage };
}

// ---------------------------------------------------------------------------
// Responsive package: every size of a campaign in ONE document
// ---------------------------------------------------------------------------

export interface ResponsiveSize {
  width: number;
  height: number;
  config: FreeformConfig;
  templateId?: number;
}

export interface ResponsiveHtmlOptions extends Omit<HtmlExportOptions, "width" | "height" | "config" | "_zip" | "_files" | "_sizeIndex" | "_skipFonts"> {
  /** The first size is the primary (declared in ad.size); the rest are
   * alternatives the serving slot may pick. */
  sizes: ResponsiveSize[];
}

export interface ResponsiveHtmlPackage extends HtmlPackage {
  sizes: Array<{ width: number; height: number; templateId?: number }>;
}

/**
 * One HTML5 document carrying every size built from the same master. Each
 * size is a hidden stage with its own layout and motion; a media rule per
 * serving size shows the exact match without script, and a small picker
 * chooses the best stage for any other slot (largest that fits with the
 * closest aspect, scaled to fill) — so one upload serves a whole DV360
 * line item. Assets are shared in the zip; fonts are embedded once.
 */
export async function buildResponsiveHtmlPackage(opts: ResponsiveHtmlOptions): Promise<ResponsiveHtmlPackage> {
  if (opts.sizes.length === 0) throw new Error("A responsive package needs at least one size");
  const zip = new JSZip();
  const files: string[] = [];
  const stages: RenderedStage[] = [];
  for (const [i, size] of opts.sizes.entries()) {
    const pkg = await buildHtmlPackage({
      ...opts,
      width: size.width,
      height: size.height,
      config: size.config,
      tags: { ...opts.tags, format: `${size.width}x${size.height}` },
      _zip: zip,
      _files: files,
      _sizeIndex: i,
      _skipFonts: i > 0,
      fluid: false,
    });
    if (pkg.stage) stages.push(pkg.stage);
  }
  const primary = stages[0];
  const { tags, studioBase } = opts;
  const utm = new URLSearchParams({
    utm_source: "brand-studio",
    utm_medium: "display",
    utm_campaign: tags.campaign ?? "",
    utm_content: `responsive${tags.variant ? `-${tags.variant}` : ""}`,
    utm_term: tags.token,
  });
  const landing = opts.clickUrl ? `${opts.clickUrl}${opts.clickUrl.includes("?") ? "&" : "?"}${utm.toString()}` : "";
  const sizeCss = stages.map((st, i) =>
    `#s${i}{width:${st.width}px;height:${st.height}px${st.bg ? `;background:${st.bg}` : ""}}\n@media (width:${st.width}px) and (height:${st.height}px){.stage{display:none}#s${i}{display:block}}${st.wipeStage ? `\n#s${i}{animation:wipe .9s cubic-bezier(.4,0,.2,1) both}` : ""}${st.keyframes ? `\n${st.keyframes}` : ""}`,
  ).join("\n");
  const stageMarkup = stages.map((st, i) =>
    `<div class="stage${i === 0 ? " on" : ""}" id="s${i}" data-w="${st.width}" data-h="${st.height}" data-format="${st.format}" data-animation="${st.animation}" data-motion-source="${st.motionSource}" data-artwork-motion="${st.artworkMotion}" data-copy-motion="${st.copyMotion}" data-story-frames="${st.storyFrames}" data-duration="${st.durationSec}" data-loops="${st.loops}">\n${st.body}\n<a href="javascript:void(0)" class="clicktag" aria-label="${esc(tags.name)}"></a>\n</div>`,
  ).join("\n");
  const pixels = (opts.pixelUrls ?? []).filter((u) => /^https:\/\//i.test(u)).slice(0, 5)
    .map((u) => `<img src="${esc(u)}" alt="" width="1" height="1" style="position:absolute;left:-9999px;top:0" aria-hidden="true">`).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="ad.size" content="width=${primary.width},height=${primary.height}">
<meta name="ad.sizes" content="${stages.map((st) => st.format).join(",")}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(tags.name)}</title>
<style>
${primary.fontFaces.join("\n")}
html,body{margin:0;padding:0;background:transparent;width:100%;height:100%}
#fluid{position:relative;width:100%;height:100%;overflow:hidden}
.stage{position:absolute;left:0;top:0;overflow:hidden;background:#ffffff;transform-origin:top left;display:none}
.stage.on{display:block}
.el{box-sizing:border-box;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.img{display:block}
${SHARED_KEYFRAMES}
${sizeCss}
@media (prefers-reduced-motion:reduce){.el,.stage{animation:none!important;clip-path:none!important}}
.clicktag{position:absolute;left:0;top:0;width:100%;height:100%;z-index:2147483647;display:block;text-decoration:none;background:transparent;cursor:pointer}
</style>
<script type="text/javascript">var clickTag = window.clickTag || ${JSON.stringify(landing)};</script>
</head>
<body>
<div id="fluid" data-creative="${esc(tags.token)}" data-name="${esc(tags.name)}" data-campaign="${esc(tags.campaign ?? "")}" data-variant="${esc(tags.variant ?? "")}" data-format="responsive">
${stageMarkup}
${pixels}
</div>
<script>
(function(){
  var STUDIO=${JSON.stringify(studioBase)};
  var TOKEN=${JSON.stringify(tags.token)};
  var SIZES=${JSON.stringify(stages.map((st, i) => ({ i, w: st.width, h: st.height })))};
  var root=document.getElementById('fluid');
  var params=new URLSearchParams(location.search);
  var dynKey='';
  var shown=-1;

  // ---- Pick the stage for the slot: exact size first, else the largest
  // that fits with the closest aspect, scaled to fill the slot. ----
  function pick(){
    var vw=window.innerWidth||document.documentElement.clientWidth||SIZES[0].w;
    var vh=window.innerHeight||document.documentElement.clientHeight||SIZES[0].h;
    var forced=params.get('size');
    var best=null;
    if(forced){ SIZES.forEach(function(s){ if(s.w+'x'+s.h===forced) best=s; }); }
    if(!best){ SIZES.forEach(function(s){ if(s.w===vw&&s.h===vh) best=s; }); }
    if(!best){
      var fit=SIZES.filter(function(s){ return s.w<=vw+0.5&&s.h<=vh+0.5; });
      var pool=fit.length?fit:SIZES.slice();
      var ar=vw/Math.max(1,vh);
      pool.sort(function(a,b){
        var da=Math.abs(Math.log((a.w/a.h)/ar)), db=Math.abs(Math.log((b.w/b.h)/ar));
        if(Math.abs(da-db)>0.02) return da-db;
        return (b.w*b.h)-(a.w*a.h);
      });
      best=pool[0];
    }
    if(best.i!==shown){
      shown=best.i;
      SIZES.forEach(function(s){ var el=document.getElementById('s'+s.i); if(el) el.className=s.i===best.i?'stage on':'stage'; });
    }
    var el=document.getElementById('s'+best.i);
    var k=Math.min(vw/best.w, vh/best.h);
    if(!isFinite(k)||k<=0) k=1;
    if(Math.abs(k-1)<0.005) k=1;
    el.style.transform=k===1?'':'scale('+k+')';
    el.style.left=Math.max(0,Math.round((vw-best.w*k)/2))+'px';
    el.style.top=Math.max(0,Math.round((vh-best.h*k)/2))+'px';
    return best;
  }
  var current=pick();
  window.addEventListener('resize',function(){ current=pick(); });

  // ---- Dynamic content: URL params or a JSON feed override baked copy. ----
  function applyDynamic(data){
    if(!data) return;
    var keys=['headline','subhead','body','cta','image'];
    keys.forEach(function(k){
      if(data[k]==null||data[k]==='') return;
      var els=root.querySelectorAll('[data-dynamic="'+k+'"]');
      for(var i=0;i<els.length;i++){ if(k==='image') els[i].setAttribute('src',data[k]); else els[i].textContent=data[k]; }
    });
    dynKey=data.key||data.variant||'';
  }
  var urlData={};
  ['headline','subhead','body','cta','image','key','variant'].forEach(function(k){ if(params.get(k)) urlData[k]=params.get(k); });
  applyDynamic(urlData);
  if(params.get('feed')){ try{ fetch(params.get('feed'),{mode:'cors'}).then(function(r){return r.json();}).then(applyDynamic).catch(function(){}); }catch(e){} }

  // ---- Typewriter: reveal copy word by word (keeps line breaks). ----
  root.querySelectorAll('.tw').forEach(function(el){
    var text=el.textContent||''; var delay=parseFloat(el.getAttribute('data-delay')||'0');
    el.textContent=''; var i=0;
    text.split(/(\\n)/).forEach(function(part){
      if(part==='\\n'){ el.appendChild(document.createTextNode('\\n')); return; }
      part.split(/(\\s+)/).forEach(function(tok){
        if(!tok) return;
        if(/^\\s+$/.test(tok)){ el.appendChild(document.createTextNode(tok)); return; }
        var sp=document.createElement('span'); sp.className='w'; sp.textContent=tok; sp.style.animationDelay=(delay+i*0.09).toFixed(2)+'s'; el.appendChild(sp); i++;
      });
    });
  });

  // ---- Analytics beacons (fire-and-forget; never block the creative). ----
  var TRACK=${opts.inline ? "false" : "true"};
  function beacon(type,extra){
    if(!TRACK) return;
    try{
      var q='?t='+encodeURIComponent(type)+'&f='+encodeURIComponent(current.w+'x'+current.h)+(dynKey?'&k='+encodeURIComponent(dynKey):'')+(extra||'');
      var url=STUDIO+'/track/c/'+TOKEN+q;
      if(navigator.sendBeacon){ navigator.sendBeacon(url); } else { (new Image()).src=url+'&_='+Date.now(); }
    }catch(e){}
  }
  beacon('impression');
  function dl(event){
    try{
      var w=window; try{ if(w.parent && w.parent.dataLayer) w=w.parent; }catch(e){}
      if(w.dataLayer && typeof w.dataLayer.push==='function'){
        w.dataLayer.push({event:event, creative_id:TOKEN, creative_name:root.getAttribute('data-name'), creative_campaign:root.getAttribute('data-campaign'), creative_format:current.w+'x'+current.h, creative_variant:root.getAttribute('data-variant')});
      }
    }catch(e){}
  }
  dl('creative_impression');
  var viewMs=0,inView=false,since=0,viewableSent=false;
  function flush(){ if(inView){ viewMs+=Date.now()-since; since=Date.now(); } }
  if('IntersectionObserver' in window){
    new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.intersectionRatio>=0.5 && !inView){ inView=true; since=Date.now(); }
        else if(e.intersectionRatio<0.5 && inView){ flush(); inView=false; }
      });
    },{threshold:[0,0.5,1]}).observe(root);
  } else { inView=true; since=Date.now(); }
  setInterval(function(){ flush(); if(!viewableSent && viewMs>=1000){ viewableSent=true; beacon('viewable','&ms='+viewMs); } },500);
  window.addEventListener('pagehide',function(){ flush(); if(viewMs>0) beacon('view','&ms='+viewMs); });
  var interacted=false;
  function onInteract(){ if(interacted) return; interacted=true; beacon('interaction'); }
  root.addEventListener('pointerenter',onInteract); root.addEventListener('touchstart',onInteract,{passive:true});
  root.addEventListener('click',function(ev){
    var t=ev.target; if(!(t&&t.className==='clicktag')) return;
    ev.preventDefault(); beacon('click'); dl('creative_click');
    var url=window.clickTag||''; if(url){ window.open(url,'_blank'); }
  });
})();
</script>
</body>
</html>`;

  const sizes = opts.sizes.map((sz) => ({ width: sz.width, height: sz.height, ...(sz.templateId ? { templateId: sz.templateId } : {}) }));
  if (opts.inline) return { zip: Buffer.alloc(0), html, files: ["index.html"], sizes };
  zip.file("index.html", html);
  files.unshift("index.html");
  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { zip: zipBuf, html, files, sizes };
}
