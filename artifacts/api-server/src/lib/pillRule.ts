/**
 * The pill rule, applied to whatever an engine produced.
 *
 * Seven engines can build a size (recompose, key-visual, layered, geometry,
 * liquid scale, approved-sibling scale, panel). Each placed the pill's label
 * its own way, so the label sat a pixel or three high or low depending on
 * which engine ran. The formula lives in lib/ctaPlan.ts; this pass makes the
 * last two steps true for every engine:
 *
 *   5. the label's CAP HEIGHT is centred on the pill's centre line
 *   6. the icon is centred on the same line
 *
 * and reports (never rewrites) a pill whose size has drifted from the
 * master's proportion to the heading. Imported masters are never touched —
 * this runs on generated sizes only.
 */
import type { FreeformConfig, FreeformElement, FreeformText } from "./freeform";
import { inferSlots } from "./slots";
import { capHeightPx, measureLine, type FontSpec } from "./textMeasure";

const spec = (t: FreeformText): FontSpec => ({
  family: t.fontFamily,
  weight: t.fontWeight === 700 ? 700 : 400,
  italic: t.fontStyle === "italic",
  letterSpacing: t.letterSpacing,
});

interface PillParts { cta: FreeformElement; label: FreeformText; icon: FreeformElement | null; headline: FreeformText | null }

function findPill(config: FreeformConfig, W: number, H: number): PillParts | null {
  const bySlot = (s: string) => config.elements.find((e) => e.slot === s);
  let cta = bySlot("cta"), label = bySlot("ctaLabel"), icon = bySlot("ctaIcon") ?? null, headline = bySlot("headline");
  if (!cta || !label) {
    const sem = inferSlots(config, W, H);
    const byId = (id?: string) => (id ? config.elements.find((e) => e.id === id) : undefined);
    cta = byId(sem.cta?.id); label = byId(sem.ctaLabel?.id); icon = byId(sem.ctaIcon?.id) ?? null; headline = headline ?? byId(sem.headline?.id);
  }
  if (!cta || !label || label.type !== "text" || (cta.type !== "rect" && cta.type !== "image")) return null;
  const cx = label.x + label.w / 2, cy = label.y + label.h / 2;
  if (cx < cta.x || cx > cta.x + cta.w || cy < cta.y - cta.h * 0.25 || cy > cta.y + cta.h * 1.25) return null;
  return { cta, label, icon, headline: headline && headline.type === "text" ? headline : null };
}

export interface PillRuleResult { config: FreeformConfig; notes: string[]; moved: boolean }

export function applyPillRule(
  config: FreeformConfig,
  W: number,
  H: number,
  master?: { config: FreeformConfig; width: number; height: number } | null,
): PillRuleResult {
  const parts = findPill(config, W, H);
  if (!parts) return { config, notes: [], moved: false };
  const { cta, label, icon } = parts;
  const notes: string[] = [];
  const patch = new Map<string, Partial<FreeformElement>>();

  const lines = (label.text ?? "").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 1) {
    const s = spec(label);
    const textW = measureLine(lines[0].replace(/\s+/g, " ").trim(), s, label.fontSize);
    if (textW <= label.w + 0.5) {
      // One line that fits its box: the frame becomes the cap height and the
      // baseline sits on its bottom edge, in the PNG, the editor and HTML5.
      const capH = Math.max(1, Math.round(capHeightPx(s, label.fontSize)));
      const y = Math.round((cta.y + (cta.h - capH) / 2) * 2) / 2;
      if (label.baselineFit !== "cap" || Math.abs(label.y - y) >= 0.5 || Math.abs(label.h - capH) >= 0.5) {
        patch.set(label.id, { y, h: capH, baselineFit: "cap" } as Partial<FreeformText>);
      }
    } else {
      const y = Math.round((cta.y + (cta.h - label.h) / 2) * 2) / 2;
      if (Math.abs(label.y - y) >= 0.5) patch.set(label.id, { y });
    }
  } else if (lines.length > 1) {
    const blockH = Math.round(label.fontSize * (label.lineHeight ?? 1.2) * lines.length);
    const y = Math.round((cta.y + (cta.h - blockH) / 2) * 2) / 2;
    if (Math.abs(label.y - y) >= 0.5 || Math.abs(label.h - blockH) >= 0.5) patch.set(label.id, { y, h: blockH });
  }
  if (icon) {
    const y = Math.round((cta.y + (cta.h - icon.h) / 2) * 2) / 2;
    if (Math.abs(icon.y - y) >= 0.5) patch.set(icon.id, { y });
  }

  // Size against the heading, as in the upload: reported, not rewritten —
  // resizing a pill here would push its neighbours about.
  if (master && parts.headline) {
    const m = findPill(master.config, master.width, master.height);
    if (m?.headline && m.headline.fontSize > 0 && parts.headline.fontSize > 0) {
      const kMaster = m.cta.h / m.headline.fontSize;
      const kHere = cta.h / parts.headline.fontSize;
      const labelShare = m.label.fontSize > 0 && m.cta.h > 0 ? Math.min(0.72, Math.max(0.3, m.label.fontSize / m.cta.h)) : 0.5;
      const floor = Math.max(24, 18 / labelShare);
      const atFloor = cta.h <= floor + 1.5;
      if (!atFloor && (kHere > kMaster * 1.3 || kHere < kMaster * 0.75)) {
        notes.push(`Check: the pill is ${Math.round(kHere * 100)}% of the heading's size here; in the original it is ${Math.round(kMaster * 100)}%.`);
      }
    }
  }

  if (patch.size === 0) return { config, notes, moved: false };
  return {
    config: { ...config, elements: config.elements.map((e) => (patch.has(e.id) ? ({ ...e, ...patch.get(e.id) } as FreeformElement) : e)) },
    notes,
    moved: true,
  };
}
