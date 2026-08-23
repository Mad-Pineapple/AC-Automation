/**
 * Smoke test for the server-side freeform renderer (no server needed).
 *
 *   corepack pnpm --filter @workspace/scripts exec tsx src/render-test.ts
 *
 * Builds a 1080×1080 freeform config in code (gradient rect, National 2 Bold
 * headline over three lines, contain-fit logo) and writes
 * /tmp/render-test.png and /tmp/render-test.pdf.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const publicDir = path.join(repoRoot, "artifacts/brand-studio/public");

// Imported by URL so this script stays outside the api-server's tsconfig
// rootDir (tsx resolves it at runtime; the api-server typechecks it). The
// surface used here is re-declared locally for the same reason.
type LoadImage = (src: string) => Promise<Buffer | null>;
interface RendererModule {
  renderFreeformToPng(config: unknown, w: number, h: number, opts: { scale?: number; loadImage: LoadImage }): Promise<Buffer>;
  renderFreeformToJpeg(config: unknown, w: number, h: number, opts: { scale?: number; quality?: number; loadImage: LoadImage }): Promise<Buffer>;
  renderFreeformToPdf(
    config: unknown,
    w: number,
    h: number,
    opts: { bleedMm?: number; cropMarks?: boolean; cmyk?: boolean; dpi?: number; title?: string; loadImage: LoadImage },
  ): Promise<{ pdf: Buffer; warnings: string[]; pageWidthPt: number; pageHeightPt: number }>;
}
const renderer = (await import(
  pathToFileURL(path.join(repoRoot, "artifacts/api-server/src/lib/renderFreeform.ts")).href
)) as RendererModule;

const config = {
  kind: "freeform" as const,
  elements: [
    { id: "bg", type: "rect" as const, x: 0, y: 0, w: 1080, h: 1080, fill: "#00635F" },
    {
      id: "scrim",
      type: "rect" as const,
      x: 0,
      y: 540,
      w: 1080,
      h: 540,
      fill: "#000000",
      gradient: {
        angle: 180,
        stops: [
          { color: "#000000", alpha: 0, at: 0 },
          { color: "#000000", alpha: 0.75, at: 1 },
        ],
      },
    },
    { id: "panel", type: "rect" as const, x: 80, y: 80, w: 400, h: 120, fill: "#FFFFFF", radius: 24, borderWidth: 6, borderColor: "#F5A623", opacity: 0.9 },
    {
      id: "headline",
      type: "text" as const,
      role: "headline" as const,
      x: 80,
      y: 300,
      w: 920,
      h: 400,
      text: "Kia ora Tāmaki Makaurau\nWater restrictions start Monday — check your zone before you water the garden",
      fontSize: 88,
      fontWeight: 700 as const,
      color: "#FFFFFF",
      align: "left" as const,
      lineHeight: 1.05,
    },
    {
      id: "body",
      type: "text" as const,
      role: "body" as const,
      x: 80,
      y: 760,
      w: 600,
      h: 120,
      text: "Find out more at aucklandcouncil.govt.nz/water",
      fontSize: 34,
      fontWeight: 400 as const,
      color: "#FFFFFF",
      align: "left" as const,
      opacity: 0.85,
    },
    {
      id: "logo",
      type: "image" as const,
      role: "logo" as const,
      src: "/auckland-council-logo.png",
      x: 720,
      y: 880,
      w: 280,
      h: 120,
      fit: "contain" as const,
    },
  ],
};

const loadImage = async (src: string): Promise<Buffer | null> => {
  if (src.startsWith("/")) return readFile(path.join(publicDir, src.slice(1)));
  return null;
};

const t0 = Date.now();
const png = await renderer.renderFreeformToPng(config, 1080, 1080, { scale: 1, loadImage });
await writeFile("/tmp/render-test.png", png);
console.log(`PNG: ${png.length} bytes in ${Date.now() - t0}ms`);

const t1 = Date.now();
const png2 = await renderer.renderFreeformToPng(config, 1080, 1080, { scale: 2, loadImage });
await writeFile("/tmp/render-test@2x.png", png2);
console.log(`PNG @2x: ${png2.length} bytes in ${Date.now() - t1}ms`);

const t2 = Date.now();
const jpg = await renderer.renderFreeformToJpeg(config, 1080, 1080, { quality: 85, loadImage });
await writeFile("/tmp/render-test.jpg", jpg);
console.log(`JPG: ${jpg.length} bytes in ${Date.now() - t2}ms`);

const t3 = Date.now();
const pdf = await renderer.renderFreeformToPdf(config, 1080, 1080, {
  bleedMm: 3,
  cropMarks: true,
  cmyk: true,
  loadImage,
  title: "render-test",
});
await writeFile("/tmp/render-test.pdf", pdf.pdf);
console.log(`PDF: ${pdf.pdf.length} bytes, page ${pdf.pageWidthPt.toFixed(2)}×${pdf.pageHeightPt.toFixed(2)}pt in ${Date.now() - t3}ms`);
console.log("PDF warnings:", pdf.warnings);

// Print-sized template (A4 @ 300dpi declared in px): px are treated as points
// unless dpi is given; the oversized logo should trip the <250dpi warning.
const printConfig = {
  kind: "freeform" as const,
  elements: [
    { id: "bg", type: "rect" as const, x: 0, y: 0, w: 2480, h: 3508, fill: "#F5A623" },
    { id: "logo", type: "image" as const, role: "logo" as const, src: "/auckland-council-logo.png", x: 200, y: 200, w: 2080, h: 1200, fit: "contain" as const },
    { id: "h", type: "text" as const, role: "headline" as const, x: 200, y: 1600, w: 2080, h: 600, text: "A4 print test", fontSize: 220, fontWeight: 700 as const, color: "#000000", align: "center" as const },
  ],
};
const t4 = Date.now();
const a4 = await renderer.renderFreeformToPdf(printConfig, 2480, 3508, { bleedMm: 3, cropMarks: true, dpi: 300, loadImage });
await writeFile("/tmp/render-test-a4.pdf", a4.pdf);
console.log(`A4 PDF: ${a4.pdf.length} bytes, page ${a4.pageWidthPt.toFixed(2)}×${a4.pageHeightPt.toFixed(2)}pt (A4 trim = 595.28×841.89 + margins) in ${Date.now() - t4}ms`);
console.log("A4 warnings:", a4.warnings);
