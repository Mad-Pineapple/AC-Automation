import { Router, type IRouter, type Request, type Response } from "express";
import { runDispatchTick, resetStuckBriefs } from "../lib/scheduler";

const router: IRouter = Router();

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
  const secret = process.env.CRON_SECRET;
  if (secret && req.get("authorization") !== `Bearer ${secret}`) {
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

export default router;
