/**
 * Campaign layout profiles: measured from the supplied artwork, used by the
 * adapter in place of a hand-written schema.
 *
 *   POST   /layout-profiles/learn   { masterTemplateIds, name? }  measure + store
 *   GET    /layout-profiles                                       list
 *   GET    /layout-profiles/:id                                   one, with notes
 *   DELETE /layout-profiles/:id                                   admin
 */
import { Router } from "express";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";
import { learnProfile, listProfiles, getProfile, deleteProfile, type StoredProfile } from "../lib/layoutProfile";

const router = Router();

export function formatProfile(p: StoredProfile) {
  const zones = p.profile.zones;
  return {
    id: p.id,
    name: p.name,
    sources: p.profile.sources,
    measuredClasses: (Object.keys(zones) as (keyof typeof zones)[]).filter((k) => zones[k].measured),
    interpolatedClasses: (Object.keys(zones) as (keyof typeof zones)[]).filter((k) => !zones[k].measured),
    measuredAxes: p.profile.measuredAxes,
    notes: p.profile.notes,
    profile: p.profile,
    updatedAt: p.updatedAt.toISOString(),
  };
}

router.post("/layout-profiles/learn", requireAuth, async (req, res): Promise<void> => {
  const raw: unknown[] = Array.isArray(req.body?.masterTemplateIds) ? req.body.masterTemplateIds : [];
  const ids = raw.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);
  if (ids.length === 0) { res.status(400).json({ error: "masterTemplateIds is required" }); return; }
  const name = typeof req.body?.name === "string" ? req.body.name.slice(0, 120) : null;
  try {
    const learned = await learnProfile(ids, name, (req as any).clerkUserId ?? null);
    if (!learned) { res.status(422).json({ error: "None of those examples could be measured: each needs a recognised panel and headline." }); return; }
    res.status(201).json({ ...formatProfile(learned.stored), skipped: learned.skipped });
  } catch (err) {
    (req as any).log?.warn?.({ err }, "profile learn failed");
    res.status(500).json({ error: err instanceof Error ? err.message.slice(0, 200) : "Could not learn a profile" });
  }
});

router.get("/layout-profiles", requireAuth, async (_req, res): Promise<void> => {
  res.json((await listProfiles()).map(formatProfile));
});

router.get("/layout-profiles/:id", requireAuth, async (req, res): Promise<void> => {
  const p = await getProfile(Number(req.params.id));
  if (!p) { res.status(404).json({ error: "Profile not found" }); return; }
  res.json(formatProfile(p));
});

router.delete("/layout-profiles/:id", requireAdmin, async (req, res): Promise<void> => {
  const ok = await deleteProfile(Number(req.params.id));
  if (!ok) { res.status(404).json({ error: "Profile not found" }); return; }
  res.status(204).end();
});

export default router;
