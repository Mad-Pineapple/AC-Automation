import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { parseCollateralBrief } from "../lib/collateralBrief";
import { ObjectStorageService } from "../lib/objectStorage";

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

export default router;
