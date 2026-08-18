/**
 * Pōhutukawa tile placement — the guidelines encoded as the single source of
 * truth (AC Brand Guidelines June 2025, docs/brand-guidelines-distilled.md):
 *
 *  - The tile is the grid's building block: shortest axis divided into even
 *    tiles; the app's shipped-creative convention is tile = short/6 with the
 *    page margin at tile/3.
 *  - Placement: flush bottom-right of campaign artwork; the mark sits inside
 *    the white tile with 1/8 clearspace on all sides. Never cropped.
 *  - Strip formats (<=120px tall, the GWD banner pattern): tile = full
 *    height, flush right.
 *  - 1080-square social tiles carry NO logo (the pōhutukawa is the profile
 *    picture on council channels).
 *
 * Every importer/composer places logos through this module so the rule can't
 * drift between features.
 */

export interface LogoPlacement {
  /** Tile geometry (flush to the corner). The brand's logoUrl asset IS the
   * master tile — colour mark on its white square with the 1/8 clearspace
   * already baked in — so it is drawn at these bounds as-is, never wrapped
   * in another box or inset again. */
  tile: { x: number; y: number; w: number; h: number };
}

const STRIP_MAX_HEIGHT = 120;

export function isSocialSquare(w: number, h: number): boolean {
  return Math.abs(w - h) < 2 && w >= 600;
}

/** Guideline placement for a format, or null when the format carries no logo. */
export function guidelineLogoPlacement(w: number, h: number): LogoPlacement | null {
  if (isSocialSquare(w, h)) return null;
  const short = Math.min(w, h);
  const isStrip = h <= STRIP_MAX_HEIGHT;
  const tileSize = isStrip ? h : Math.max(24, Math.round(short / 6));
  const tile = { x: w - tileSize, y: h - tileSize, w: tileSize, h: tileSize };
  if (isStrip) {
    tile.y = 0; // full-height tile flush right
  }
  return { tile };
}
