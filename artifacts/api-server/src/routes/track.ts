import { Router } from "express";
import { db } from "@workspace/db";
import { adTagsTable, adEventsTable, assetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

// Public, unauthenticated router mounted at app level (/track). These endpoints
// are hit by external browsers when an ad tag renders, so they must not require auth.
const router = Router();

// 1x1 transparent GIF.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

async function recordEvent(token: string, type: "impression" | "click", req: any) {
  const [tag] = await db.select().from(adTagsTable).where(eq(adTagsTable.token, token));
  if (!tag) return null;
  await db.insert(adEventsTable).values({
    adTagId: tag.id,
    assetId: tag.assetId,
    type,
    referrer: (req.get("referer") || req.get("referrer") || null) as string | null,
    userAgent: (req.get("user-agent") || null) as string | null,
  });
  return tag;
}

function noCache(res: any) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

// Only http/https destinations are allowed for click-through redirects, to avoid
// turning the public click endpoint into an open redirect for dangerous schemes
// (javascript:, data:, etc.).
function isSafeHttpUrl(url: string | null): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Serves an HTML banner into an iframe and logs an impression.
router.get("/serve/:token", async (req, res) => {
  try {
    const tag = await recordEvent(req.params.token, "impression", req);
    if (!tag) { res.status(404).send("Tag not found"); return; }
    const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, tag.assetId));
    if (!asset) { res.status(404).send("Asset not found"); return; }
    noCache(res);
    res.set("Content-Type", "text/html; charset=utf-8");
    // Render untrusted creative HTML in a sandboxed, opaque origin so any scripts
    // it contains cannot read this app's cookies/storage or call its API. Scripts
    // still run (for animated banners) and user-activated clicks may navigate top.
    res.set(
      "Content-Security-Policy",
      "sandbox allow-scripts allow-top-navigation-by-user-activation;",
    );

    const clickUrl = tag.clickUrl
      ? `/track/click/${encodeURIComponent(tag.token)}`
      : null;

    // HTML creatives carry standard clickTag wiring (injected at generation
    // time), so serve them as-is with window.clickTag pointed at our click
    // redirect — exactly how an ad server resolves clickTag. This keeps click
    // counting accurate without wrapping the document in an <a> (which is
    // invalid around a full HTML document).
    if (asset.htmlContent) {
      let html = asset.htmlContent;
      if (clickUrl && /clickTag/i.test(html)) {
        const define = `<script>window.clickTag=${JSON.stringify(clickUrl)};</script>`;
        html = /<head[^>]*>/i.test(html)
          ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${define}`)
          : `${define}\n${html}`;
      }
      res.send(html);
      return;
    }

    const inner = asset.imageUrl
      ? `<img src="${asset.imageUrl}" style="display:block;max-width:100%;height:auto;border:0" alt="" />`
      : `<div style="font-family:sans-serif;padding:8px">${asset.headline ?? "Ad"}</div>`;
    const body = clickUrl
      ? `<a href="${clickUrl}" target="_top" style="text-decoration:none;color:inherit;display:block">${inner}</a>`
      : inner;
    res.send(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style></head><body>${body}</body></html>`);
  } catch (err) {
    logger.error({ err }, "ad tag serve failed");
    res.status(500).send("Error");
  }
});

// 1x1 tracking pixel for static-image tags; logs an impression.
router.get("/pixel/:token.gif", async (req, res) => {
  try {
    await recordEvent(req.params.token, "impression", req);
  } catch (err) {
    logger.error({ err }, "ad tag pixel failed");
  }
  noCache(res);
  res.set("Content-Type", "image/gif");
  res.send(PIXEL);
});

// Logs a click and redirects to the configured landing URL.
router.get("/click/:token", async (req, res) => {
  try {
    const tag = await recordEvent(req.params.token, "click", req);
    if (tag && isSafeHttpUrl(tag.clickUrl)) {
      res.redirect(302, tag.clickUrl);
      return;
    }
  } catch (err) {
    logger.error({ err }, "ad tag click failed");
  }
  res.status(404).send("No destination configured");
});

export default router;
