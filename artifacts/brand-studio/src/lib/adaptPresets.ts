// Formats a master template can be adapted into (Storyteq's Adaptation
// Studio pattern): one designed master → per-format layouts to fine-tune.
// Shared between the template editor's Adapt dialog and the PDF import page.
export const ADAPT_PRESETS = [
  { key: "social_square", label: "Social Square", width: 1080, height: 1080 },
  { key: "story", label: "Story", width: 1080, height: 1920 },
  { key: "mrec", label: "MREC Display", width: 300, height: 250 },
  { key: "banner", label: "Leaderboard", width: 728, height: 90 },
  { key: "billboard", label: "Billboard", width: 970, height: 250 },
  { key: "skyscraper", label: "Skyscraper", width: 160, height: 600 },
  { key: "print_a4", label: "Print A4", width: 2480, height: 3508 },
] as const;

export type AdaptPreset = (typeof ADAPT_PRESETS)[number];
