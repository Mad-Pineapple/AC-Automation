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
import brandAnalysisRouter from "./brand-analysis";
import comparisonNotesRouter from "./comparison-notes";
import reviewProgressRouter from "./review-progress";

const router: IRouter = Router();

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
router.use(storageRouter);
router.use(brandAssetsRouter);
router.use(brandAnalysisRouter);
router.use(comparisonNotesRouter);
router.use(reviewProgressRouter);
router.use(statsRouter);

export default router;
