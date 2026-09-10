/**
 * Layout checks for adapted templates: the geometric half of compliance.
 *
 * Generated brief assets are scored for colour and copy; adapted templates
 * were never checked at all. These checks catch what a designer would flag
 * on a contact sheet — copy that overflows its box, furniture pushed off
 * the canvas, a CTA below its legibility floor, a headline that shrank to
 * nothing — and return plain-language issues the review UI can show.
 */
import type { FreeformConfig, FreeformText } from "./freeform";
import { wrapText, measureLine } from "./textMeasure";

export const CTA_MIN_HEIGHT_PX = 24;
export const HEADLINE_MIN_PX = 12;

export interface LayoutIssue {
  severity: "error" | "warn";
  message: string;
  elementId?: string;
}

export function checkLayout(config: FreeformConfig, width: number, height: number): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (const el of config.elements) {
    const slot = el.slot ?? "";
    const isBleedAllowed = el.type === "image" && (slot === "photo" || slot === "band" || slot === "" || el.role === "product" || el.role === "decoration");
    const off = el.x < -0.5 || el.y < -0.5 || el.x + el.w > width + 0.5 || el.y + el.h > height + 0.5;
    if (off && !isBleedAllowed && el.type !== "rect") {
      issues.push({ severity: "error", message: `"${label(el)}" sits partly outside the canvas.`, elementId: el.id });
    }
    if (el.type === "text") {
      const t = el as FreeformText;
      if (!t.text.trim()) continue;
      const lines = wrapText(t.text, t.w, { family: t.fontFamily, weight: t.fontWeight, letterSpacing: t.letterSpacing }, t.fontSize);
      const widest = Math.max(...lines.map((l) => measureLine(l, { family: t.fontFamily, weight: t.fontWeight, letterSpacing: t.letterSpacing }, t.fontSize)), 0);
      const blockH = lines.length * t.fontSize * (t.lineHeight ?? 1.2);
      if (widest > t.w * 1.04 + 2) {
        issues.push({ severity: "error", message: `"${label(el)}" is wider than its box (${Math.round(widest)}px in ${Math.round(t.w)}px).`, elementId: el.id });
      } else if (blockH > t.h * 1.35 + 4 && t.baselineFit !== "cap") {
        issues.push({ severity: "warn", message: `"${label(el)}" wraps to ${lines.length} lines and overflows its box.`, elementId: el.id });
      }
      if ((slot === "headline" || t.role === "headline") && t.fontSize < HEADLINE_MIN_PX) {
        issues.push({ severity: "error", message: `Headline is ${t.fontSize}px — below the ${HEADLINE_MIN_PX}px floor.`, elementId: el.id });
      }
    }
    if (slot === "cta" && el.h < CTA_MIN_HEIGHT_PX) {
      issues.push({ severity: "error", message: `Call-to-action is ${Math.round(el.h)}px tall — below the ${CTA_MIN_HEIGHT_PX}px legibility floor.`, elementId: el.id });
    }
  }
  issues.push(...checkMarkRules(config, width, height));
  return issues;
}

/**
 * The pōhutukawa mark, anther and pattern rules from the June 2025 brand
 * guidelines (docs/brand-guidelines-distilled.md, docs/brand-layout-style.md
 * §6), as far as they can be measured on a layout:
 *  - 1080×1080 social tiles carry no logo.
 *  - The logo is a square tile, bottom-right, sized to a grid division of the
 *    short axis (÷1, 2, 4, 6 or 8).
 *  - Patterns (the kotahitanga stamp row) sit next to the tile, never under it.
 *  - Background-texture patterns never exceed 30% opacity.
 *  - A photo in the anther frame that is cropped by the canvas needs design
 *    review (the guidelines say cropped anthers are subject to review).
 */
function checkMarkRules(config: FreeformConfig, width: number, height: number): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const short = Math.min(width, height);
  const isSocialSquare = Math.abs(width - height) < 2 && width >= 600;
  const logos = config.elements.filter((el) => el.type === "image" && (el.role === "logo" || el.slot === "logo"));
  const decorations = config.elements.filter((el) => el.type === "image" && el.role === "decoration" && el.slot !== "logo");
  const canvasArea = width * height;

  for (const logo of logos) {
    if (isSocialSquare) {
      issues.push({ severity: "error", message: "Logo on a 1080-square social tile — guidelines: social tiles carry no logo (the pōhutukawa is the profile picture).", elementId: logo.id });
      continue;
    }
    if (Math.abs(logo.w - logo.h) > Math.max(2, logo.w * 0.03)) {
      issues.push({ severity: "warn", message: `Logo tile is ${Math.round(logo.w)}×${Math.round(logo.h)} — the pōhutukawa tile is a square; never stretched.`, elementId: logo.id });
    }
    const rightGap = width - (logo.x + logo.w);
    const bottomGap = height - (logo.y + logo.h);
    const tolerance = Math.max(4, logo.w / 3 + 2);
    if (rightGap > tolerance || bottomGap > tolerance || logo.x < -0.5 || logo.y < -0.5) {
      issues.push({ severity: "warn", message: "Logo tile is not in the bottom-right corner — guidelines: placement is primarily bottom-right.", elementId: logo.id });
    }
    const gridDivisions = [1, 2, 4, 6, 8];
    const onGrid = gridDivisions.some((n) => Math.abs(logo.w - short / n) <= short / n * 0.12);
    if (!onGrid && height > 120) {
      issues.push({ severity: "warn", message: `Logo tile is ${Math.round(logo.w)}px — not a grid division of the ${short}px short axis (÷1, 2, 4, 6 or 8).`, elementId: logo.id });
    }
    for (const deco of decorations) {
      const ix = Math.max(0, Math.min(logo.x + logo.w, deco.x + deco.w) - Math.max(logo.x, deco.x));
      const iy = Math.max(0, Math.min(logo.y + logo.h, deco.y + deco.h) - Math.max(logo.y, deco.y));
      if (ix > 2 && iy > 2) {
        issues.push({ severity: "warn", message: `"${deco.slot ?? deco.id}" runs under the logo tile by ${Math.round(Math.min(ix, iy))}px — patterns sit next to the tile, never under it.`, elementId: deco.id });
      }
    }
  }

  for (const deco of decorations) {
    const coverage = (deco.w * deco.h) / canvasArea;
    const opacity = deco.opacity ?? 1;
    if (coverage > 0.4 && opacity > 0.3) {
      issues.push({ severity: "warn", message: `"${deco.slot ?? deco.id}" covers ${Math.round(coverage * 100)}% of the canvas at ${Math.round(opacity * 100)}% opacity — background patterns never exceed 30%.`, elementId: deco.id });
    }
  }

  for (const photo of config.elements) {
    // Only imported frames: recomposed photos are cover-cropped oversize by
    // design and always bleed, which is not an anther crop.
    if (photo.type !== "image" || photo.role !== "product" || !photo.id.startsWith("idml_")) continue;
    const edges = [photo.x < -2, photo.y < -2, photo.x + photo.w > width + 2, photo.y + photo.h > height + 2].filter(Boolean).length;
    if (edges >= 3) {
      issues.push({ severity: "warn", message: `Photo frame bleeds ${edges} canvas edges — a cropped anther is subject to design review.`, elementId: photo.id });
    }
  }
  return issues;
}

function label(el: { id: string; type: string; slot?: string; text?: string }): string {
  if (el.type === "text" && el.text) return el.text.replace(/\s+/g, " ").slice(0, 28);
  return el.slot ?? el.id;
}
