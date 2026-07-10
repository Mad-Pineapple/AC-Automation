import { db } from "@workspace/db";
import { brandsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

// Distilled from the Auckland Council Brand Guidelines (June 2025).
// NOTE: the image generator only reads the first ~900 chars of `guidelines`,
// so the visual direction (palette hexes, illustration, photography) must
// stay at the top; voice/copy rules follow for the full-text generators.
const AUCKLAND_COUNCIL_GUIDELINES = `VISUAL DIRECTION
- Colours: base every layout on Ocean navy #11263d with White #ffffff (or light neutral grey); accent with Anther Red #de0a2b, Pohutukawa Leaf green #5b9c33, Shore blue #0073bd, Kowhai yellow #ffe104. Vibrant accents allowed: violet #3d2683, pink #de006e, lime #afca0b, light blue #00a7e5, orange #ef7d00. Muted supports: #8e9ba4, #e1a7bf, #c4d28b, #95d3e4, #f9e7c4. No colours outside this palette.
- Illustration: simple flat vector, no gradients or outlines; shapes built from circles, ellipses and leaf forms; three-plane scenes (background, mid-ground subject, larger foreground); faceless diverse people; NZ native birds and nature motifs.
- Photography: documentary-style real Auckland; rich, bright, vibrant colour; diverse people, ideally more than one person together; parks, beaches, playgrounds, community settings, not CBD-centric.
- Typography: National 2 font family. Headlines in National 2 Condensed Bold, ALL CAPS. Subheads, CTAs and URLs in National 2 Bold. Body copy in National 2 Regular. A hand-brush script accent is reserved for event/celebration creative only.

TONE OF VOICE - "Altogether Auckland"
- Warm, inclusive, conversational. Talk like an Aucklander, not a bureaucrat.
- Use personal pronouns: you, your, our, we, us.
- Prefer plain words: "let us know" not "notify us"; "have your say" not "consult with us"; "aim" or "goal" not "objective".
- Weave in togetherness/kotahitanga: the brand idea is that council and Aucklanders build the region together.
- Sign off with the strapline "Tamaki Turuki. Altogether Auckland." leading with the te reo Maori line.
- Full stops on body copy only when there is additional punctuation. Keep headline support copy to three lines or fewer.

COPY & LAYOUT RULES
- Attribute products/business units in body copy, e.g. "Auckland Council Pools and Leisure.", "Auckland Council Libraries."
- CTAs may use the search-bar treatment: a pill with "Search" (regular) + bold phrase, e.g. Search Auckland libraries.
- The pohutukawa logo sits in a white square tile; blossom = people together (kotahitanga), leaves = guardianship (kaitiakitanga), waves = Auckland's waters. Keep clear margins around it and do not distort or recolour it.`;

const DEMO_BRANDS: Array<typeof brandsTable.$inferInsert> = [
  {
    name: "Auckland Council",
    logoUrl: "/auckland-council-logo.png",
    primaryColor: "#11263d", // Ocean
    secondaryColor: "#0073bd", // Shore
    accentColor: "#de0a2b", // Anther Red
    backgroundColor: "#ffffff",
    textColor: "#11263d",
    fontFamily: "National 2",
    toneOfVoice:
      "Warm, inclusive and conversational - talk like an Aucklander, not a bureaucrat",
    industry: "Local government",
    guidelines: AUCKLAND_COUNCIL_GUIDELINES,
  },
];

export async function seedDemoData() {
  try {
    for (const brand of DEMO_BRANDS) {
      const existing = await db
        .select()
        .from(brandsTable)
        .where(eq(brandsTable.name, brand.name))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(brandsTable).values(brand);
        logger.info(`Seeded brand: ${brand.name}`);
      }
      // Existing brands are left untouched so admin edits (logo, colours,
      // guidelines) survive restarts.
    }
  } catch (err) {
    logger.error({ err }, "Failed to seed demo data");
  }
}
