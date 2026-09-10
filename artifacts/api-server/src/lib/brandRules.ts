/**
 * Per-brand rule engine for the generation pipeline.
 *
 * The brand guidelines PDF is distilled twice in this repo: as prose for
 * humans (docs/brand-guidelines-distilled.md) and as the brand's `guidelines`
 * text column (fed verbatim into prompts). This module is the third, sharpest
 * form: FORMAT-AWARE rules the backend can act on deterministically — which
 * formats carry the logo tile, what copy constraints apply per channel, what
 * the generators must and must not do. Generators consult these rules so
 * knowledge lives in one place instead of being re-encoded in every prompt.
 *
 * Rules are resolved per brand. Auckland Council (June 2025 guidelines +
 * contractors 2026) is fully encoded; other brands get neutral defaults so
 * the studio stays multi-brand safe.
 */

/** 1080x1080 organic/paid social feed tiles. AC rule: these carry NO
 *  pōhutukawa logo — the channel profile picture brands the post. */
export const SOCIAL_TILE_FORMATS = new Set(["social_square", "animated_social"]);

export interface BrandRuleSet {
  /** True when the Auckland Council rule set applies. */
  isAucklandCouncil: boolean;
  logo: {
    /** Tile edge = shortest canvas axis / divisor (AC grid: 6). */
    tileDivisor: number;
    /** Tile sits flush in the bottom-right corner (its clearspace is the 1/8
     *  padding inside the white box); the 1/3-tile page margin is for copy. */
    flushCorner: boolean;
    /** Formats that must not carry the logo tile at all. */
    omitOnFormats: Set<string>;
  };
  /** Prompt-ready copywriting rules for a given format. */
  copyRules(format: string): string[];
  /** Prompt-ready design rules for the HTML banner generator. */
  bannerRules(format: string): string[];
  /** Prompt-ready art direction rules for image generation. */
  imageryRules(): string[];
  /**
   * Layout rules for an awkward canvas (skyscrapers, super-wide strips, tall
   * OOH). Measured from shipped AEM "Get Ready" creative — see
   * docs/complex-size-layouts.md.
   */
  layoutRules(width: number, height: number): string[];
}

/** Shared across brands: the composition axis follows the canvas. */
function splitLayoutRules(width: number, height: number, panelColour: string): string[] {
  const ratio = width / height;
  if (ratio >= 2) {
    return [
      `LAYOUT (wide ${width}×${height}, ratio ${ratio.toFixed(1)}): split the canvas VERTICALLY — photography fills the LEFT ~50%, and a SOLID ${panelColour} panel fills the RIGHT ~50% carrying the copy. Do not float copy across the photograph.`,
      "Headline sits on the image side, left-aligned, occupying a band roughly a third of the canvas height — single line, large. The CTA sits in the right-hand panel, vertically centred.",
    ];
  }
  if (ratio <= 0.7) {
    return [
      `LAYOUT (tall ${width}×${height}, ratio ${ratio.toFixed(2)}): split the canvas HORIZONTALLY — photography fills the TOP ~55% with the headline over it, and a SOLID ${panelColour} panel fills the BOTTOM ~38% carrying the message and CTA.`,
      "The CTA is centred horizontally and sits roughly three-quarters of the way down. Headline band ≈ a third of the canvas width in cap height — big, not timid.",
    ];
  }
  return [
    `LAYOUT (${width}×${height}): copy may sit over full-bleed imagery, but put a gradient scrim behind it so the type stays legible.`,
  ];
}

const AC_COPY_BASE = [
  "Voice: warm, inclusive, conversational — talk like an Aucklander, not a bureaucrat. Use you/your/we/us/our.",
  'Word choices: "let us know" not "notify us"; "have your say" not "consult with us"; "aim" or "goal" not "objective".',
  "Headlines never end with a full stop. Supporting copy under a headline: three lines maximum.",
  "Full stops on body copy only when there is additional punctuation in the sentence.",
  'Attribute business units in body copy where relevant, e.g. "Auckland Council Libraries.", "Auckland Council Pools and Leisure."',
  'CTAs may use the search-bar treatment: the word "Search" plus a short phrase, e.g. "Search dog registration". URLs are lowercase.',
];

const AC_SOCIAL_COPY = [
  "Social (Meta) copy rules: the FIRST sentence must carry the key message; keep the creative single-minded (one message per asset).",
  "No words in ALL CAPS and no exclamation marks in social primary copy — they hurt Meta quality scores.",
  'The strapline "Tāmaki Turuki. Altogether Auckland." is NOT required on social statics — less is more.',
];

const AC_STRAPLINE = [
  'When the strapline is used it is always te reo first: "Tāmaki Turuki." then "Altogether Auckland.", usually over two lines.',
];

/** Auckland Council civic/seasonal calendar (months are 1-12). Used by the
 *  campaign-ideas generator so suggestions land at the right time of year. */
