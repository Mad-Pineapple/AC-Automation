import type { VariantRow } from "@workspace/api-client-react";

/**
 * Feed-driven batch variants are edited as plain text, one row per line:
 *   Label | Headline | Body | CTA
 * Trailing fields may be omitted; empty lines are ignored. Artwork is
 * rendered once per size and each row becomes its own asset.
 */

export function parseVariantsText(text: string): VariantRow[] | null {
  const rows = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, headline, bodyText, callToAction] = line.split("|").map((p) => p.trim());
      return {
        label: label || null,
        headline: headline || null,
        bodyText: bodyText || null,
        callToAction: callToAction || null,
      };
    })
    .filter((r) => r.label || r.headline || r.bodyText || r.callToAction);
  return rows.length > 0 ? rows : null;
}

export function variantsToText(variants: VariantRow[] | null | undefined): string {
  if (!variants?.length) return "";
  return variants
    .map((r) => [r.label ?? "", r.headline ?? "", r.bodyText ?? "", r.callToAction ?? ""].join(" | ").replace(/(\s\|\s)+$/, ""))
    .join("\n");
}
