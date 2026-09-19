// Formats a master template can be adapted into (Storyteq's Adaptation
// Studio pattern): one designed master → per-format layouts to fine-tune.
// Shared between the template editor's Adapt dialog and the import page.
//
// The catalogue below is the Auckland Council Design Studio production
// glossary (FY26 template) + the sizes shipped in the AEM Get Ready burst —
// every size from the real media plan is selectable when adapting a key
// visual. Each size carries the delivery group it is produced as (OOH /
// HTML / Statics / Print) and where the placement actually runs.
export type AdaptGroup = "OOH" | "HTML" | "Statics" | "Print";

/** Which way a size runs, in the words a designer uses. */
export type Orientation = "Portrait" | "Landscape" | "Square";
export function orientationOf(width: number, height: number): Orientation {
  const ratio = width / Math.max(1, height);
  if (ratio > 1.05) return "Landscape";
  if (ratio < 0.95) return "Portrait";
  return "Square";
}

export const ADAPT_GROUPS: { key: AdaptGroup; label: string; hint: string }[] = [
  { key: "OOH", label: "OOH", hint: "Digital out-of-home screens — delivered as stills or short loops to the panel operator" },
  { key: "HTML", label: "HTML", hint: "HTML5 display banners — DV360 / GDN, exported as a zip with click tags" },
  { key: "Statics", label: "Statics", hint: "Static images — Meta, LinkedIn, native, council-owned channels" },
  { key: "Print", label: "Print", hint: "Print-ready artwork" },
];