export const AC_CIVIC_CALENDAR: { months: number[]; topic: string }[] = [
  { months: [5, 6, 7], topic: "Dog registration renewals open 1 June — new tag by 1 August" },
  { months: [7, 8], topic: "Final push: dog rego deadline 1 August" },
  { months: [3, 4, 5], topic: "Storm and flood readiness before winter — know your flood risk, clear drains" },
  { months: [11, 12, 1, 2], topic: "Movies in Parks and Music in Parks free summer events (Dec–Mar)" },
  { months: [12, 1, 2], topic: "Summer water conservation and outdoor water restrictions" },
  { months: [12, 1], topic: "Holiday kerbside collection day changes; school holiday reading programmes at libraries" },
  { months: [6, 7], topic: "Matariki celebrations and events" },
  { months: [1], topic: "Auckland Anniversary weekend events" },
  { months: [2, 3], topic: "Pest Free Auckland autumn planting and trapping push" },
  { months: [8, 9], topic: "Rates instalment reminders; daylight saving prep for outdoor programmes" },
  { months: [9, 10], topic: "Spring park volunteering, community planting days" },
  { months: [10, 11], topic: "Water safety and pool fencing checks before summer; beach water quality (Safeswim)" },
  { months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], topic: "Recycle right / food scraps bin correct-use reminders (year-round)" },
  { months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], topic: "Have your say - consultations on plans and budgets (year-round)" },
];

export function getBrandRules(brandName: string | null | undefined): BrandRuleSet {
  const isAC = /auckland\s*council/i.test(brandName ?? "");

  if (!isAC) {
    // Neutral defaults for any other brand the studio hosts.
    return {
      isAucklandCouncil: false,
      logo: { tileDivisor: 6, flushCorner: true, omitOnFormats: new Set() },
      copyRules: () => [],
      bannerRules: () => [
        "Copy is ALWAYS the top layer: every text element must have a higher z-index than all imagery, panels and decoration — nothing may ever cover the copy.",
        "Do not draw or embed any brand logo yourself — the pipeline places the official logo deterministically.",
        "Keep the bottom-right corner (a square ~1/6 of the shortest side, flush to the corner) free of text and key artwork — the logo tile is placed there downstream.",
      ],
      imageryRules: () => [],
      layoutRules: (width: number, height: number) => splitLayoutRules(width, height, "solid brand-colour"),
    };
  }

  return {
    isAucklandCouncil: true,
    logo: {
      tileDivisor: 6,
      flushCorner: true,
      omitOnFormats: SOCIAL_TILE_FORMATS,
    },
    copyRules(format: string) {
      const rules = [...AC_COPY_BASE];
      if (SOCIAL_TILE_FORMATS.has(format) || format === "story") {
        rules.push(...AC_SOCIAL_COPY);
      } else {
        rules.push(...AC_STRAPLINE);
      }
      return rules;
    },
    bannerRules(format: string) {
      const rules = [
        "Copy is ALWAYS the top layer: every text element must have a higher z-index than all imagery, patterns and decoration — nothing may ever cover the copy.",
        "Typography hierarchy: headlines in the boldest weight, ALL CAPS, condensed feel; subheads/CTAs bold; body regular. One type family only.",
        'CTA button (id="cta"): rounded pill, SENTENCE CASE — never uppercase. When the CTA starts with "Search", use the council search-bar treatment: the word "Search" at font-weight 400, the phrase at font-weight 700, plus a small inline-SVG magnifier icon at the right of the pill.',
        "Base the layout on Ocean navy #11263d with white; use Anther Red #de0a2b, Pōhutukawa Leaf #5b9c33, Shore #0073bd or Kōwhai #ffe104 as accents. No colours outside the brand palette.",
        "Background kotahitanga wave patterns, if used, stay subtle: 30% opacity maximum.",
        "Do not draw, embed, or approximate the pōhutukawa logo yourself — the pipeline places the official tile deterministically.",
      ];
      if (SOCIAL_TILE_FORMATS.has(format)) {
        rules.push(
          "This is a 1080x1080 social feed tile: it carries NO logo and NO strapline (the channel profile picture brands the post). The full canvas is yours — no corner reservation needed.",
        );
      } else {
        rules.push(
          "Keep the bottom-right corner (a square of the shortest axis ÷ 6, flush to the corner) free of text and key artwork — the official logo tile is placed there after generation.",
        );
      }
      return rules;
    },
    layoutRules(width: number, height: number) {
      const rules = splitLayoutRules(width, height, "Ocean navy #11263d");
      rules.push(
        "Divide the image zone from the message panel with a kotahitanga pattern band (Kōwhai #ffe104 and Shore #0073bd tohu shapes on Ocean) — full width across the seam on tall formats, a shorter run along the top of the panel on wide ones.",
        "Photography is cover-cropped OVERSIZED and offset to place the subject — never letterboxed, never blindly centre-cropped. Always lay a gradient scrim between photo and type.",
        "The CTA search pill has a legibility floor of roughly 43px tall — keep it at that size rather than scaling it down with the canvas; it is placed, not stretched.",
        "On small or narrow canvases carry headline + CTA + logo ONLY. Shipped AC banners drop body copy entirely rather than shrink it.",
      );
      return rules;
    },
    imageryRules() {
      return [
        "Illustration style: simple flat vector, no gradients or outlines; shapes built from circles, ellipses and leaf forms; three-plane scenes; faceless diverse people; NZ native birds and nature motifs.",
        "Photography style: documentary real Auckland, rich bright vibrant colour, diverse people (ideally more than one together), community settings, never CBD-centric.",
        "Never render any text, lettering, numbers, logos or UI elements inside the artwork — all copy is overlaid separately.",
      ];
    },
  };
}
