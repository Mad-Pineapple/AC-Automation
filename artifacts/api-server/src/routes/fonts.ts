/**
 * GET /fonts.css — @font-face rules for every campaign font the app holds
 * (InDesign package "Document fonts"), served from object storage. The
 * frontend links this stylesheet so the editor and previews draw imported
 * layouts with the designer's type exactly as the server-side export does;
 * without it the browser substitutes the brand family and display faces
 * such as DS-Digital overflow their boxes.
 */
import { Router } from "express";
import { listCampaignFonts } from "../lib/brandFonts";

const router = Router();

function formatFor(contentType: string | null, file: string): string {
  const f = file.toLowerCase();
  if (contentType === "font/woff2" || f.endsWith(".woff2")) return "woff2";
  if (contentType === "font/woff" || f.endsWith(".woff")) return "woff";
  if (contentType === "font/otf" || f.endsWith(".otf")) return "opentype";
  return "truetype";
}

router.get("/fonts.css", async (_req, res) => {
  const fonts = await listCampaignFonts();
  const css = fonts
    .map(
      (f) =>
        `@font-face{font-family:${JSON.stringify(f.family)};src:url("/api/storage${f.objectPath}") format("${formatFor(f.contentType, f.file)}");font-weight:${f.weight};font-style:${f.style};font-display:swap;}`,
    )
    .join("\n");
  res.setHeader("Content-Type", "text/css; charset=utf-8");
  // Short cache: a package import adds fonts and the next page load should see them.
  res.setHeader("Cache-Control", "public, max-age=60");
  res.send(`/* ${fonts.length} campaign font(s) */\n${css}\n`);
});

export default router;
