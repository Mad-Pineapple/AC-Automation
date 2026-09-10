import { Router, type IRouter, type Request, type Response } from "express";
import { runDispatchTick, resetStuckBriefs } from "../lib/scheduler";
import { runFrontifySync } from "../lib/frontifySync";
import { runMetaSync } from "../lib/metaInsights";

const router: IRouter = Router();

/** Cron routes are open unless CRON_SECRET is set (Vercel Cron sends it as a bearer token). */
function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed on Vercel: an unset secret must not open the cron routes.
  if (!secret) return !process.env.VERCEL;
  return req.get("authorization") === `Bearer ${secret}`;
}

// A brief still "generating" after this long is abandoned (serverless
// functions cap out at minutes, the node server resets on restart).
const STUCK_BRIEF_MIN_AGE_MS = 15 * 60_000;

/**
 * GET /cron/dispatch
 *
 * Serverless replacement for the in-process scheduler: dispatches due
 * scheduled briefs and unsticks abandoned generations. Wired to Vercel Cron
 * in vercel.json; Vercel sends `Authorization: Bearer $CRON_SECRET` when that
 * env var is set, and this route requires it then. Harmless if triggered by
 * anything else: it only performs work that is already due.
 */
router.get("/cron/dispatch", async (req: Request, res: Response) => {
  if (!cronAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const stuckReset = await resetStuckBriefs(STUCK_BRIEF_MIN_AGE_MS);
    const dispatched = await runDispatchTick();
    res.json({ ok: true, dispatched, stuckReset });
  } catch (error) {
    req.log.error({ err: error }, "Cron dispatch failed");
    res.status(500).json({ error: "Cron dispatch failed" });
  }
});

/**
 * GET /cron/frontify-sync
 *
 * Pull new assets from the public Frontify brand portal into the library
 * (idempotent, capped per run — see lib/frontifySync.ts). Scheduled daily in
 * vercel.json; safe to trigger manually.
 */
router.get("/cron/frontify-sync", async (req: Request, res: Response) => {
  if (!cronAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const result = await runFrontifySync();
    res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    req.log.error({ err: error }, "Frontify sync failed");
    res.status(500).json({ error: "Frontify sync failed" });
  }
});

/**
 * GET /cron/meta-sync
 *
 * Pull the last 30 days of Meta Ads insights into meta_ad_insights so the
 * Performance page reflects yesterday's numbers. No-op (200, configured:false)
 * until META_ACCESS_TOKEN + META_AD_ACCOUNT_ID are set. Scheduled daily in
 * vercel.json; safe to trigger manually.
 */
router.get("/cron/meta-sync", async (req: Request, res: Response) => {
  if (!cronAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const result = await runMetaSync(30);
    res.status(result.ok ? 200 : 502).json(result);
  } catch (error) {
    req.log.error({ err: error }, "Meta sync failed");
    res.status(500).json({ error: "Meta sync failed" });
  }
});

export default router;
