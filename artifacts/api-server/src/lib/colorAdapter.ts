/**
 * CMYK <-> RGB colour adapter for the print->digital pipeline.
 *
 * Print masters (InDesign/Illustrator PDFs) specify colour as DeviceCMYK;
 * digital creative wants the brand's official sRGB hexes. A device-naive
 * CMYK->RGB conversion lands *near* the brand colour but rarely *on* it
 * (Anther Red's print build converts to ~#e50f27, not the official #de0a2b),
 * so the adapter pairs the conversion with palette snapping: a converted
 * colour within a small deltaE of an official brand colour is replaced by the
 * exact brand hex. Neutrals (white/black/grey) are never snapped, so body
 * text doesn't get pulled onto a dark brand colour.
 *
 * rgbToCmyk covers the reverse direction for print-bound exports.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Cmyk {
  c: number;
  m: number;
  y: number;
  k: number;
}

interface Lab {
  L: number;
  a: number;
  b: number;
}

/** Converted colours within this deltaE76 of a palette colour snap to it.
 * Calibrated against real print builds: pdfjs's perceptual CMYK->RGB puts
 * Kowhai at ~12.4 from the digital hex, while AC's core palette colours sit
 * 43+ apart from each other — 16 catches conversion drift without risking
 * cross-palette snaps (the snapper always picks the nearest colour anyway). */
export const DEFAULT_SNAP_TOLERANCE = 16;

export function hexToRgb(hex: string): Rgb | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Accepts components in 0-1 or 0-100 (values > 1 are treated as percent). */
export function cmykToRgb(c: number, m: number, y: number, k: number): Rgb {
  const unit = (v: number) => {
    const n = Number.isFinite(v) ? (v > 1 ? v / 100 : v) : 0;
    return Math.max(0, Math.min(1, n));
  };
  const [C, M, Y, K] = [unit(c), unit(m), unit(y), unit(k)];
  return {
    r: 255 * (1 - C) * (1 - K),
    g: 255 * (1 - M) * (1 - K),
    b: 255 * (1 - Y) * (1 - K),
  };
}

export function cmykToHex(c: number, m: number, y: number, k: number): string {
  return rgbToHex(cmykToRgb(c, m, y, k));
}

/** Returns percentages (0-100, rounded to one decimal). */
export function rgbToCmyk({ r, g, b }: Rgb): Cmyk {
  const R = Math.max(0, Math.min(255, r)) / 255;
  const G = Math.max(0, Math.min(255, g)) / 255;
  const B = Math.max(0, Math.min(255, b)) / 255;
  const k = 1 - Math.max(R, G, B);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  const pct = (v: number) => Math.round(v * 1000) / 10;
  return {
    c: pct((1 - R - k) / (1 - k)),
    m: pct((1 - G - k) / (1 - k)),
    y: pct((1 - B - k) / (1 - k)),
    k: pct(k),
  };
}

export function hexToCmyk(hex: string): Cmyk | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToCmyk(rgb) : null;
}

function rgbToLab({ r, g, b }: Rgb): Lab {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = R * 0.4124 + G * 0.3576 + B * 0.1805;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / 0.95047), fy = f(Y / 1.0), fz = f(Z / 1.08883);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function deltaE76(a: Lab, b: Lab): number {
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

function isNeutral(lab: Lab): boolean {
  const chroma = Math.sqrt(lab.a ** 2 + lab.b ** 2);
  return chroma < 8 || lab.L > 95 || lab.L < 8;
}

/** The brand's full approved palette: the five brand fields plus every hex
 * listed in the stored guidelines (same source brandCompliance trusts). */
export function collectBrandPaletteHexes(brand: {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
  guidelines?: string | null;
}): string[] {
  const hexes: string[] = [];
  for (const c of [
    brand.primaryColor,
    brand.secondaryColor,
    brand.accentColor,
    brand.backgroundColor,
    brand.textColor,
  ]) {
    if (typeof c === "string") hexes.push(c);
  }
  if (brand.guidelines) {
    hexes.push(...(brand.guidelines.match(/#[0-9a-fA-F]{6}\b/g) ?? []).slice(0, 32));
  }
  const seen = new Set<string>();
  return hexes
    .map((h) => hexToRgb(h))
    .filter((c): c is Rgb => c !== null)
    .map(rgbToHex)
    .filter((h) => (seen.has(h) ? false : (seen.add(h), true)));
}

export interface PaletteSnapper {
  /** Returns the exact palette hex when `hex` is within tolerance, else `hex`
   * unchanged (also unchanged for neutrals and unparseable values). */
  snap(hex: string): { hex: string; snapped: boolean };
}

export function createPaletteSnapper(
  paletteHexes: string[],
  tolerance: number = DEFAULT_SNAP_TOLERANCE,
): PaletteSnapper {
  const palette = paletteHexes
    .map((h) => {
      const rgb = hexToRgb(h);
      return rgb ? { hex: rgbToHex(rgb), lab: rgbToLab(rgb) } : null;
    })
    .filter((p): p is { hex: string; lab: Lab } => p !== null);

  return {
    snap(hex: string) {
      const rgb = hexToRgb(hex);
      if (!rgb || palette.length === 0) return { hex, snapped: false };
      const lab = rgbToLab(rgb);
      if (isNeutral(lab)) return { hex, snapped: false };
      let best: { hex: string; delta: number } | null = null;
      for (const p of palette) {
        const d = deltaE76(lab, p.lab);
        if (!best || d < best.delta) best = { hex: p.hex, delta: d };
      }
      if (best && best.delta <= tolerance && best.delta > 0) {
        return { hex: best.hex, snapped: true };
      }
      return { hex: rgbToHex(rgb), snapped: false };
    },
  };
}
