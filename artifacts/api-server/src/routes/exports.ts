/**
 * Static exports of freeform templates: PNG / JPG / print PDF / family zip.
 *
 *   GET  /templates/:id/export.png?scale=2
 *   GET  /templates/:id/export.jpg?quality=90&scale=1
 *   GET  /templates/:id/export.pdf?bleed=3&marks=1&cmyk=1&dpi=
 *   POST /templates/:id/export-family.zip   { ids?: number[] }
 *
 * Rendering happens in lib/renderFreeform (canvas + pdf-lib). Image sources
 * referenced by the template are resolved here: object-storage uploads via
 * ObjectStorageService, frontend public files from disk (dev) or over HTTP
 * from the deployment's own origin (production), remote URLs fetched as-is.
 */
import { Router, type Request, type Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { db, templatesTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { normalizeFreeformConfig, type FreeformConfig } from "../lib/freeform";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import {
  renderFreeformToPng,
  renderFreeformToJpeg,
  renderFreeformToPdf,
  isPrintTemplate,
  type ImageLoader,
} from "../lib/renderFreeform";
import { logger } from "../lib/logger";
import { buildTrackingRows, trackingRowsToCsv } from "../lib/trackingSheet";

const router = Router();
const objectStorage = new ObjectStorageService();

type TemplateRow = typeof templatesTable.$inferSelect;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseFreeform(t: TemplateRow): FreeformConfig | null {
  try {
    const parsed = JSON.parse(t.config || "{}");
    if (parsed && parsed.kind === "freeform") return normalizeFreeformConfig(parsed);
  } catch {
    /* fall through */
  }
  return null;
}

/** Filesystem-safe, header-safe download name. */
export function safeFilename(name: string, suffix: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "template"}${suffix}`;
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function flag(v: unknown): boolean {
  return v === "1" || v === "true" || v === "yes";
}

function requestOrigin(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() || req.headers.host || "";
  return `${proto}://${host}`;
}

function candidatePublicDirs(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    process.env.STATIC_DIR,
    path.resolve(here, "../../../brand-studio/public"), // src/routes (tsx)
    path.resolve(here, "../../brand-studio/public"), // dist/
    path.resolve(here, "../../brand-studio/dist/public"), // built frontend
    path.resolve(process.cwd(), "artifacts/brand-studio/public"),
  ].filter((d): d is string => !!d);
}

