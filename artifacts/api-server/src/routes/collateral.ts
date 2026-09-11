import { Router } from "express";
import { db } from "@workspace/db";
import { templatesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { parseCollateralBrief } from "../lib/collateralBrief";
import { planCampaignBuild, messageTypeOf, type SizeInput } from "../lib/campaignPlan";
import { normalizeFreeformConfig } from "../lib/freeform";
import { isFlatArtwork } from "../lib/slots";
import { ObjectStorageService } from "../lib/objectStorage";
import { learnProfile } from "../lib/layoutProfile";

const router = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /briefs/collateral-plan  { objectPath }
 * Parse an uploaded Design Studio collateral workbook (.xlsx) into a
 * structured plan: channels → deliverables with resolved sizes, content
 * directions, dates and quantities. Read-only; creating the brief and the
 * size templates happens through the existing briefs/adapt endpoints.
 */
router.post("/briefs/collateral-plan", requireAuth, async (req, res): Promise<void> => {
  const objectPath = typeof req.body?.objectPath === "string" ? req.body.objectPath.trim() : "";
  if (!objectPath.startsWith("/objects/")) {
    res.status(400).json({ error: "objectPath is required" });
    return;
  }
  try {
    const file = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(file);
    const plan = await parseCollateralBrief(Buffer.from(await response.arrayBuffer()));
    res.json(plan);
  } catch (err) {
    req.log?.warn({ err }, "collateral brief parse failed");
    res.status(422).json({
      error: err instanceof Error ? err.message.slice(0, 200) : "Could not read that workbook.",
    });
  }
});

/**
 * POST /campaigns/build-plan  { masterTemplateIds, sizes, campaignName? }
 *
 * Decide how to produce a brief from the example artwork supplied: every
 * size is matched to the closest-shaped example, for every message variant
 * the examples carry. Returns the work list the build then executes.
 */
router.post("/campaigns/build-plan", requireAuth, async (req, res): Promise<void> => {
  const rawIds: unknown[] = Array.isArray(req.body?.masterTemplateIds) ? req.body.masterTemplateIds : [];
  const ids = rawIds.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
  const rawSizes: unknown[] = Array.isArray(req.body?.sizes) ? req.body.sizes : [];
  const sizes: SizeInput[] = rawSizes
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((s) => ({
      width: Number(s.width),
      height: Number(s.height),
      unit: typeof s.unit === "string" ? s.unit : "px",
      names: Array.isArray(s.names) ? (s.names as unknown[]).filter((n): n is string => typeof n === "string") : [],
      channel: typeof s.channel === "string" ? s.channel.slice(0, 60) : Array.isArray(s.channels) && typeof (s.channels as unknown[])[0] === "string" ? String((s.channels as unknown[])[0]).slice(0, 60) : null,
      messageType: typeof s.messageType === "string" ? s.messageType.slice(0, 40) : null,
    }))
    .filter((s) => Number.isFinite(s.width) && Number.isFinite(s.height) && s.width > 0 && s.height > 0)
    .slice(0, 200);

  if (ids.length === 0 || sizes.length === 0) {
    res.status(400).json({ error: "masterTemplateIds and sizes are both required" });
    return;
  }

  const rows = await db
    .select({ id: templatesTable.id, name: templatesTable.name, width: templatesTable.width, height: templatesTable.height, config: templatesTable.config })
    .from(templatesTable)
    .where(inArray(templatesTable.id, ids));
  if (rows.length === 0) {
    res.status(404).json({ error: "None of those example templates exist" });
    return;
  }

  const campaignName = typeof req.body?.campaignName === "string" ? req.body.campaignName.trim().slice(0, 80) : "";
  const masters = rows.map((r) => {
    let flat = false;
    try {
      const raw = JSON.parse(r.config) as { kind?: string };
      if (raw?.kind === "freeform") flat = isFlatArtwork(normalizeFreeformConfig(raw));
    } catch {
      flat = false;
    }
    let copy: string[] = [];
    try {
      const raw = JSON.parse(r.config) as { elements?: { type?: string; text?: string }[] };
      copy = (raw.elements ?? []).filter((e) => e.type === "text" && typeof e.text === "string").map((e) => e.text as string);
    } catch { copy = []; }
    return { id: r.id, name: r.name, width: r.width, height: r.height, flat, messageType: messageTypeOf(r.name, copy) };
  });
  const plan = planCampaignBuild(masters, sizes, { campaignName });
  // The selected examples ARE the campaign: measure them into its layout
  // profile so every job is built from the family's own numbers.
  let profile: { id: number; name: string; measuredClasses: string[]; interpolatedClasses: string[]; notes: string[] } | null = null;
  try {
    const learned = await learnProfile(masters.map((m) => m.id), campaignName || null, (req as any).clerkUserId ?? null);
    if (learned) {
      const z = learned.stored.profile.zones;
      profile = {
        id: learned.stored.id,
        name: learned.stored.name,
        measuredClasses: (Object.keys(z) as (keyof typeof z)[]).filter((k) => z[k].measured),
        interpolatedClasses: (Object.keys(z) as (keyof typeof z)[]).filter((k) => !z[k].measured),
        notes: [...learned.stored.profile.notes, ...learned.skipped],
      };
    }
  } catch (err) {
    req.log?.warn({ err }, "profile learn in build-plan failed");
  }
  res.json({ ...plan, profile });
});

export default router;
