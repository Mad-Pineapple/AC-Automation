/**
 * Format catalog: every size a rollout can ask for, classified the way the
 * studio treats it.
 *
 * Shipped Auckland Council creative does not scale one layout across shapes;
 * it picks a composition AXIS from the canvas (tall → stack, wide → columns,
 * strip → one row) and keeps some parts at a fixed pixel size. Everything
 * that decides an axis or a floor keys off the classes defined here, so the
 * thresholds live in one place instead of being re-derived per engine.
 *
 *  - `classifyFormat` gives any width×height a class + pixel budget.
 *  - `FORMAT_CATALOG` names the sizes from the Design Studio glossary and
 *    the shipped media plans, with the channel each belongs to.
 *  - `ASPECT_REBUILD_THRESHOLD` is the single "too different to scale"
 *    distance shared by the build planner and the adapt route.
 */

export type FormatClass = "tower" | "portrait" | "square" | "landscape" | "wide" | "strip";

/** How many pixels the canvas has to spend — decides which parts survive. */
export type PixelBudget = "micro" | "small" | "standard" | "large";

export type Channel = "display" | "social" | "ooh" | "screen" | "print" | "native" | "web";

export interface CatalogEntry {
  key: string;
  label: string;
  width: number;
  height: number;
  channel: Channel;
}

export interface FormatSpec {
  width: number;
  height: number;
  ratio: number;
  short: number;
  long: number;
  formatClass: FormatClass;
  budget: PixelBudget;
  /** Catalog entry when the size is a known format. */
  entry: CatalogEntry | null;
  /** Human label: catalog label, a brief's own deliverable name, or W×H. */
  label: string;
}

/** Shape difference on a log scale, so 2:1 vs 1:1 and 1:1 vs 1:2 score alike. */
export function aspectDistance(w1: number, h1: number, w2: number, h2: number): number {
  return Math.abs(Math.log(w1 / h1 / (w2 / h2)));
}

/** Above this the layout is rebuilt for the new shape instead of scaled. */
export const ASPECT_REBUILD_THRESHOLD = 0.3;

/** Formats this short (px) are strips: one-row layout, full-height logo tile. */
export const STRIP_MAX_HEIGHT = 120;

export function classifyAspect(width: number, height: number): FormatClass {
  const ratio = width / height;
  if (ratio >= 5 || (height <= STRIP_MAX_HEIGHT && ratio >= 2.5)) return "strip";
  if (ratio <= 0.35) return "tower";
  if (ratio < 0.8) return "portrait";
  if (ratio <= 1.25) return "square";
  if (ratio < 2) return "landscape";
  return "wide";
}

export function classifyBudget(width: number, height: number): PixelBudget {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short < 100) return "micro";
  if (short < 300) return "small";
  if ((short >= 600 && long >= 1200) || long >= 2000) return "large";
  return "standard";
}

export const CLASS_LABELS: Record<FormatClass, string> = {
  tower: "Tower",
  portrait: "Portrait",
  square: "Square",
  landscape: "Landscape",
  wide: "Wide",
  strip: "Strip",
};

/** Sizes from the Design Studio glossary (September 2025) and the shipped
 * AEM Get Ready media plan. Channel comes from the glossary section. */