/** Build a per-request image loader (object storage, public files, remote). */
export function makeImageLoader(req: Request): ImageLoader {
  const origin = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") || requestOrigin(req);
  const cookie = req.headers.cookie;
  const authorization = req.headers.authorization;

  const fetchBytes = async (url: string, forwardAuth: boolean): Promise<Buffer | null> => {
    const headers: Record<string, string> = {};
    if (forwardAuth) {
      if (cookie) headers.cookie = cookie;
      if (authorization) headers.authorization = authorization;
    }
    const res = await fetch(url, { headers, redirect: "follow" });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  };

  return async (src: string): Promise<Buffer | null> => {
    try {
      // Strip our own origin so absolute same-origin URLs take the local paths.
      let s = src;
      if (/^https?:\/\//i.test(s)) {
        try {
          const u = new URL(s);
          if (u.origin === origin) s = u.pathname + u.search;
        } catch {
          /* keep as-is */
        }
      }

      if (/^https?:\/\//i.test(s)) return await fetchBytes(s, false);

      if (s.startsWith("/api/storage/objects/")) {
        const file = await objectStorage.getObjectEntityFile(s.slice("/api/storage".length).split(/[?#]/)[0]);
        const res = await objectStorage.downloadObject(file);
        return Buffer.from(await res.arrayBuffer());
      }
      if (s.startsWith("/api/storage/public-objects/")) {
        const file = await objectStorage.searchPublicObject(s.slice("/api/storage/public-objects/".length).split(/[?#]/)[0]);
        if (!file) return null;
        const res = await objectStorage.downloadObject(file);
        return Buffer.from(await res.arrayBuffer());
      }
      if (s.startsWith("/api/")) {
        // Any other API-served image (e.g. proxied assets): same-origin with auth.
        return await fetchBytes(`${origin}${s}`, true);
      }
      if (s.startsWith("/")) {
        const rel = s.split(/[?#]/)[0].slice(1);
        if (rel.includes("..")) return null;
        for (const dir of candidatePublicDirs()) {
          const p = path.join(dir, rel);
          if (existsSync(p)) return readFileSync(p);
        }
        return await fetchBytes(`${origin}${s}`, false);
      }
      return null;
    } catch (err) {
      if (!(err instanceof ObjectNotFoundError)) {
        logger.warn({ err, src: src.slice(0, 120) }, "export: image load failed");
      }
      return null;
    }
  };
}

async function loadTemplate(req: Request, res: Response): Promise<{ row: TemplateRow; config: FreeformConfig } | null> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid template id" });
    return null;
  }
  const [row] = await db.select().from(templatesTable).where(eq(templatesTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Template not found" });
    return null;
  }
  const config = parseFreeform(row);
  if (!config) {
    res.status(400).json({ error: "Only freeform templates can be exported as static files" });
    return null;
  }
  return { row, config };
}

function sendFile(res: Response, body: Buffer, contentType: string, filename: string, extraHeaders: Record<string, string> = {}) {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", String(body.length));
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader("Cache-Control", "private, no-store");
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(body);
}

interface PdfQuery {
  bleedMm: number;
  cropMarks: boolean;
  cmyk: boolean;
  dpi?: number;
}

function pdfQuery(q: Request["query"]): PdfQuery {
  const dpi = q.dpi !== undefined && q.dpi !== "" ? clampNum(q.dpi, 36, 1200, 0) : 0;
  return {
    bleedMm: clampNum(q.bleed, 0, 25, 0),
    cropMarks: flag(q.marks),
    cmyk: flag(q.cmyk),
    ...(dpi > 0 ? { dpi } : {}),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get("/templates/:id/export.png", requireAuth, async (req, res) => {
  const t = await loadTemplate(req, res);
  if (!t) return;
  const scale = clampNum(req.query.scale, 0.25, 4, 1);
  try {
    const png = await renderFreeformToPng(t.config, t.row.width, t.row.height, { scale, loadImage: makeImageLoader(req) });
    const suffix = scale === 1 ? "" : `@${String(scale).replace(/\.0+$/, "")}x`;
    sendFile(res, png, "image/png", safeFilename(t.row.name, `-${t.row.width}x${t.row.height}${suffix}.png`));
  } catch (err) {
    logger.error({ err, templateId: t.row.id }, "export.png failed");
    res.status(500).json({ error: "Failed to render PNG" });
  }
});

router.get("/templates/:id/export.jpg", requireAuth, async (req, res) => {
  const t = await loadTemplate(req, res);
  if (!t) return;
  const scale = clampNum(req.query.scale, 0.25, 4, 1);
  const quality = Math.round(clampNum(req.query.quality, 1, 100, 90));
  try {
    const jpg = await renderFreeformToJpeg(t.config, t.row.width, t.row.height, { scale, quality, loadImage: makeImageLoader(req) });
    sendFile(res, jpg, "image/jpeg", safeFilename(t.row.name, `-${t.row.width}x${t.row.height}.jpg`));
  } catch (err) {
    logger.error({ err, templateId: t.row.id }, "export.jpg failed");
    res.status(500).json({ error: "Failed to render JPG" });
  }
});

router.get("/templates/:id/export.pdf", requireAuth, async (req, res) => {
  const t = await loadTemplate(req, res);
  if (!t) return;
  const q = pdfQuery(req.query);
  try {
    const result = await renderFreeformToPdf(t.config, t.row.width, t.row.height, {
      ...q,
      title: t.row.name,
      loadImage: makeImageLoader(req),
    });
    const headers: Record<string, string> = {};
    if (result.warnings.length > 0) {
      // Keep the body a clean PDF; surface prepress warnings in a header the
      // UI can read (ASCII-only, since header values can't carry UTF-8).
      headers["X-Export-Warnings"] = encodeURIComponent(JSON.stringify(result.warnings));
      headers["Access-Control-Expose-Headers"] = "X-Export-Warnings";
    }
    sendFile(res, result.pdf, "application/pdf", safeFilename(t.row.name, `-${t.row.width}x${t.row.height}-print.pdf`), headers);
  } catch (err) {
    logger.error({ err, templateId: t.row.id }, "export.pdf failed");
    res.status(500).json({ error: "Failed to render PDF" });
  }
});

/**
 * Zip of the master plus every template adapted from it (description starts
 * with `Adapted from "<master name>"`), or an explicit `ids` list. PNG @1x
 * for every template; print templates (either edge >= 2000px) also get a
 * PDF with 3mm bleed and crop marks. A manifest.json lists what was
 * rendered and any prepress warnings.
 */
/** The master plus everything adapted from it: by the sourceTemplateId link
 * first, then the older description prefix, or an explicit id list. */
async function loadFamily(master: TemplateRow, explicitIds: number[] | null): Promise<TemplateRow[]> {
  let family: TemplateRow[];
  if (explicitIds && explicitIds.length > 0) {
    const ids = Array.from(new Set([master.id, ...explicitIds]));
    const rows = await db.select().from(templatesTable);
    family = rows.filter((r) => ids.includes(r.id));
  } else {
    const prefix = `Adapted from "${master.name}"`;
    const linked = await db.select().from(templatesTable).where(eq(templatesTable.sourceTemplateId, master.id));
    const adapted = await db
      .select()
      .from(templatesTable)
      .where(like(templatesTable.description, `${prefix.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
    const seen = new Set<number>([master.id]);
    family = [master];
    for (const r of [...linked, ...adapted]) {
      if (seen.has(r.id) || (!linked.includes(r) && !(r.description ?? "").startsWith(prefix))) continue;
      seen.add(r.id);
      family.push(r);
    }
  }
  family.sort((a, b) => (a.id === master.id ? -1 : b.id === master.id ? 1 : a.width * a.height - b.width * b.height));
  return family;
}

function parseIdList(v: unknown): number[] | null {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : null;
  if (!arr) return null;
  return arr.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
}

/**
 * GET /templates/:id/tracking-sheet.csv?campaign=&clickUrl=&ids=
 *
 * Meta tracking sheet for the family: one row per piece with the file name
 * convention, the Meta placement it fits, and the URL parameters that line
 * up with the HTML5 banners' UTM scheme (lib/trackingSheet.ts).
 */
router.get("/templates/:id/tracking-sheet.csv", requireAuth, async (req, res) => {
  const t = await loadTemplate(req, res);
  if (!t) return;
  const family = await loadFamily(t.row, parseIdList(req.query.ids));
  const rows = buildTrackingRows(t.row, family, {
    campaign: typeof req.query.campaign === "string" ? req.query.campaign.slice(0, 120) : null,
    clickUrl: typeof req.query.clickUrl === "string" && /^https?:\/\//i.test(req.query.clickUrl) ? req.query.clickUrl.slice(0, 500) : null,
    source: typeof req.query.source === "string" ? req.query.source.slice(0, 40) : null,
  });
  sendFile(res, Buffer.from(trackingRowsToCsv(rows), "utf8"), "text/csv; charset=utf-8", safeFilename(t.row.name, "-meta-tracking.csv"));
});

router.post("/templates/:id/export-family.zip", requireAuth, async (req, res) => {
  const t = await loadTemplate(req, res);
  if (!t) return;
  const body = (req.body ?? {}) as { ids?: unknown; campaign?: unknown; clickUrl?: unknown };
  const family = await loadFamily(t.row, parseIdList(body.ids));
  // Files are named by the tracking convention (campaign_variant_format_WxH)
  // so what lands in Ads Manager matches the sheet row for row.
  const tracking = buildTrackingRows(t.row, family, {
    campaign: typeof body.campaign === "string" ? body.campaign.slice(0, 120) : null,
    clickUrl: typeof body.clickUrl === "string" && /^https?:\/\//i.test(body.clickUrl) ? body.clickUrl.slice(0, 500) : null,
  });
  const fileNameFor = new Map(tracking.map((r) => [r.templateId, r.fileName]));

  const loadImage = makeImageLoader(req);
  const zip = new JSZip();
  const manifest: { id: number; name: string; width: number; height: number; files: string[]; warnings: string[]; error?: string }[] = [];
  const usedNames = new Set<string>();
  const unique = (name: string): string => {
    let candidate = name;
    let i = 2;
    while (usedNames.has(candidate)) {
      candidate = name.replace(/(\.[a-z0-9]+)$/i, `-${i}$1`);
      i++;
    }
    usedNames.add(candidate);
    return candidate;
  };

  for (const row of family) {
    const entry = { id: row.id, name: row.name, width: row.width, height: row.height, files: [] as string[], warnings: [] as string[] };
    manifest.push(entry);
    const config = parseFreeform(row);
    if (!config) {
      Object.assign(entry, { error: "not a freeform template" });
      continue;
    }
    try {
      const pngName = unique(fileNameFor.get(row.id) ?? safeFilename(row.name, `-${row.width}x${row.height}.png`));
      zip.file(pngName, await renderFreeformToPng(config, row.width, row.height, { scale: 1, loadImage }));
      entry.files.push(pngName);
      if (isPrintTemplate(row.width, row.height)) {
        const result = await renderFreeformToPdf(config, row.width, row.height, {
          bleedMm: 3,
          cropMarks: true,
          cmyk: false,
          title: row.name,
          loadImage,
        });
        const pdfName = unique((fileNameFor.get(row.id) ?? safeFilename(row.name, `-${row.width}x${row.height}.png`)).replace(/\.png$/, "-print.pdf"));
        zip.file(pdfName, result.pdf);
        entry.files.push(pdfName);
        entry.warnings.push(...result.warnings);
      }
    } catch (err) {
      logger.error({ err, templateId: row.id }, "export-family: render failed");
      Object.assign(entry, { error: err instanceof Error ? err.message : "render failed" });
    }
  }

  zip.file("manifest.json", JSON.stringify({ master: t.row.id, generatedAt: new Date().toISOString(), templates: manifest }, null, 2));
  zip.file("meta-tracking-sheet.csv", trackingRowsToCsv(tracking));
  try {
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    sendFile(res, bytes, "application/zip", safeFilename(t.row.name, "-family.zip"));
  } catch (err) {
    logger.error({ err, templateId: t.row.id }, "export-family: zip failed");
    res.status(500).json({ error: "Failed to build zip" });
  }
});

export default router;
