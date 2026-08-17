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

/** Minimal RFC 4180 CSV: quoted fields, doubled-quote escapes, CR/LF rows. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Record<string, keyof VariantRow> = {
  label: "label", name: "label", variant: "label", audience: "label", region: "label", suburb: "label",
  headline: "headline", title: "headline",
  body: "bodyText", bodytext: "bodyText", message: "bodyText", copy: "bodyText", description: "bodyText",
  cta: "callToAction", calltoaction: "callToAction", button: "callToAction",
};

/**
 * Parse a spreadsheet CSV export into variant rows. A header row is detected
 * when any cell matches a known column name (label/headline/body/cta and
 * common aliases); otherwise columns are read positionally as
 * Label, Headline, Body, CTA.
 */
export function parseVariantsCsv(text: string): VariantRow[] | null {
  const grid = parseCsv(text);
  if (grid.length === 0) return null;

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const headerKeys = grid[0].map((c) => HEADER_ALIASES[norm(c)]);
  const hasHeader = headerKeys.some(Boolean);

  const positional: (keyof VariantRow)[] = ["label", "headline", "bodyText", "callToAction"];
  const keys = hasHeader ? headerKeys : positional;
  const dataRows = hasHeader ? grid.slice(1) : grid;

  const rows = dataRows
    .map((cells) => {
      const r: VariantRow = { label: null, headline: null, bodyText: null, callToAction: null };
      cells.forEach((cell, i) => {
        const key = keys[i];
        const v = cell.trim();
        if (key && v) r[key] = v;
      });
      return r;
    })
    .filter((r) => r.label || r.headline || r.bodyText || r.callToAction);
  return rows.length > 0 ? rows : null;
}