export const FORMAT_CATALOG: CatalogEntry[] = [
  // Display (DV360 / GDN)
  { key: "mrec", label: "MREC", width: 300, height: 250, channel: "display" },
  { key: "half_page", label: "Half Page", width: 300, height: 600, channel: "display" },
  { key: "skyscraper", label: "Skyscraper", width: 120, height: 600, channel: "display" },
  { key: "wide_skyscraper", label: "Wide Skyscraper", width: 160, height: 600, channel: "display" },
  { key: "billboard", label: "Billboard", width: 970, height: 250, channel: "display" },
  { key: "leaderboard", label: "Leaderboard", width: 728, height: 90, channel: "display" },
  { key: "big_banner", label: "Big Banner", width: 760, height: 120, channel: "display" },
  { key: "mobile_banner", label: "Mobile Banner", width: 320, height: 50, channel: "display" },
  { key: "mobile_banner_300", label: "Mobile Banner S", width: 300, height: 50, channel: "display" },
  { key: "mobile_interstitial", label: "Mobile Interstitial", width: 320, height: 480, channel: "display" },
  { key: "companion_youtube", label: "YouTube Companion", width: 300, height: 60, channel: "display" },
  { key: "companion_spotify", label: "Spotify Companion", width: 640, height: 640, channel: "display" },
  { key: "ogury_fullscreen", label: "Ogury Full Screen", width: 1388, height: 1734, channel: "display" },
  { key: "ogury_thumbnail", label: "Ogury Thumbnail", width: 720, height: 540, channel: "display" },
  { key: "ogury_header", label: "Ogury Header", width: 2640, height: 600, channel: "display" },
  { key: "ogury_footer", label: "Ogury Footer", width: 1760, height: 400, channel: "display" },
  { key: "pmax_landscape", label: "Performance Max Landscape", width: 1200, height: 628, channel: "display" },
  { key: "pmax_square", label: "Performance Max Square", width: 1200, height: 1200, channel: "display" },
  { key: "pmax_portrait", label: "Performance Max Portrait", width: 960, height: 1200, channel: "display" },
  // Native
  { key: "native_dv360", label: "Native DV360", width: 1200, height: 627, channel: "native" },
  { key: "native_dv360_square", label: "Native DV360 Square", width: 627, height: 627, channel: "native" },
  { key: "native_outbrain", label: "Native Outbrain", width: 1200, height: 800, channel: "native" },
  { key: "native_trademe", label: "Native Trade Me", width: 702, height: 367, channel: "native" },
  { key: "native_herald", label: "Native NZ Herald", width: 400, height: 209, channel: "native" },
  { key: "native_spinoff", label: "Native Spinoff", width: 800, height: 420, channel: "native" },
  { key: "native_logo", label: "Native Council Logo", width: 100, height: 100, channel: "native" },
  { key: "oneroof_web", label: "OneRoof Native Web", width: 536, height: 280, channel: "native" },
  { key: "oneroof_app", label: "OneRoof Native App", width: 300, height: 300, channel: "native" },
  // Social
  { key: "social_square", label: "Social Square", width: 1080, height: 1080, channel: "social" },
  { key: "story", label: "Story", width: 1080, height: 1920, channel: "social" },
  { key: "meta_feed_square", label: "Meta Feed 1:1", width: 1440, height: 1440, channel: "social" },
  { key: "meta_feed_vertical", label: "Meta Feed 4:5", width: 1440, height: 1800, channel: "social" },
  { key: "meta_stories", label: "Meta Stories 9:16", width: 1440, height: 2560, channel: "social" },
  { key: "fb_cover", label: "FB Cover Photo", width: 851, height: 360, channel: "social" },
  { key: "fb_event_cover", label: "FB Event Cover", width: 1920, height: 1005, channel: "social" },
  { key: "ig_profile", label: "IG Profile", width: 320, height: 320, channel: "social" },
  { key: "li_landscape", label: "LinkedIn Landscape", width: 1200, height: 628, channel: "social" },
  { key: "li_square", label: "LinkedIn Square", width: 1200, height: 1200, channel: "social" },
  { key: "li_vertical", label: "LinkedIn Vertical 4:5", width: 720, height: 900, channel: "social" },
  { key: "li_cover", label: "LinkedIn Cover", width: 1128, height: 191, channel: "social" },
  { key: "li_event_banner", label: "LinkedIn Event Banner", width: 1600, height: 900, channel: "social" },
  { key: "li_profile", label: "LinkedIn Profile", width: 300, height: 300, channel: "social" },
  { key: "li_square_xl", label: "LinkedIn Square XL", width: 1920, height: 1920, channel: "social" },
  { key: "pt_vertical", label: "Pinterest 2:3", width: 1000, height: 1500, channel: "social" },
  { key: "sc_ar_static", label: "Snapchat AR Static", width: 945, height: 2048, channel: "social" },
  { key: "sc_ar_moving", label: "Snapchat AR Moving", width: 720, height: 1560, channel: "social" },
  { key: "nb_image", label: "Neighbourly Image", width: 1200, height: 800, channel: "social" },
  // Council owned screens and web
  { key: "council_screen_landscape", label: "Council Screen Landscape", width: 1920, height: 1080, channel: "screen" },
  { key: "council_screen_portrait", label: "Council Screen Portrait", width: 1080, height: 1920, channel: "screen" },
  { key: "council_carousel", label: "Council Carousel", width: 600, height: 380, channel: "web" },
  { key: "email_footer", label: "Email Footer", width: 500, height: 200, channel: "web" },
  { key: "ourauckland_header", label: "OurAuckland Header", width: 3840, height: 800, channel: "web" },
  { key: "ourauckland_article", label: "OurAuckland Article", width: 1360, height: 800, channel: "web" },
  { key: "ourauckland_subsection", label: "OurAuckland Subsection", width: 450, height: 280, channel: "web" },
  { key: "ourauckland_tile", label: "OurAuckland Tile", width: 640, height: 750, channel: "web" },
  { key: "ehq_header", label: "EHQ Header Banner", width: 2500, height: 347, channel: "web" },
  { key: "screen_ultra_wide", label: "Digital Screen Ultra-wide", width: 3840, height: 800, channel: "screen" },
  // Digital OOH
  { key: "ooh_jcd_billboard_l", label: "JCDecaux Billboard L", width: 2688, height: 672, channel: "ooh" },
  { key: "ooh_jcd_billboard_m", label: "JCDecaux Billboard M", width: 1824, height: 432, channel: "ooh" },
  { key: "ooh_jcd_portrait", label: "JCDecaux Digi Portrait", width: 384, height: 592, channel: "ooh" },
  { key: "ooh_jcd_wide", label: "JCDecaux Digi Wide", width: 960, height: 256, channel: "ooh" },
  { key: "ooh_jcd_wide_s", label: "JCDecaux Digi Wide S", width: 768, height: 256, channel: "ooh" },
  { key: "ooh_jcd_1440", label: "JCDecaux 1440", width: 1440, height: 480, channel: "ooh" },
  { key: "ooh_jcd_1184", label: "JCDecaux 1184", width: 1184, height: 400, channel: "ooh" },
  { key: "ooh_jcd_960", label: "JCDecaux 960×528", width: 960, height: 528, channel: "ooh" },
  { key: "ooh_hivestack_portrait", label: "Hivestack Portrait", width: 2160, height: 3840, channel: "ooh" },
  { key: "ooh_hivestack_small", label: "Hivestack Small", width: 384, height: 576, channel: "ooh" },
  { key: "ooh_gomedia", label: "Go Media Billboard", width: 1200, height: 600, channel: "ooh" },
  { key: "ooh_britomart", label: "Britomart Towers", width: 432, height: 768, channel: "ooh" },
  { key: "ooh_newmarket", label: "Newmarket Atrium", width: 1280, height: 448, channel: "ooh" },
  { key: "ooh_fanshawe", label: "Fanshawe Blades", width: 704, height: 1408, channel: "ooh" },
  { key: "ooh_oteha", label: "The Oteha", width: 384, height: 768, channel: "ooh" },
  { key: "ooh_shopalive", label: "oOh! Shopalive", width: 1080, height: 1920, channel: "ooh" },
  { key: "ooh_street_live", label: "oOh! Street Furniture Live", width: 2160, height: 3840, channel: "ooh" },
  { key: "ooh_hyper_impulse", label: "Hyper Media Impulse Screen", width: 850, height: 755, channel: "ooh" },
  { key: "ooh_cartology", label: "Cartology (Woolworths)", width: 1080, height: 1920, channel: "ooh" },
  // Print (px at 300 dpi)
  { key: "print_a4", label: "Print A4", width: 2480, height: 3508, channel: "print" },
  { key: "print_a3", label: "Print A3", width: 3508, height: 4961, channel: "print" },
  { key: "print_a5", label: "Print A5", width: 1748, height: 2480, channel: "print" },
  { key: "print_dl", label: "Print DL", width: 1169, height: 2480, channel: "print" },
];

