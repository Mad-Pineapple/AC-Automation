import { Router } from "express";
import { randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import { templatesTable, brandsTable, brandAssetsTable, creativesTable, creativeEventsTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";
import { normalizeFreeformConfig, isFreeformConfig } from "../lib/freeform";
import { buildHtmlPackage, ARTWORK_MOTIONS, COPY_MOTIONS, type ArtworkMotion, type CopyMotion } from "../lib/htmlExport";

function motionFromBody(body: any): { artworkMotion?: ArtworkMotion; copyMotion?: CopyMotion; storyFrames?: boolean; matchKeyVisual?: boolean } {
  const out: { artworkMotion?: ArtworkMotion; copyMotion?: CopyMotion; storyFrames?: boolean; matchKeyVisual?: boolean } = {};
  if (typeof body?.matchKeyVisual === "boolean") out.matchKeyVisual = body.matchKeyVisual;
  if (ARTWORK_MOTIONS.includes(body?.artworkMotion)) out.artworkMotion = body.artworkMotion;
  if (COPY_MOTIONS.includes(body?.copyMotion)) out.copyMotion = body.copyMotion;
  if (typeof body?.storyFrames === "boolean") out.storyFrames = body.storyFrames;
  return out;
}
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();
const objectStorageService = new ObjectStorageService();

function requestBase(req: any): string {
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0];
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

/** Load bytes for any src the template can carry. */
function assetLoader(base: string) {
  return async (src: string): Promise<{ bytes: Buffer; contentType: string } | null> => {
    try {
      if (src.startsWith("/api/storage")) {
        const file = await objectStorageService.getObjectEntityFile(src.replace(/^\/api\/storage/, ""));
        const res = await objectStorageService.downloadObject(file);
        return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
      }
      const url = /^https?:\/\//.test(src) ? src : `${base}${src}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
    } catch {
      return null;
    }
  };
}


/** Campaign fonts stored by package import, as embeddable references. The
 * exporter packages only families the creative's copy actually uses. */
async function customFontRefs(): Promise<{ family: string; src: string; format: "truetype" | "opentype" }[]> {
  try {
    const rows = await db.select().from(brandAssetsTable).where(eq(brandAssetsTable.kind, "font"));
    const seen = new Set<string>();
    const out: { family: string; src: string; format: "truetype" | "opentype" }[] = [];
    for (const r of rows) {
      const family = r.name.split(" (")[0].trim();
      if (!family || seen.has(family)) continue;
      seen.add(family);
      out.push({
        family,
        src: `/api/storage${r.objectPath}`,
        format: r.contentType === "font/otf" ? "opentype" : "truetype",
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * POST /templates/:id/export-html  { campaign?, variant?, clickUrl?, fluid?, animate? }
 * Registers a tagged creative and streams its HTML5 package (zip).
 */
router.post("/templates/:id/export-html", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [template] = await db.select().from(templatesTable).where(eq(templatesTable.id, id));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  let parsed: unknown;
  try { parsed = JSON.parse(template.config || "{}"); } catch { parsed = {}; }
  if (!isFreeformConfig(parsed)) { res.status(400).json({ error: "Only freeform templates export to HTML5" }); return; }
  const config = normalizeFreeformConfig(parsed);
  const [brand] = await db.select().from(brandsTable).orderBy(brandsTable.id).limit(1);

  const body = req.body ?? {};
  const campaign = typeof body.campaign === "string" && body.campaign.trim() ? body.campaign.trim().slice(0, 80) : null;
  const variant = typeof body.variant === "string" && body.variant.trim() ? body.variant.trim().slice(0, 80) : null;
  const clickUrl = typeof body.clickUrl === "string" && /^https?:\/\//.test(body.clickUrl.trim()) ? body.clickUrl.trim().slice(0, 2000) : null;
  const fluid = body.fluid === true;
  const pixelUrls = Array.isArray(body.pixelUrls)
    ? (body.pixelUrls as unknown[]).filter((u): u is string => typeof u === "string" && /^https:\/\//i.test(u.trim())).map((u) => u.trim().slice(0, 1000)).slice(0, 5)
    : [];
  const animate = body.animate !== false;
  const ANIMS = new Set(["none", "entrance", "kenburns", "frames", "reveal"]);
  const animation = (ANIMS.has(body.animation) ? body.animation : "entrance") as
    "none" | "entrance" | "kenburns" | "frames" | "reveal";
  const durationSec = Number.isFinite(Number(body.durationSec)) ? Number(body.durationSec) : undefined;
  const loops = Number.isFinite(Number(body.loops)) ? Number(body.loops) : undefined;
  const headline = config.elements.find((e) => e.id === "kv_headline");
  const layoutLabel =
    headline && config.layoutOptions
      ? (config.layoutOptions.find((o) => Math.abs(o.x - headline.x) < 2 && Math.abs(o.y - headline.y) < 2)?.label ?? null)
      : null;

  const token = randomBytes(9).toString("base64url");
  const format = `${template.width}x${template.height}`;
  const [creative] = await db
    .insert(creativesTable)
    .values({
      templateId: template.id,
      token,
      name: template.name,
      campaign,
      format,
      variant,
      layoutLabel,
      clickUrl,
      fluid,
      createdBy: (req as any).clerkUserId ?? null,
    })
    .returning();

  const base = process.env.PUBLIC_BASE_URL ?? requestBase(req);
  const pkg = await buildHtmlPackage({
    width: template.width,
    height: template.height,
    config,
    tags: { token, name: template.name, campaign, format, variant, layoutLabel },
    clickUrl,
    studioBase: base,
    brandFontFamily: brand?.fontFamily ?? "National 2",
    animate,
    animation,
    ...motionFromBody(body),
    accentColor: brand?.primaryColor ?? "#11263d",
    durationSec,
    loops,
    fluid,
    pixelUrls,
    customFonts: await customFontRefs(),
    loadAsset: assetLoader(base),
  });

  const safe = `${template.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "creative"}_${format}_${token}.zip`;
  res.set("Content-Type", "application/zip");
  res.set("Content-Disposition", `attachment; filename="${safe}"`);
  res.set("X-Creative-Id", String(creative.id));
  res.set("X-Creative-Token", token);
  res.send(pkg.zip);
});

/**
 * POST /templates/:id/preview-html — the same package rendered as ONE
 * self-contained HTML document (assets inlined, beacons off) for an in-app
 * motion preview. Nothing is registered.
 */
router.post("/templates/:id/preview-html", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [template] = await db.select().from(templatesTable).where(eq(templatesTable.id, id));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  let parsed: unknown;
  try { parsed = JSON.parse(template.config || "{}"); } catch { parsed = {}; }
  if (!isFreeformConfig(parsed)) { res.status(400).json({ error: "Only freeform templates export to HTML5" }); return; }
  const config = normalizeFreeformConfig(parsed);
  const [brand] = await db.select().from(brandsTable).orderBy(brandsTable.id).limit(1);
  const body = req.body ?? {};
  const ANIMS = new Set(["none", "entrance", "kenburns", "frames", "reveal"]);
  const animation = (ANIMS.has(body.animation) ? body.animation : "entrance") as
    "none" | "entrance" | "kenburns" | "frames" | "reveal";
  const base = process.env.PUBLIC_BASE_URL ?? requestBase(req);
  const pkg = await buildHtmlPackage({
    width: template.width,
    height: template.height,
    config,
    tags: { token: "preview", name: template.name, campaign: null, format: `${template.width}x${template.height}`, variant: null, layoutLabel: null },
    clickUrl: typeof body.clickUrl === "string" ? body.clickUrl : null,
    studioBase: base,
    brandFontFamily: brand?.fontFamily ?? "National 2",
    animate: body.animate !== false,
    animation,
    ...motionFromBody(body),
    accentColor: brand?.primaryColor ?? "#11263d",
    durationSec: Number.isFinite(Number(body.durationSec)) ? Number(body.durationSec) : undefined,
    loops: Number.isFinite(Number(body.loops)) ? Number(body.loops) : undefined,
    fluid: body.fluid === true,
    inline: true,
    customFonts: await customFontRefs(),
    loadAsset: assetLoader(base),
  });
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.send(pkg.html);
});

/** GET /creatives — exported creatives with event counts (Performance view). */
router.get("/creatives", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: creativesTable.id,
      templateId: creativesTable.templateId,
      token: creativesTable.token,
      name: creativesTable.name,
      campaign: creativesTable.campaign,
      format: creativesTable.format,
      variant: creativesTable.variant,
      layoutLabel: creativesTable.layoutLabel,
      clickUrl: creativesTable.clickUrl,
      fluid: creativesTable.fluid,
      createdAt: creativesTable.createdAt,
      impressions: sql<number>`cast(count(*) filter (where ${creativeEventsTable.type} = 'impression') as int)`,
      viewable: sql<number>`cast(count(*) filter (where ${creativeEventsTable.type} = 'viewable') as int)`,
      interactions: sql<number>`cast(count(*) filter (where ${creativeEventsTable.type} = 'interaction') as int)`,
      clicks: sql<number>`cast(count(*) filter (where ${creativeEventsTable.type} = 'click') as int)`,
      avgViewMs: sql<number>`cast(coalesce(avg(${creativeEventsTable.viewMs}) filter (where ${creativeEventsTable.type} = 'view'), 0) as int)`,
    })
    .from(creativesTable)
    .leftJoin(creativeEventsTable, eq(creativeEventsTable.creativeId, creativesTable.id))
    .groupBy(creativesTable.id)
    .orderBy(desc(creativesTable.createdAt));
  res.json(rows);
});

export default router;
