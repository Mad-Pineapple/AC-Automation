import { Router, type IRouter } from "express";
import { optionalAuth, requireAdmin } from "../middlewares/requireAuth";
import { getMetaSummary, runMetaSync } from "../lib/metaInsights";

const router: IRouter = Router();

/** GET /performance/meta?days=30 — Meta Ads results joined to studio creative. */
router.get("/performance/meta", optionalAuth, async (req, res): Promise<void> => {
  const days = Number(req.query.days ?? 30);
  res.json(await getMetaSummary(Number.isFinite(days) ? days : 30));
});

/** POST /performance/meta/sync — pull the latest insights now (admin). */
router.post("/performance/meta/sync", requireAdmin, async (req, res): Promise<void> => {
  const days = Number(req.body?.days ?? 30);
  const result = await runMetaSync(Number.isFinite(days) ? days : 30);
  res.status(result.ok ? 200 : 502).json(result);
});

export default router;