const byDims = new Map<string, CatalogEntry>();
for (const e of FORMAT_CATALOG) {
  const k = `${e.width}x${e.height}`;
  if (!byDims.has(k)) byDims.set(k, e);
}

export function lookupFormat(width: number, height: number): CatalogEntry | null {
  return byDims.get(`${Math.round(width)}x${Math.round(height)}`) ?? null;
}

/** Everything the engines need to know about a target size. `labelHint`
 * is the brief's own deliverable name when it has one. */
export function describeFormat(width: number, height: number, labelHint?: string | null): FormatSpec {
  const entry = lookupFormat(width, height);
  const hint = (labelHint ?? "").trim();
  return {
    width,
    height,
    ratio: width / height,
    short: Math.min(width, height),
    long: Math.max(width, height),
    formatClass: classifyAspect(width, height),
    budget: classifyBudget(width, height),
    entry,
    label: hint || entry?.label || `${width}×${height}`,
  };
}

/** Whether a target should be rebuilt from its master (recipe) rather than
 * scaled: a different class, or the same class but far enough in shape
 * that scaling would crush or stretch the layout. Squares and landscapes
 * near the master's own shape are always scaled. */
export function needsRebuild(srcW: number, srcH: number, dstW: number, dstH: number): boolean {
  const src = classifyAspect(srcW, srcH);
  const dst = classifyAspect(dstW, dstH);
  const dist = aspectDistance(srcW, srcH, dstW, dstH);
  if (dist > ASPECT_REBUILD_THRESHOLD) return true;
  if (src === dst) return false;
  // Crossing into a strip or tower is always a rebuild, whatever the distance.
  return dst === "strip" || dst === "tower";
}
