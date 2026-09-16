/**
 * One rule layer for every engine.
 *
 * Designers set behaviour per part on a campaign profile (pin, size, drop
 * when tight, minimum px). Until now only the layered engine read them; the
 * recomposer, key-visual, geometry and scaled engines used their own
 * constants, so a saved rule changed nothing but the "Rejected" label. Every
 * engine now asks this layer for a part's floor, whether it may be dropped
 * and where it is pinned. Studio floors (from docs/style-specs) are the
 * defaults; a designer's minPx wins.
 */
import { PART_RULE_SLOTS, type PartRules, type PartRuleSlot, type StyleSchema } from "./styleSpecs/getReadyBurst2";

/** Studio legibility floors in px (height of copy / button / lockup). */
export const BASE_FLOORS: Record<PartRuleSlot, number> = {
  headline: 12,
  subheadline: 10,
  message: 13,
  cta: 24,
  lockup: 16,
  logo: 24,
  cutout: 0,
  band: 0,
  photo: 0,
};

/** The smallest a pill label may be set. */
export const LABEL_FLOOR_PX = 9;

export interface RuleLayer {
  rules: Partial<Record<PartRuleSlot, PartRules>>;
  /** Minimum px for a part: the designer's minPx, else the studio floor. */
  floor(slot: PartRuleSlot, fallback?: number): number;
  /** May this part be dropped when the zone has no room? `undefined` when no rule says. */
  drop(slot: PartRuleSlot): boolean | undefined;
  pin(slot: PartRuleSlot): PartRules["pin"] | undefined;
  size(slot: PartRuleSlot): PartRules["size"] | undefined;
  /** Where the rules came from, for notes. */
  source: string;
}

/** Text role → part slot, for engines that only know the text role. */
export function slotForText(el: { slot?: string; role?: string }): PartRuleSlot | null {
  const s = el.slot ?? "";
  if ((PART_RULE_SLOTS as readonly string[]).includes(s)) return s as PartRuleSlot;
  if (s === "ctaLabel") return "cta";
  switch (el.role) {
    case "headline": return "headline";
    case "subhead": return "subheadline";
    case "body": return "message";
    case "cta": return "cta";
    default: return null;
  }
}

export function ruleLayerFor(schema?: StyleSchema | null): RuleLayer {
  const rules = schema?.partRules ?? {};
  return {
    rules,
    floor: (slot, fallback) => rules[slot]?.minPx ?? fallback ?? BASE_FLOORS[slot],
    drop: (slot) => rules[slot]?.dropWhenTight,
    pin: (slot) => rules[slot]?.pin,
    size: (slot) => rules[slot]?.size,
    source: schema ? `${schema.name} rules` : "studio floors",
  };
}
