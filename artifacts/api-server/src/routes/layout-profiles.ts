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
import { learnProfile, listProfiles, getProfile, deleteProfile, updateProfileRules, mergeRules, setProfileArchived, describeProfilePlainly, type StoredProfile } from "../lib/layoutProfile";
import { campaignKeyOf, ensureFeedbackTable } from "../lib/feedbackLearning";
import { db, templatesTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";

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
    rules: mergeRules(p.profile, null),
    profile: p.profile,
    updatedAt: p.updatedAt.toISOString(),
  };
}

router.put("/layout-profiles/:id/rules", requireAdmin, async (req, res): Promise<void> => {
  const saved = await updateProfileRules(Number(req.params.id), req.body?.rules ?? req.body);
  if (!saved) { res.status(404).json({ error: "Profile not found" }); return; }
  res.json(formatProfile(saved));
});

router.post("/layout-profiles/learn", requireAuth, async (req, res): Promise<void> => {
  const raw: unknown[] = Array.isArray(req.body?.masterTemplateIds) ? req.body.masterTemplateIds : [];
  const ids = raw.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);
  if (ids.length === 0) { res.status(400).json({ error: "masterTemplateIds is required" }); return; }
  const name = typeof req.body?.name === "string" ? req.body.name.slice(0, 120) : null;
  try {
    const learned = await learnProfile(ids, name, (req as any).clerkUserId ?? null);
    if (!learned) { res.status(422).json({ error: "None of those examples could be measured: each needs a recognised headline or headline layer." }); return; }
    res.status(201).json({ ...formatProfile(learned.stored), skipped: learned.skipped });
  } catch (err) {
    (req as any).log?.warn?.({ err }, "profile learn failed");
    res.status(500).json({ error: err instanceof Error ? err.message.slice(0, 200) : "Could not learn a profile" });
  }
});

/**
 * GET /layout-profiles/campaigns — the knowledge base as a designer reads it:
 * one entry per campaign, the layout in use in plain words, the masters it
 * was measured from, what designers have said, and the layouts set aside.
 */
