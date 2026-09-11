import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cronRouter from "./cron";
import brandsRouter from "./brands";
import brandStylesRouter from "./brand-styles";
import briefsRouter from "./briefs";
import assetsRouter from "./assets";
import campaignsRouter from "./campaigns";
import statsRouter from "./stats";
import meRouter from "./me";
import usersRouter from "./users";
import templatesRouter from "./templates";
import storageRouter from "./storage";
import brandAssetsRouter from "./brand-assets";
import fontsRouter from "./fonts";
import brandAnalysisRouter from "./brand-analysis";
import comparisonNotesRouter from "./comparison-notes";
import assetCommentsRouter from "./asset-comments";
import shareLinksRouter from "./share-links";
import reviewProgressRouter from "./review-progress";
import creativesRouter from "./creatives";
import collateralRouter from "./collateral";
import layoutProfilesRouter from "./layout-profiles";
import guidelinesRouter from "./guidelines";
import exportsRouter from "./exports";
import campaignIdeasRouter from "./campaign-ideas";
import attentionRouter from "./attention";
import feedbackRouter from "./feedback";
import performanceMetaRouter from "./performance-meta";

import { requireAuth } from "../middlewares/requireAuth";
import { clerkConfigured, devAuthBypass } from "../lib/authConfig";

const router: IRouter = Router();

// The studio is an internal tool: every /api route needs a session except the
// few that are meant to be public. Without Clerk the app stays read-only as
// before (local/preview), and the dev bypass signs everything in.
const PUBLIC_PATHS: RegExp[] = [
  /^\/healthz/, /^\/share\//, /^\/fonts\.css$/, /^\/cron\//, /^\/storage\/objects\//, /^\/storage\/public-objects\//, /^\/me$/,
];
router.use((req, res, next) => {
  if (!clerkConfigured || devAuthBypass) return next();
  if (PUBLIC_PATHS.some((re) => re.test(req.path))) return next();
  return requireAuth(req, res, next);
});

router.use(healthRouter);
router.use(cronRouter);
router.use(meRouter);
router.use(usersRouter);
router.use(brandsRouter);
router.use(brandStylesRouter);
router.use(briefsRouter);
router.use(assetsRouter);
router.use(campaignsRouter);
router.use(templatesRouter);
router.use(exportsRouter);
router.use(storageRouter);
router.use(brandAssetsRouter);
router.use(fontsRouter);
router.use(brandAnalysisRouter);
router.use(campaignIdeasRouter);
router.use(attentionRouter);
router.use(feedbackRouter);
router.use(performanceMetaRouter);
router.use(comparisonNotesRouter);
router.use(assetCommentsRouter);
router.use(shareLinksRouter);
router.use(reviewProgressRouter);
router.use(creativesRouter);
router.use(collateralRouter);
router.use(layoutProfilesRouter);
router.use(guidelinesRouter);
router.use(statsRouter);

export default router;
