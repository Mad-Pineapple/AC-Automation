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

export function getBrandRules(brandName: string | null | undefined): BrandRuleSet {
  const isAC = /auckland\s*council/i.test(brandName ?? "");

  if (!isAC) {
    // Neutral defaults for any other brand the studio hosts.
    return {
      isAucklandCouncil: false,
      logo: { tileDivisor: 6, flushCorner: true, omitOnFormats: new Set() },
      copyRules: () => [],
      bannerRules: () => [
        "Do not draw or embed any brand logo yourself — the pipeline places the official logo deterministically.",
        "Keep the bottom-right corner (a square ~1/6 of the shortest side, flush to the corner) free of text and key artwork — the logo tile is placed there downstream.",
      ],
      imageryRules: () => [],
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
    imageryRules() {
      return [
        "Illustration style: simple flat vector, no gradients or outlines; shapes built from circles, ellipses and leaf forms; three-plane scenes; faceless diverse people; NZ native birds and nature motifs.",
        "Photography style: documentary real Auckland, rich bright vibrant colour, diverse people (ideally more than one together), community settings, never CBD-centric.",
        "Never render any text, lettering, numbers, logos or UI elements inside the artwork — all copy is overlaid separately.",
      ];
    },
  };
}