router.get("/layout-profiles/campaigns", requireAuth, async (_req, res): Promise<void> => {
  const all = await listProfiles();
  const masterIds = [...new Set(all.flatMap((p) => p.profile.sources.map((x) => x.templateId)))];
  const alive = new Set<number>();
  if (masterIds.length) for (const r of await db.select({ id: templatesTable.id }).from(templatesTable).where(inArray(templatesTable.id, masterIds))) alive.add(r.id);
  await ensureFeedbackTable();
  const fb = (await db.execute(sql`SELECT verdict, subject_name, fault, note, element_slot, expected, subject_width, subject_height FROM feedback WHERE subject_type = 'template' ORDER BY id DESC LIMIT 1000`)).rows as any[];
  const groups = new Map<string, StoredProfile[]>();
  for (const p of all) {
    const key = campaignKeyOf(p.profile.sources[0]?.name ?? p.name);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const out = [...groups.entries()].map(([key, list]) => {
    list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const live = list.filter((p) => !p.profile.archived);
    const mine = fb.filter((r) => campaignKeyOf(r.subject_name) === key);
    const wrongs = mine.filter((r) => r.verdict === "incorrect" && (r.fault || r.note)).slice(0, 8).map((r) => ({
      part: r.element_slot ?? null,
      fault: r.fault ? String(r.fault).replace(/_/g, " ") : null,
      expected: r.expected ?? null,
      note: r.note ?? null,
      size: r.subject_width && r.subject_height ? `${r.subject_width}×${r.subject_height}` : null,
    }));
    const view = (p: StoredProfile) => ({
      id: p.id,
      name: p.name,
      archived: p.profile.archived === true,
      updatedAt: p.updatedAt.toISOString(),
      measuredAxes: p.profile.measuredAxes,
      masters: p.profile.sources.map((x) => ({ id: x.templateId, name: x.name, width: x.width, height: x.height, axis: x.axis, exists: alive.has(x.templateId) })),
      plain: describeProfilePlainly(p.profile),
      rules: mergeRules(p.profile, null),
    });
    return {
      key,
      name: key.startsWith("schema:") ? (list[0].name.replace(/\s*\(.*\)\s*$/, "").trim() || list[0].name) : list[0].name,
      layouts: list.map(view),
      // One live layout per master can be in use; more than one live layout
      // in a campaign means its imports were learned separately.
      separate: live.length > 1,
      feedback: { right: mine.filter((r) => r.verdict === "correct").length, wrong: mine.filter((r) => r.verdict === "incorrect").length, wrongs },
    };
  });
  out.sort((a, b) => (b.layouts[0]?.updatedAt ?? "").localeCompare(a.layouts[0]?.updatedAt ?? ""));
  res.json(out);
});

router.post("/layout-profiles/:id/archive", requireAdmin, async (req, res): Promise<void> => {
  const saved = await setProfileArchived(Number(req.params.id), req.body?.archived !== false);
  if (!saved) { res.status(404).json({ error: "Profile not found" }); return; }
  res.json(formatProfile(saved));
});

/**
 * POST /layout-profiles/combine { profileIds, name? } — learn ONE layout from
 * the masters of the layouts the designer picked, then set those layouts
 * aside (archived, restorable).
 *
 * Deliberately narrow. Combining every layout of a campaign pulled in old
 * test imports and another channel's artwork, and their masters took over
 * builds (caught by tools/baseline). So: only masters that still exist and
 * are ordinary imports (InDesign-bridge masters carry their own authoritative
 * geometry and stay on their own layout); one master per size and variant,
 * the newest import; and the result must add an axis — combining layouts
 * that all measure the same shape changes nothing and is refused.
 */
router.post("/layout-profiles/combine", requireAdmin, async (req, res): Promise<void> => {
  const ids = (Array.isArray(req.body?.profileIds) ? req.body.profileIds : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 20);
  if (ids.length < 2) { res.status(400).json({ error: "Tick at least two layouts to combine." }); return; }
  const chosen = (await listProfiles()).filter((p) => ids.includes(p.id));
  const wanted = [...new Set(chosen.flatMap((p) => p.profile.sources.map((x) => x.templateId)))];
  const rows = wanted.length ? await db.select().from(templatesTable).where(inArray(templatesTable.id, wanted)) : [];
  const newestPerSlot = new Map<string, number>();
  const left: string[] = [];
  for (const row of rows.sort((a, b) => a.id - b.id)) {
    let bridge = false;
    try { const cfg = JSON.parse(row.config || "{}"); bridge = cfg?.sourceMode === "indesign-bridge"; } catch { /* not a bridge master */ }
    if (bridge) { left.push(`${row.name}: an InDesign-bridge master keeps its own layout`); continue; }
    newestPerSlot.set(`${row.width}x${row.height}|${(row.name.split(" — ").pop() ?? "").toLowerCase()}`, row.id);
  }
  const masterIds = [...newestPerSlot.values()];
  const axes = new Set(chosen.flatMap((p) => p.profile.sources.filter((x) => masterIds.includes(x.templateId)).map((x) => x.axis)));
  if (masterIds.length < 2 || axes.size < 2) {
    res.status(422).json({ error: "Those layouts all measure the same shape, so combining them would change nothing. Combine a tall layout with a wide one." });
    return;
  }
  const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim().slice(0, 120) : `${chosen[0]?.name ?? "Campaign"} (tall + wide)`;
  const learned = await learnProfile(masterIds, name, (req as any).clerkUserId ?? null);
  if (!learned) { res.status(422).json({ error: "None of those masters could be measured any more — they may have been deleted from WIP." }); return; }
  // Only a layout whose masters ALL went into the new one is set aside.
  const setAside: number[] = [];
  for (const p of chosen) {
    if (p.id === learned.stored.id) continue;
    if (p.profile.sources.every((x) => masterIds.includes(x.templateId))) { await setProfileArchived(p.id, true); setAside.push(p.id); }
  }
  res.status(201).json({ ...formatProfile(learned.stored), skipped: [...learned.skipped, ...left], archived: setAside });
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