export const ADAPT_PRESETS = [
  // Core studio formats
  { key: "social_square", label: "Social Square", width: 1080, height: 1080, group: "Statics", placement: "Facebook / Instagram feed post" },
  { key: "story", label: "Story", width: 1080, height: 1920, group: "Statics", placement: "Instagram / Facebook story" },
  { key: "print_a4", label: "Print A4", width: 2480, height: 3508, group: "Print", placement: "A4 poster / flyer at 300 dpi" },
  // Display (DV360 / GDN)
  { key: "mrec", label: "MREC Display", width: 300, height: 250, group: "HTML", placement: "DV360 / GDN — in-content medium rectangle, desktop and mobile" },
  { key: "half_page", label: "Half Page", width: 300, height: 600, group: "HTML", placement: "DV360 / GDN — sidebar half page, desktop" },
  { key: "skyscraper", label: "Skyscraper", width: 120, height: 600, group: "HTML", placement: "DV360 / GDN — narrow sidebar, desktop" },
  { key: "billboard", label: "Billboard", width: 970, height: 250, group: "HTML", placement: "DV360 / GDN — top-of-page billboard, desktop" },
  { key: "banner", label: "Leaderboard", width: 728, height: 90, group: "HTML", placement: "DV360 / GDN — top-of-page leaderboard, desktop" },
  { key: "big_banner", label: "Big Banner", width: 760, height: 120, group: "HTML", placement: "NZ Herald / Stuff — big banner, desktop" },
  { key: "mobile_banner", label: "Mobile Banner", width: 320, height: 50, group: "HTML", placement: "DV360 / GDN — mobile banner" },
  { key: "mobile_interstitial", label: "Mobile Interstitial", width: 320, height: 480, group: "HTML", placement: "DV360 / GDN — mobile full-screen interstitial" },
  // Native & companions
  { key: "native_dv360", label: "Native DV360 / Outbrain", width: 1200, height: 627, group: "Statics", placement: "Native ad image — DV360 and Outbrain feeds" },
  { key: "native_trademe", label: "Native Trade Me", width: 627, height: 627, group: "Statics", placement: "Trade Me native placement" },
  { key: "native_herald", label: "Native NZ Herald", width: 400, height: 209, group: "Statics", placement: "NZ Herald native article tile" },
  { key: "native_spinoff", label: "Native Spinoff", width: 800, height: 420, group: "Statics", placement: "The Spinoff native tile" },
  { key: "companion_spotify", label: "Spotify Companion", width: 640, height: 640, group: "Statics", placement: "Spotify audio ad companion image" },
  { key: "companion_youtube", label: "YouTube Companion", width: 300, height: 60, group: "Statics", placement: "YouTube companion banner beside the video" },
  // Meta / social
  { key: "meta_feed_square", label: "Meta Feed 1:1", width: 1440, height: 1440, group: "Statics", placement: "Facebook / Instagram feed" },
  { key: "meta_feed_vertical", label: "Meta Feed 4:5", width: 1440, height: 1800, group: "Statics", placement: "Facebook / Instagram feed, mobile-first" },
  { key: "meta_stories", label: "Meta Stories 9:16", width: 1440, height: 2560, group: "Statics", placement: "Facebook / Instagram stories and reels" },
  { key: "fb_event_cover", label: "FB Event Cover", width: 1200, height: 628, group: "Statics", placement: "Facebook event page cover" },
  { key: "li_landscape", label: "LinkedIn Landscape", width: 1200, height: 628, group: "Statics", placement: "LinkedIn feed, landscape" },
  { key: "li_square", label: "LinkedIn Square", width: 1200, height: 1200, group: "Statics", placement: "LinkedIn feed, square" },
  { key: "li_event_banner", label: "LinkedIn Event Banner", width: 1600, height: 900, group: "Statics", placement: "LinkedIn event page banner" },
  // Council owned channels
  { key: "council_screen_landscape", label: "Council Screen Landscape", width: 1920, height: 1080, group: "OOH", placement: "Council service centre and library screens, landscape" },
  { key: "council_screen_portrait", label: "Council Screen Portrait", width: 1080, height: 1920, group: "OOH", placement: "Council service centre and library screens, portrait" },
  { key: "council_carousel", label: "Council Carousel", width: 600, height: 380, group: "Statics", placement: "aucklandcouncil.govt.nz homepage carousel" },
  { key: "email_footer", label: "Email Footer", width: 500, height: 200, group: "Statics", placement: "Council email newsletter footer" },
  { key: "ourauckland_header", label: "OurAuckland Header", width: 1360, height: 800, group: "Statics", placement: "OurAuckland article header" },
  { key: "ourauckland_tile", label: "OurAuckland Tile", width: 640, height: 750, group: "Statics", placement: "OurAuckland listing tile" },
  { key: "ourauckland_subsection", label: "OurAuckland Subsection", width: 450, height: 280, group: "Statics", placement: "OurAuckland subsection card" },
  { key: "ehq_header", label: "EHQ Header Banner", width: 2500, height: 347, group: "Statics", placement: "AK Have Your Say (EngagementHQ) page header" },
  { key: "ferry_screen", label: "Ferry Screen", width: 851, height: 360, group: "OOH", placement: "Auckland Transport ferry terminal screens" },
  // Digital OOH (Get Ready media plan)
  { key: "ooh_jcd_billboard_l", label: "JCDecaux Billboard L", width: 2688, height: 672, group: "OOH", placement: "JCDecaux large-format digital billboard (roadside)" },
  { key: "ooh_jcd_billboard_m", label: "JCDecaux Billboard M", width: 1824, height: 432, group: "OOH", placement: "JCDecaux digital billboard, medium (roadside)" },
  { key: "ooh_jcd_portrait", label: "JCDecaux Digi Portrait", width: 384, height: 592, group: "OOH", placement: "JCDecaux bus shelter / street furniture, portrait" },
  { key: "ooh_jcd_wide", label: "JCDecaux Digi Wide", width: 960, height: 256, group: "OOH", placement: "JCDecaux digital wide panel (motorway)" },
  { key: "ooh_jcd_wide_s", label: "JCDecaux Digi Wide S", width: 768, height: 256, group: "OOH", placement: "JCDecaux digital wide panel, small" },
  { key: "ooh_hivestack_portrait", label: "Hivestack Portrait", width: 2160, height: 3840, group: "OOH", placement: "Hivestack programmatic DOOH, portrait screens" },
  { key: "ooh_hivestack_small", label: "Hivestack Small", width: 384, height: 576, group: "OOH", placement: "Hivestack programmatic DOOH, small portrait" },
  { key: "ooh_gomedia", label: "Go Media Billboard", width: 1200, height: 600, group: "OOH", placement: "Go Media digital billboard" },
  { key: "ooh_britomart", label: "Britomart Towers", width: 432, height: 768, group: "OOH", placement: "Britomart station tower screens" },
  { key: "ooh_newmarket", label: "Newmarket Atrium", width: 1280, height: 448, group: "OOH", placement: "Westfield Newmarket atrium screen" },
  { key: "ooh_fanshawe", label: "Fanshawe Blades", width: 704, height: 1408, group: "OOH", placement: "Fanshawe Street blade screens" },
  { key: "ooh_oteha", label: "The Oteha", width: 384, height: 768, group: "OOH", placement: "The Oteha (Albany) screens" },
  { key: "ooh_precision", label: "Precision Media", width: 1440, height: 480, group: "OOH", placement: "Precision Media petrol station screens" },
  { key: "ooh_mobil", label: "Mobil / Liquorland Screens", width: 1184, height: 400, group: "OOH", placement: "Mobil forecourt and Liquorland in-store screens" },
  { key: "ooh_cartology", label: "Cartology (Woolworths)", width: 960, height: 528, group: "OOH", placement: "Cartology screens in Woolworths stores" },
  // Social profile/cover + Snapchat
  { key: "ig_profile", label: "IG Profile", width: 320, height: 320, group: "Statics", placement: "Instagram profile picture" },
  { key: "li_profile", label: "LinkedIn Profile", width: 300, height: 300, group: "Statics", placement: "LinkedIn page logo" },
  { key: "li_cover", label: "LinkedIn Cover", width: 1128, height: 191, group: "Statics", placement: "LinkedIn page cover" },
  { key: "li_vertical", label: "LinkedIn Vertical 4:5", width: 720, height: 900, group: "Statics", placement: "LinkedIn feed, vertical" },
  { key: "li_square_xl", label: "LinkedIn Square XL", width: 1920, height: 1920, group: "Statics", placement: "LinkedIn feed, large square" },
  { key: "sc_ar_static", label: "Snapchat AR Static", width: 945, height: 2048, group: "Statics", placement: "Snapchat AR lens, static" },
  { key: "sc_ar_moving", label: "Snapchat AR Moving", width: 720, height: 1560, group: "Statics", placement: "Snapchat AR lens, moving" },
  // Neighbourly + logos
  { key: "nb_image", label: "Neighbourly Image", width: 1000, height: 1500, group: "Statics", placement: "Neighbourly sponsored post image" },
  { key: "native_logo", label: "Native Logo 100", width: 100, height: 100, group: "Statics", placement: "Native ad brand logo tile" },
  // OneRoof native
  { key: "oneroof_web", label: "OneRoof Native Web", width: 536, height: 280, group: "Statics", placement: "OneRoof native, website" },
  { key: "oneroof_app", label: "OneRoof Native App", width: 702, height: 367, group: "Statics", placement: "OneRoof native, app" },
  // Extra mobile + wide screens
  { key: "mobile_banner_300", label: "Mobile Banner S", width: 300, height: 50, group: "HTML", placement: "DV360 / GDN — small mobile banner" },
  { key: "ourauckland_header_wide", label: "OurAuckland Header Wide", width: 1920, height: 1005, group: "Statics", placement: "OurAuckland wide article header" },
  { key: "screen_ultra_wide", label: "Digital Screen Ultra-wide", width: 3840, height: 800, group: "OOH", placement: "Ultra-wide venue screens" },
  // Ogury rich media
  { key: "ogury_fullscreen", label: "Ogury Full Screen", width: 1388, height: 1734, group: "HTML", placement: "Ogury rich media, full screen mobile" },
  { key: "ogury_thumbnail", label: "Ogury Thumbnail", width: 720, height: 540, group: "HTML", placement: "Ogury rich media thumbnail" },
  { key: "ogury_header", label: "Ogury Header", width: 2640, height: 600, group: "HTML", placement: "Ogury rich media header" },
  { key: "ogury_footer", label: "Ogury Footer", width: 1760, height: 400, group: "HTML", placement: "Ogury rich media footer" },
] as const satisfies readonly { key: string; label: string; width: number; height: number; group: AdaptGroup; placement: string }[];

export type AdaptPreset = (typeof ADAPT_PRESETS)[number];

/** Presets in delivery-group order, each group in catalogue order. */
export function presetsByGroup(): { group: (typeof ADAPT_GROUPS)[number]; presets: AdaptPreset[] }[] {
  return ADAPT_GROUPS.map((group) => ({ group, presets: ADAPT_PRESETS.filter((p) => p.group === group.key) })).filter((g) => g.presets.length > 0);
}
