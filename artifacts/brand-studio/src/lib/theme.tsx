import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useListBrands, type Brand } from "@workspace/api-client-react";

/**
 * White-label theming: the app shell takes its skin from the platform's
 * brand record (the first brand) — logo, name, strapline, and colours drive
 * the rail, the primary token, and the CTA gradient. With no brand yet the
 * shell wears a neutral "naked" skin; creating a brand dresses the whole
 * platform in it. Auckland Council's look is just seed data.
 */

// ---- Colour helpers ---------------------------------------------------------

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix a hex colour towards black (amount<0) or white (amount>0), 0..1. */
export function shade(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  return toHex(
    rgb[0] + (target - rgb[0]) * t,
    rgb[1] + (target - rgb[1]) * t,
    rgb[2] + (target - rgb[2]) * t,
  );
}

/** hex → "H S% L%" (the shadcn token format used in index.css). */
function hexToHslToken(hex: string): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

// ---- Theme model ------------------------------------------------------------

export interface PlatformTheme {
  /** True when no brand exists yet — the neutral pre-branding skin. */
  naked: boolean;
  brand: Brand | null;
  name: string;
  logoUrl: string | null;
  /** Newline-separated sign-off lines; empty array = don't render one. */
  straplineLines: string[];
  /** Hexes for decorative accents (stat tiles etc.). */
  primaryHex: string;
  secondaryHex: string;
  accentHex: string;
}

const NAKED: PlatformTheme = {
  naked: true,
  brand: null,
  name: "Brand Studio",
  logoUrl: null,
  straplineLines: [],
  primaryHex: "#1e293b",
  secondaryHex: "#475569",
  accentHex: "#0ea5e9",
};

const ThemeContext = createContext<PlatformTheme>(NAKED);

export function useTheme(): PlatformTheme {
  return useContext(ThemeContext);
}

function themeFromBrand(brand: Brand | undefined): PlatformTheme {
  if (!brand) return NAKED;
  return {
    naked: false,
    brand,
    name: brand.name,
    logoUrl: brand.logoUrl ?? null,
    straplineLines: (brand.strapline ?? "").split("\n").map((l) => l.trim()).filter(Boolean),
    primaryHex: brand.primaryColor,
    secondaryHex: brand.secondaryColor,
    accentHex: brand.accentColor,
  };
}

/** Push the theme into CSS custom properties so both Tailwind tokens and
 *  plain styles pick it up without prop drilling. */
function applyCssVars(theme: PlatformTheme): void {
  const root = document.documentElement;

  // Rail: the darker of primary/secondary reads as the brand's "ink". A
  // light primary (e.g. a white-heavy brand) still yields a legible dark rail.
  const railBase =
    relativeLuminance(theme.primaryHex) <= relativeLuminance(theme.secondaryHex)
      ? theme.primaryHex
      : theme.secondaryHex;
  const railFrom = relativeLuminance(railBase) > 0.35 ? shade(railBase, -0.55) : railBase;
  root.style.setProperty("--rail-from", railFrom);
  root.style.setProperty("--rail-to", shade(railFrom, -0.35));

  // Accent used ON the rail (kicker, active indicator): a lightened take on
  // the brand's action colour so it pops on the dark base.
  const action =
    relativeLuminance(theme.secondaryHex) >= relativeLuminance(theme.primaryHex)
      ? theme.secondaryHex
      : theme.primaryHex;
  root.style.setProperty("--rail-accent", shade(action, 0.3));

  // Primary CTA gradient.
  root.style.setProperty("--cta-from", action);
  root.style.setProperty("--cta-to", shade(action, 0.22));

  // shadcn primary token → buttons, active pills, links across the app.
  const primaryToken = hexToHslToken(action);
  if (primaryToken) {
    root.style.setProperty("--primary", primaryToken);
    root.style.setProperty("--ring", primaryToken);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { data: brands } = useListBrands();
  const theme = useMemo(() => themeFromBrand(brands?.[0]), [brands]);

  useEffect(() => {
    applyCssVars(theme);
    document.title = theme.naked ? "Brand Studio" : `${theme.name} · Brand Studio`;
    if (theme.logoUrl) {
      const link =
        document.querySelector<HTMLLinkElement>("link[rel='icon']") ??
        (() => {
          const l = document.createElement("link");
          l.rel = "icon";
          document.head.appendChild(l);
          return l;
        })();
      link.href = theme.logoUrl;
    }
  }, [theme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
