import { Router } from "express";
import { db } from "@workspace/db";
import { templatesTable, assetsTable, brandsTable, brandAssetsTable } from "@workspace/db";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { optionalAuth, requireAdmin, requireAuth } from "../middlewares/requireAuth";
import { normalizeFreeformConfig, adaptFreeformConfig, isFreeformConfig, type FreeformConfig, type FreeformElement } from "../lib/freeform";
import { recomposePanelLayout } from "../lib/panelRecompose";
import { collectBrandPaletteHexes } from "../lib/colorAdapter";
import { composeKeyVisualAdaptation, findKvBackground } from "../lib/kvAdapt";
import { recomposeToFormat, shouldRecompose } from "../lib/recompose";
import { checkLayout, checkMandatory } from "../lib/layoutCheck";
import { scoreGeometry, scoreContrast, contrastBaseline, type PrincipleScores } from "../lib/principles";
import { ensureSubjects, detectSubject } from "../lib/subjectDetect";
import type { ImageLoader } from "../lib/renderFreeform";
import { isImageOnly, hasLayeredSlots, hasPanelParts, splitPanelGraphic, enrichLayeredArtwork, adaptLayered, edgeColour, storageImageLoader } from "../lib/layeredArtwork";
import { analyseGwdHtml, motionForElements, type GwdLeaf } from "../lib/gwdMotion";
import { resolveStyleSchema, learnProfile, getProfile } from "../lib/layoutProfile";
import type { LayoutProfile } from "../lib/layoutProfile";
import { adaptGeometryProfile } from "../lib/geometryAdapt";
import { guidelinesForConfig, guidelineNotes, topicsPerElement } from "../lib/guidelines";
import type { StyleSchema } from "../lib/styleSpecs/getReadyBurst2";
import { visibleBounds } from "../lib/gwdImport";

/**
 * Artwork imported from an HTML example before motion capture existed has
 * its runnable original on file. Read the choreography out of it once and
 * write the tracks onto the layers, so every size built from the master
 * carries the key visual's motion.
 */
async function backfillKeyVisualMotion(config: FreeformConfig): Promise<FreeformConfig | null> {
  if (!config.previewHtml || config.elements.some((e) => e.type === "image" && e.motion)) return null;
  const bytes = await storageImageLoader()(config.previewHtml);
  if (!bytes) return null;
  const analysis = analyseGwdHtml(bytes.toString("utf8"));
  if (!analysis || analysis.dur <= 0) return null;
  // The importer stored each layer trimmed to its visible pixels; trim the
  // original layers the same way so they match the elements exactly.
  const load = storageImageLoader();
  const trimmed = new Map<GwdLeaf, { x: number; y: number; w: number; h: number }>();
  for (const leaf of analysis.leaves) {
    if (leaf.opacity < 0.1) continue;
    try {
      const img = await load(leaf.relSrc);
      const vb = img ? await visibleBounds(img) : null;
      if (vb) {
        const dx = leaf.w / vb.W, dy = leaf.h / vb.H;
        trimmed.set(leaf, { x: leaf.x + vb.minX * dx, y: leaf.y + vb.minY * dy, w: vb.bw * dx, h: vb.bh * dy });
      }
    } catch { /* untrimmed box stands */ }
  }
  const images = config.elements.filter((e): e is Extract<FreeformElement, { type: "image" }> => e.type === "image");
  const { elements: withMotion, assigned } = motionForElements(images, analysis, trimmed);
  if (assigned === 0) return null;
  const byId = new Map(withMotion.map((e) => [e.id, e]));
  return { ...config, elements: config.elements.map((e) => byId.get(e.id) ?? e) };
}
import { styleSchemaFor, describeStyleSchema } from "../lib/styleSpecs/getReadyBurst2";
import { ObjectStorageService as LayerStorage } from "../lib/objectStorage";
import { makeImageLoader } from "./exports";
import { classifyAspect } from "../lib/formatCatalog";
import type { ClaudeReview, FixResult } from "../lib/claudeReview";
import { isArtworkGuardConfigured, runArtworkGuard, type ArtworkGuardProvider } from "../lib/artworkGuard";
import { ensureBrandFontsRegistered } from "../lib/brandFonts";
import { describeFormat, aspectDistance, type FormatHints } from "../lib/formatCatalog";
import { isFlatArtwork } from "../lib/slots";
import { FLAT_SCALE_TOLERANCE } from "../lib/campaignPlan";
import { feedbackForFormat, describeFormatFeedback } from "../lib/feedbackLearning";
import { approvedExemplars, studioExemplars, chooseReference, measureRecipe, type Exemplar, type Reference } from "../lib/exemplars";
import { dissectPdfToTemplate } from "../lib/pdfDissect";
import { dissectImageToTemplate } from "../lib/imageDissect";
import { importExample, exampleKindFor } from "../lib/exampleImport";

const router = Router();

const DEFAULT_CONFIG = {
  contentAlignment: "center",
  textAlign: "left",
  showAccentBar: true,
  showLogoBar: true,
  imageStyle: "side",
};

function validatePayload(body: any, partial: boolean): string | null {
  const required = !partial;
  if ((required || body.name !== undefined) && (typeof body.name !== "string" || !body.name.trim())) {
    return "name is required";
  }
  for (const dim of ["width", "height"] as const) {
    if (required || body[dim] !== undefined) {
      const n = Number(body[dim]);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 16 || n > 8000) {
        return `${dim} must be an integer between 16 and 8000`;
      }
    }
  }
  return null;
}

function parseConfig(raw: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (parsed && parsed.kind === "freeform") {
      const normalized = normalizeFreeformConfig(parsed) as unknown as Record<string, unknown>;
      // Studio annotations ride alongside the layout: Claude's last check and
      // the WIP piece a Knowledge copy was remembered from.
      if (parsed.claudeReview && typeof parsed.claudeReview === "object") normalized.claudeReview = parsed.claudeReview;
      if (Number.isInteger(parsed.learnedFromTemplateId)) normalized.learnedFromTemplateId = parsed.learnedFromTemplateId;
      if (parsed.claudeFixes && typeof parsed.claudeFixes === "object") {
        const { before, ...summary } = parsed.claudeFixes as Record<string, unknown>;
        normalized.claudeFixes = { ...summary, canUndo: Array.isArray(before) };
      }
      return normalized;
    }
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function formatTemplate(t: typeof templatesTable.$inferSelect) {
  return {
    id: t.id,
    key: `tpl_${t.id}`,
    name: t.name,
    description: t.description,
    category: t.category,
    width: t.width,
    height: t.height,
    dims: `${t.width}\u00d7${t.height}`,
    config: parseConfig(t.config),
    sourceImageUrl: t.sourceImageUrl,
    sourceTemplateId: t.sourceTemplateId ?? null,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

router.get("/templates", optionalAuth, async (req, res): Promise<void> => {
  // Newest first: freshly imported or generated artwork lands at the top of every list.
  // Knowledge (learned creatives, 1,000+ rows with full layouts) is only sent
  // when a page asks for it — most screens never need it.
  const include = String(req.query.include ?? "");
  const withKnowledge = include === "knowledge" || include === "all";
  const templates = await db
    .select()
    .from(templatesTable)
    .where(withKnowledge ? undefined : sql`${templatesTable.category} <> 'knowledge'`)
    .orderBy(desc(templatesTable.id));
  res.json(templates.map(formatTemplate));
});

router.post("/templates", requireAdmin, async (req, res): Promise<void> => {
  const body = req.body;
  const error = validatePayload(body, false);
  if (error) { res.status(400).json({ error }); return; }
  const config =
    body.config?.kind === "freeform"
      ? normalizeFreeformConfig(body.config)
      : { ...DEFAULT_CONFIG, ...(body.config ?? {}) };
  const [template] = await db
    .insert(templatesTable)
    .values({
      name: body.name,
      description: body.description ?? null,
      category: body.category ?? "custom",
      width: Number(body.width),
      height: Number(body.height),
      config: JSON.stringify(config),
      sourceImageUrl: typeof body.sourceImageUrl === "string" ? body.sourceImageUrl : null,
      createdBy: (req as any).clerkUserId ?? null,
    })
    .returning();
  res.status(201).json(formatTemplate(template));
});

/**
 * POST /templates/:id/adapt  { targets: [{ width, height, name? }, …] }
 *
 * Master-template adaptation: derive new freeform templates for other
 * formats from one designed master. Each adaptation is a normal template
 * the designer can fine-tune afterwards. Engine order:
 *
 *   1. recompose (lib/recompose.ts) — a target of a different shape class
 *      (tower, portrait, wide, strip, or far in aspect) is REBUILT from the
 *      master's slots with the class recipe, the way shipped AC creative is.
 *   2. key-visual adapt (lib/kvAdapt.ts) — same-shape targets of a full-bleed
 *      key visual: re-crop the artwork, re-set the copy on the brand grid.
 *   3. panel recompose / geometric scale — the remaining same-shape cases.
 *
 * Every result is layout-checked; the method and notes ride in the config
 * (adaptMethod / adaptNotes) and the master link in sourceTemplateId.
 */
type BrandInfo = { logoUrl: string | null; strapline: string | null; panelFill?: string | null };

/**
 * Produce one size from a master with the engine order the adapt route
 * documents (recompose → key-visual → panel → scale), layout-checked, with
 * designer feedback for the shape attached. Shared by adapt and redo.
 */
/** For layered masters, the panel ground colour sampled from the baked panel graphic's edge. */
async function layeredPanelFill(config: FreeformConfig, req: any): Promise<string | null> {
  if (!hasLayeredSlots(config)) return null;
  const panelImg = config.elements.find((e) => e.type === "image" && e.slot === "panel");
  if (!panelImg || panelImg.type !== "image" || !panelImg.src) return null;
  try {
    const bytes = await makeImageLoader(req)(panelImg.src);
    return bytes ? await edgeColour(bytes) : null;
  } catch {
    return null;
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

async function adaptOne(
  master: { id: number; width: number; height: number; name: string },
  masterConfig: FreeformConfig,
  width: number,
  height: number,
  brandInfo: BrandInfo,
  log?: { warn: (obj: unknown, msg: string) => void },
  exemplars: Exemplar[] = [],
  excludeId?: number,
  hints: FormatHints = {},
  styleOverride?: { schema: StyleSchema | null; label: string; profile?: LayoutProfile } | null,
  render?: { loadImage: ImageLoader; brandFontFamily?: string } | null,
): Promise<{ config: FreeformConfig; method: string; spec: ReturnType<typeof describeFormat>; reference: Reference | null; rejected: string[] }> {
  let adapted: FreeformConfig | null = null;
  let method = "scaled";
  const notes: string[] = [];
  // The brief's format name and channel decide the class (a leaderboard is a
  // strip whatever its ratio; a 3:1 billboard is wide, never a strip).
  const spec = describeFormat(width, height, hints.name ?? null, hints.channel ?? null);
  // 0. An approved piece in the family is the reference: scale it when the
  //    shape is near-identical, otherwise rebuild with its measured
  //    proportions overriding the class recipe.
  const reference = chooseReference(exemplars, width, height, excludeId);
  // Scaling an approved sibling only holds within a sane size range: a
  // 1080 square scaled to 100px keeps no floor at all (7px pill), so far
  // outside 0.5×–2× the sibling leads through its measured proportions
  // (the rebuild path below) instead of a straight scale.
  const sizeRatio = reference ? Math.min(width, height) / Math.max(1, Math.min(reference.exemplar.width, reference.exemplar.height)) : 1;
  const scaleOk = sizeRatio >= 0.5 && sizeRatio <= 2;
  if (reference?.scaleFromExemplar && !scaleOk) notes.push(`The approved "${reference.exemplar.name}" is the reference, but this size is ${sizeRatio < 1 ? "much smaller" : "much larger"}, so it was rebuilt to its proportions rather than scaled.`);
  if (reference?.scaleFromExemplar && scaleOk) {
    adapted = adaptFreeformConfig(reference.exemplar.config, reference.exemplar.width, reference.exemplar.height, width, height);
    method = "scaled:approved";
    notes.push(reference.note);
  }
  // 0.25. A portrait + landscape free-form pair is the strongest evidence
  //       available. Interpolate its measured semantic layer boxes before
  //       considering generic panel or key-visual recipes.
  if (!adapted && styleOverride?.profile) {
    const geometric = adaptGeometryProfile(masterConfig, master.width, master.height, width, height, styleOverride.profile);
    if (geometric) {
      adapted = geometric.config;
      method = "geometry-profile";
      notes.push(...geometric.notes);
    }
  }
  // 0.5. Layered image artwork (HTML5 exports): the headline and CTA are
  //      pictures, so place the recognised layers with the class recipe.
  const hasTextHeadline = masterConfig.elements.some((e) => e.type === "text" && e.text.trim().length > 0);
  const styleSpec = styleOverride ? styleOverride.schema : styleSchemaFor(master.name);
  if (styleOverride?.schema) notes.push(`Layout numbers from ${styleOverride.label}.`);
  if (!adapted && !hasTextHeadline && hasLayeredSlots(masterConfig)) {
    const ly = adaptLayered(masterConfig, master.width, master.height, width, height, { panelFill: brandInfo.panelFill ?? null, logoUrl: brandInfo.logoUrl, spec: styleSpec, formatClass: spec.formatClass });
    if (ly) {
      adapted = ly.config;
      method = "layered";
      notes.push(...ly.notes);
    }
  }
  // A photo-led master (full-bleed photograph, no solid panel) keeps that
  // design on every shape: the photo stays full-bleed and the copy, CTA and
  // tile are re-set on it. The panel recipes would invent a half-canvas
  // colour block the master never had.
  const photoLed = !adapted && !!findKvBackground(masterConfig, master.width, master.height) && !masterConfig.elements.some((e) => e.slot === "panel" || e.slot === "band");
  if (photoLed) {
    const composed = await composeKeyVisualAdaptation(masterConfig, master.width, master.height, width, height, brandInfo);
    if (composed) {
      adapted = composed;
      method = "key-visual";
      notes.push("Photo-led master: the photograph stays full-bleed and the copy, call-to-action and tile are re-set on it.");
    }
  }
  // 1. Different shape class: rebuild from slots with the class recipe.
  if (!adapted && shouldRecompose(masterConfig, master.width, master.height, width, height)) {
    try {
      const specZone = styleSpec?.zones[spec.formatClass];
      const rc = await recomposeToFormat(masterConfig, master.width, master.height, width, height, {
        brand: brandInfo,
        formatClass: spec.formatClass,
        // An approved piece's measurements lead; else the campaign schema's zones; else the class recipe.
        ...(reference
          ? { recipeOverrides: reference.exemplar.measured }
          : specZone
            ? { recipeOverrides: { photoFrac: specZone.photoFrac, bandFrac: specZone.bandFrac, bandAt: specZone.bandAt } }
            : {}),
      });
      if (rc && !reference && specZone) notes.push(`Zones from the ${styleSpec!.name} schema.`);
      if (rc && reference) notes.push(reference.note);
      if (rc) {
        adapted = rc.config;
        method = `recomposed:${rc.formatClass}`;
      }
    } catch (err) {
      log?.warn({ err, templateId: master.id, width, height }, "recompose failed; falling back");
      notes.push("Recomposer could not run for this size; the layout was scaled instead.");
    }
  }
  // 2. Key-visual masters get the designer's adapt: artwork re-cropped to
  //    its focal point, copy/strapline/logo RE-SET on the brand grid.
  if (!adapted) {
    const composed = await composeKeyVisualAdaptation(masterConfig, master.width, master.height, width, height, brandInfo);
    if (composed) {
      adapted = composed;
      method = "key-visual";
    }
  }
  // 3. Panel masters far in aspect: rebuild the panel structure. Else scale.
  if (!adapted) {
    const ratioDist = Math.abs(Math.log(width / height / (master.width / master.height)));
    const fallback = ratioDist > 0.3 ? recomposePanelLayout(masterConfig, master.width, master.height, width, height) : null;
    if (fallback) {
      adapted = fallback;
      method = "panel";
    } else {
      adapted = adaptFreeformConfig(masterConfig, master.width, master.height, width, height);
      method = "scaled";
    }
  }
  const issues = checkLayout(adapted, width, height);
  // The hard gate: an automated layout that lost a mandatory element,
  // undersized the logo or let copy collide is rejected, not merely noted.
  const rejected = checkMandatory(masterConfig, { ...adapted, adaptNotes: [...(adapted.adaptNotes ?? []), ...notes] }, width, height, (styleSpec?.partRules ?? {}) as Record<string, { minPx?: number; neverOverlap?: string[]; dropWhenTight?: boolean }>);
  // Design principles: alignment, margins and balance from the geometry;
  // contrast behind copy from the rendered piece. Low contrast on the
  // headline or message is a rejection; the rest are checks.
  const geo = scoreGeometry(masterConfig, master.width, master.height, adapted, width, height);
  issues.push(...geo.issues);
  let principles: PrincipleScores = { ...geo.scores, contrast: null };
  if (render) {
    try {
      const baseline = await contrastBaseline(`${master.id}:${masterConfig.elements.length}`, masterConfig, master.width, master.height, render.loadImage, render.brandFontFamily);
      const c = await scoreContrast(adapted, width, height, render.loadImage, render.brandFontFamily, baseline);
      principles = { ...principles, contrast: c.contrast, ...(c.detail && c.detail.length ? { contrastDetail: c.detail.slice(0, 8) } : {}) };
      issues.push(...c.issues);
      rejected.push(...c.rejections);
    } catch (err) {
      log?.warn({ err }, "contrast check failed");
    }
  }
  notes.push(`Principles: alignment ${pct(principles.alignment)}, margins ${pct(principles.margins)}, balance ${pct(principles.balance)}${principles.contrast != null ? `, contrast ${principles.contrast.toFixed(1)}:1` : ""}.`);
  // What designers have said about pieces of this shape so far rides on
  // every new one, so the lesson is in front of whoever reviews it.
  let feedbackLine: string | null = null;
  try {
    feedbackLine = describeFormatFeedback(await feedbackForFormat(spec.formatClass));
  } catch {
    feedbackLine = null;
  }
  const config = normalizeFreeformConfig({
    ...adapted,
    adaptMethod: adapted.adaptMethod ?? method,
    adaptNotes: [
      ...rejected.map((r) => `Rejected: ${r}`),
      ...(adapted.adaptNotes ?? []),
      ...notes,
      ...issues.map((i) => `${i.severity === "error" ? "Check" : "Note"}: ${i.message}`),
      ...(feedbackLine ? [feedbackLine] : []),
    ],
    ...(rejected.length > 0 ? { rejected } : {}),
    principles,
  });
  return { config, method, spec, reference, rejected };
}

/**
 * POST /templates/:id/detect-subject — find (or re-find) the subject of the
 * master's photographs with Claude vision and store the box on the master.
 * A designer-set box is kept unless { force: true }.
 */
router.post("/templates/:id/detect-subject", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [t] = await db.select().from(templatesTable).where(eq(templatesTable.id, id));
  if (!t) { res.status(404).json({ error: "Template not found" }); return; }
  let parsed: unknown;
  try { parsed = JSON.parse(t.config || "{}"); } catch { parsed = {}; }
  if (!isFreeformConfig(parsed)) { res.status(400).json({ error: "Only freeform templates carry photographs" }); return; }
  const cfg = normalizeFreeformConfig(parsed);
  const force = req.body?.force === true;
  const loadImage = makeImageLoader(req);
  const results: Array<{ elementId: string; subject: string; box: { x: number; y: number; w: number; h: number }; keepWhole: boolean; faces: number }> = [];
  const elements = [...cfg.elements];
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i];
    if (e.type !== "image" || !e.src || e.panelPart || !(e.slot === "photo" || (!e.slot && e.role === "product"))) continue;
    if (e.focusSource === "designer" && !force) continue;
    const bytes = await loadImage(e.src);
    if (!bytes) continue;
    const found = await detectSubject(bytes);
    if (!found) continue;
    elements[i] = { ...e, focusBox: found.box, focusX: Math.round((found.box.x + found.box.w / 2) * 1000) / 1000, focusY: Math.round((found.box.y + found.box.h / 2) * 1000) / 1000, focusSource: "vision", subject: found.subject, ...(found.keepWhole ? { keepWhole: true } : {}) };
    results.push({ elementId: e.id, ...found });
  }
  if (results.length) {
    await db.update(templatesTable).set({ config: JSON.stringify({ ...(parsed as Record<string, unknown>), elements }), updatedAt: new Date() }).where(eq(templatesTable.id, id));
  }
  res.json({ templateId: id, detected: results });
});

router.post("/templates/:id/adapt", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [master] = await db.select().from(templatesTable).where(eq(templatesTable.id, id));
  if (!master) { res.status(404).json({ error: "Template not found" }); return; }

  let parsed: unknown;
  try {
    parsed = JSON.parse(master.config || "{}");
  } catch {
    parsed = {};
  }
  if (!isFreeformConfig(parsed)) {
    res.status(400).json({ error: "Only freeform templates can be adapted" });
    return;
  }
  let masterConfig = normalizeFreeformConfig(parsed);
  // Keep an untouched snapshot for exact-size duplication. Generating the
  // master's own dimensions is a copy operation, not an adaptation: no slot
  // inference, panel splitting, subject detection, AI fixing or layout rules
  // may alter it.
  const exactCloneConfig = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
  // The production glossary offers ~50 formats — allow adapting to all of them in one go.
  const rawTargets: unknown[] = Array.isArray(req.body?.targets) ? req.body.targets.slice(0, 60) : [];

  // Masters imported from an HTML example before motion capture: lift the
  // choreography from the stored original so the pieces built now carry it.
  try {
    const withMotion = await backfillKeyVisualMotion(masterConfig);
    if (withMotion) {
      masterConfig = normalizeFreeformConfig({ ...(parsed as Record<string, unknown>), elements: withMotion.elements });
      parsed = { ...(parsed as Record<string, unknown>), elements: masterConfig.elements };
      await db.update(templatesTable)
        .set({ config: JSON.stringify(parsed), updatedAt: new Date() })
        .where(eq(templatesTable.id, master.id));
      (req as any).log?.info?.({ templateId: master.id }, "key-visual motion captured from the stored original");
    }
  } catch (err) {
    (req as any).log?.warn?.({ err, templateId: master.id }, "key-visual motion backfill failed; continuing");
  }

  // A master whose baked panel has not been cut into parts yet gets that
  // done now (masters imported before the panel split existed).
  if (hasLayeredSlots(masterConfig) && !hasPanelParts(masterConfig) && masterConfig.elements.some((e) => e.type === "image" && e.slot === "panel")) {
    try {
      const storage = new LayerStorage();
      const split = await splitPanelGraphic(masterConfig, { loadImage: makeImageLoader(req), uploadBytes: (bytes, ct) => storage.uploadBytes(bytes, ct) });
      if (hasPanelParts(split.config)) {
        masterConfig = normalizeFreeformConfig({ ...(parsed as Record<string, unknown>), elements: split.config.elements });
        parsed = { ...(parsed as Record<string, unknown>), elements: masterConfig.elements };
        await db.update(templatesTable).set({ config: JSON.stringify(parsed), updatedAt: new Date() }).where(eq(templatesTable.id, master.id));
        (req as any).log?.info?.({ templateId: master.id, notes: split.notes }, "panel graphic cut into parts");
      }
    } catch (err) {
      (req as any).log?.warn?.({ err, templateId: master.id }, "panel split failed; continuing");
    }
  }

  // An image-only stack (HTML5 export) gets its layers recognised once —
  // headline glyphs merged, slots assigned — and the master is updated so the
  // recognition sticks for every later build.
  if (isImageOnly(masterConfig) && !hasLayeredSlots(masterConfig)) {
    try {
      const storage = new LayerStorage();
      const enriched = await enrichLayeredArtwork(masterConfig, master.width, master.height, {
        loadImage: makeImageLoader(req),
        uploadBytes: (bytes, ct) => storage.uploadBytes(bytes, ct),
      });
      if (enriched.changed) {
        masterConfig = normalizeFreeformConfig({ ...(parsed as Record<string, unknown>), elements: enriched.config.elements });
        await db.update(templatesTable)
          .set({ config: JSON.stringify({ ...(parsed as Record<string, unknown>), elements: enriched.config.elements }), updatedAt: new Date() })
          .where(eq(templatesTable.id, master.id));
        (req as any).log?.info?.({ templateId: master.id, notes: enriched.notes }, "layered artwork recognised");
      }
    } catch (err) {
      (req as any).log?.warn?.({ err, templateId: master.id }, "layered artwork recognition failed; continuing");
    }
  }

  // A photograph with no cut-out gets its subject found once (Claude
  // vision) and the box stored on the master, so every size keeps it.
  const subjectNotes: string[] = [];
  try {
    const found = await ensureSubjects(masterConfig, makeImageLoader(req));
    if (found) {
      masterConfig = normalizeFreeformConfig({ ...(parsed as Record<string, unknown>), elements: found.config.elements });
      parsed = { ...(parsed as Record<string, unknown>), elements: masterConfig.elements };
      await db.update(templatesTable).set({ config: JSON.stringify(parsed), updatedAt: new Date() }).where(eq(templatesTable.id, master.id));
      subjectNotes.push(...found.notes);
      (req as any).log?.info?.({ templateId: master.id, notes: found.notes }, "subject detected on the master's photo");
    }
  } catch (err) {
    (req as any).log?.warn?.({ err, templateId: master.id }, "subject detection failed; continuing");
  }

  // Key-visual masters get the designer's adapt: artwork re-cropped to its
  // focal point, copy/strapline/logo RE-SET on each format's brand grid.
  const [brand] = await db.select().from(brandsTable).orderBy(brandsTable.id).limit(1);
  const brandInfo: BrandInfo = { logoUrl: brand?.logoUrl ?? null, strapline: brand?.strapline ?? null, panelFill: brand?.primaryColor ?? null };
  // Layered masters: the panel ground takes its colour from the baked panel
  // graphic's own edge, so the graphic sits on it seamlessly.
  brandInfo.panelFill = (await layeredPanelFill(masterConfig, req)) ?? brandInfo.panelFill;
  // Package fonts (DS-Digital etc.) must be registered so copy is measured
  // with the designer's face, not a substitute.
  await ensureBrandFontsRegistered();
  // Pieces the designers have already marked Right in this family lead.
  const exemplars = await approvedExemplars(master.id);
  // Flat artwork (copy baked in) can only be scaled to a near-identical
  // shape. Refuse the whole call up front rather than produce re-crops the
  // studio has rejected — nothing is created, the message says what to do.
  if (isFlatArtwork(masterConfig)) {
    const blocked = rawTargets
      .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
      .map((t) => ({ width: Number(t.width), height: Number(t.height) }))
      .filter((t) => Number.isFinite(t.width) && Number.isFinite(t.height))
      .filter((t) => aspectDistance(master.width, master.height, t.width, t.height) > FLAT_SCALE_TOLERANCE);
    if (blocked.length > 0) {
      const blockedKeys = new Set(blocked.map((b) => `${b.width}x${b.height}`));
      const allowed = rawTargets.filter((t) => {
        const o = t as Record<string, unknown>;
        return !blockedKeys.has(`${Number(o.width)}x${Number(o.height)}`);
      });
      const msg =
        `"${master.name}" is flat artwork with the copy baked into the image, so it can only be scaled to sizes of the same shape. ` +
        `${blocked.length} of the requested sizes (${blocked.slice(0, 4).map((b) => `${b.width}×${b.height}`).join(", ")}${blocked.length > 4 ? ", …" : ""}) are a different shape. ` +
        "Import the InDesign package or working files with live text to build those.";
      if (allowed.length === 0) {
        res.status(422).json({ error: msg });
        return;
      }
      // Build what can be built; say what was skipped on each created piece.
      rawTargets.length = 0;
      rawTargets.push(...allowed);
      (req as any).log?.info?.({ templateId: master.id, skipped: blocked.length }, "adapt: flat master, different-shape sizes skipped");
      res.setHeader("X-Adapt-Skipped", String(blocked.length));
    }
  }
  const created: (typeof templatesTable.$inferSelect)[] = [];
  let rejectedCount = 0;
  // Layout numbers: an explicit measured profile, else the newest profile
  // this master was measured into, else the hand-written schema by name.
  const profileId = Number.isInteger(Number(req.body?.profileId)) && Number(req.body?.profileId) > 0 ? Number(req.body.profileId) : null;
  const guardEnabled = req.body?.aiGuard === true;
  const requestedGuardProvider: ArtworkGuardProvider = req.body?.aiGuardProvider === "claude" || req.body?.aiGuardProvider === "openai" ? req.body.aiGuardProvider : "auto";
  const resolvedStyle = await resolveStyleSchema({ masterId: master.id, masterName: master.name, sourceTemplateId: master.sourceTemplateId ?? null, profileId });
  if (resolvedStyle.source === "profile") res.setHeader("X-Layout-Profile", String(resolvedStyle.profileId));
  for (const raw of rawTargets) {
    if (typeof raw !== "object" || raw === null) continue;
    const t = raw as Record<string, unknown>;
    const width = Number(t.width);
    const height = Number(t.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 8000 || height > 8000) {
      continue;
    }
    const requestedName =
      typeof t.name === "string" && t.name.trim()
        ? t.name.trim().slice(0, 120)
        : `${master.name} ${width}×${height}`;

    // Same dimensions must reproduce the imported master exactly. In
    // particular, do not send it through adaptOne or Artwork Guard, both of
    // which are allowed to move or resize elements for a genuinely new size.
    if (width === master.width && height === master.height) {
      const [template] = await db
        .insert(templatesTable)
        .values({
          name: requestedName,
          description: `Exact-size duplicate of "${master.name}" (${master.width}×${master.height})`,
          category: "wip",
          width,
          height,
          config: JSON.stringify(exactCloneConfig),
          sourceTemplateId: master.id,
          createdBy: (req as any).clerkUserId ?? null,
        })
        .returning();
      created.push(template);
      continue;
    }
    // A photo reproduced from the document PDF carries the original copy
    // baked into its pixels. Re-setting the headline elsewhere would draw it
    // over a ghost of itself — refuse rather than ship a wrong size.
    const baked = masterConfig.elements.find((e) => e.type === "image" && (e as { bakedCopy?: boolean }).bakedCopy);
    if (baked) {
      res.status(422).json({
        error:
          "This master's photo was reproduced from the document PDF (its Links file was missing or too large) and carries the original copy baked in. Re-import the package with a flattened JPEG/PNG for that photo before building sizes.",
      });
      return;
    }
    const hints: FormatHints = {
      name: typeof t.formatName === "string" ? t.formatName : typeof t.name === "string" ? t.name : null,
      channel: typeof t.channel === "string" ? t.channel : null,
    };
    const { config: adaptedConfig, method, spec, rejected } = await adaptOne(master, masterConfig, width, height, brandInfo, (req as any).log, exemplars, undefined, hints, resolvedStyle.source === "none" ? null : { schema: resolvedStyle.schema, label: resolvedStyle.label, profile: resolvedStyle.profile }, { loadImage: makeImageLoader(req), brandFontFamily: brand?.fontFamily ?? "National 2" });
    // Guideline reminders for what is on the piece (logo tile, band, photo…).
    let merged = subjectNotes.length ? normalizeFreeformConfig({ ...adaptedConfig, adaptNotes: [...(adaptedConfig.adaptNotes ?? []), ...subjectNotes] }) : adaptedConfig;
    let elementGuidelines: Awaited<ReturnType<typeof guidelinesForConfig>> = [];
    try {
      elementGuidelines = await guidelinesForConfig(brand?.id ?? null, adaptedConfig, width, height, 3);
      const gl = elementGuidelines;
      const lines = guidelineNotes(gl);
      if (lines.length) merged = normalizeFreeformConfig({ ...adaptedConfig, adaptNotes: [...(adaptedConfig.adaptNotes ?? []), ...lines] });
    } catch { /* notes are a bonus */ }
    const name =
      typeof t.name === "string" && t.name.trim()
        ? requestedName
        : `${master.name} ${spec.entry ? `${spec.label} ` : ""}${width}×${height}`;
    let guardReview: ClaudeReview | null = null;
    let guardFixes: { at: string; rounds: number; applied: unknown[]; before: FreeformConfig["elements"] } | null = null;
    let finalRejected = [...rejected];
    if (guardEnabled) {
      if (!isArtworkGuardConfigured(requestedGuardProvider)) {
        finalRejected.push("AI Artwork Guard could not run because the selected provider is not configured.");
        merged = normalizeFreeformConfig({ ...merged, adaptNotes: [...(merged.adaptNotes ?? []), "Check: AI Artwork Guard is not configured. Verify OPENAI_API_KEY or ANTHROPIC_API_KEY in Vercel."] });
      } else {
        try {
          const masterReference: Exemplar = {
            id: master.id, name: master.name, width: master.width, height: master.height,
            formatClass: classifyAspect(master.width, master.height), config: masterConfig,
            measured: measureRecipe(masterConfig, master.width, master.height), approvedAt: null,
          };
          const guarded = await runArtworkGuard({
            name, config: merged, width, height,
            brand: { name: brand?.name ?? "the brand", guidelines: brand?.guidelines ?? null, fontFamily: brand?.fontFamily ?? null },
            loadImage: makeImageLoader(req),
            exemplars: [masterReference, ...exemplars.filter((e) => e.id !== master.id)].slice(0, 3),
            measured: checkLayout(merged, width, height), adaptMethod: method,
            styleSpec: resolvedStyle.schema ? `${resolvedStyle.label}\n${describeStyleSchema(resolvedStyle.schema)}` : null,
            elementGuidelines,
            elementTopics: topicsPerElement(merged, width, height),
            headlineMaxH: (() => {
              const sp = resolvedStyle.schema;
              if (!sp || !hasLayeredSlots(merged)) return null;
              const share = height > width * 0.8 ? sp.parts.headline?.display?.stacked ?? 0.19 : sp.parts.headline?.display?.side ?? 0.38;
              return Math.round(Math.min(width, height) * share);
            })(),
          }, requestedGuardProvider, 2);
          guardReview = guarded.review;
          if (guarded.applied.length) guardFixes = { at: new Date().toISOString(), rounds: guarded.rounds, applied: guarded.applied, before: merged.elements };
          merged = normalizeFreeformConfig({ ...merged, elements: guarded.config.elements });
          finalRejected = checkMandatory(masterConfig, merged, width, height, (resolvedStyle.schema?.partRules ?? {}) as Record<string, { minPx?: number; neverOverlap?: string[]; dropWhenTight?: boolean }>);
          finalRejected.push(...checkLayout(merged, width, height).filter((i) => i.severity === "error").map((i) => i.message));
          finalRejected.push(...guarded.review.issues.filter((i) => i.severity === "send_back").map((i) => `AI Artwork Guard: ${i.message}`));
        } catch (err) {
          const reason = err instanceof Error ? err.message.slice(0, 180) : "review failed";
          (req as any).log?.warn?.({ err, templateId: master.id, width, height }, "AI artwork guard failed");
          finalRejected.push(`AI Artwork Guard failed: ${reason}`);
        }
      }
    }
    finalRejected = [...new Set(finalRejected)];
    if (finalRejected.length > 0) rejectedCount++;
    const cleanNotes = (merged.adaptNotes ?? []).filter((n) => !n.startsWith("Rejected:") && !n.startsWith("Check: Claude") && !n.startsWith("Check: AI Artwork Guard"));
    const storedConfig = {
      ...merged,
      adaptNotes: [...finalRejected.map((r) => `Rejected: ${r}`), ...cleanNotes],
      rejected: finalRejected.length ? finalRejected : undefined,
      ...(guardReview ? { claudeReview: guardReview, aiArtworkGuard: { enabled: true, provider: guardReview.answeredBy ?? guardReview.model, reviewedDuringBuild: true } } : {}),
      ...(guardFixes ? { claudeFixes: guardFixes } : {}),
    };
    const [template] = await db
      .insert(templatesTable)
      .values({
        name,
        description: `${finalRejected.length > 0 ? "REJECTED · " : ""}Adapted from "${master.name}" (${master.width}×${master.height}) · ${method.replace(":", " ")} · ${spec.formatClass}${guardReview ? " · AI guarded" : ""}`,
        // Created pieces always land in Work-in-progress, whatever the master
        // is; only "Make template" moves a piece into Templates.
        category: "wip",
        width,
        height,
        config: JSON.stringify(storedConfig),
        sourceTemplateId: master.id,
        createdBy: (req as any).clerkUserId ?? null,
      })
      .returning();
    created.push(template);
  }

  if (created.length === 0) {
    res.status(400).json({ error: "No valid adaptation targets supplied" });
    return;
  }
  if (rejectedCount > 0) res.setHeader("X-Adapt-Rejected", String(rejectedCount));
  res.status(201).json(created.map(formatTemplate));
});

/**
 * POST /templates/:id/claude-review
 *
 * The AI Artwork Guard sees the rendered piece, its
 * elements, the brand's layout rules, the measuring tool's findings and up
 * to two same-format pieces the designers marked Right, and returns an
 * advisory verdict with element-level issues. Stored on the template as
 * `config.claudeReview`; its issues are also written as "Check:" notes so
 * the Compare screen's "Needs a check" filter picks them up.
 */
router.post("/templates/:id/claude-review", requireAuth, async (req, res): Promise<void> => {
  const requestedProvider: ArtworkGuardProvider = req.body?.provider === "claude" || req.body?.provider === "openai" ? req.body.provider : "auto";
  if (!isArtworkGuardConfigured(requestedProvider)) {
    res.status(503).json({ error: "AI Artwork Guard is not configured. Add OPENAI_API_KEY or ANTHROPIC_API_KEY in Vercel." });
    return;
  }
  const id = Number(req.params.id);
  const [t] = await db.select().from(templatesTable).where(eq(templatesTable.id, id));
  if (!t) { res.status(404).json({ error: "Template not found" }); return; }
  let parsed: unknown;
  try { parsed = JSON.parse(t.config || "{}"); } catch { parsed = {}; }
  if (!isFreeformConfig(parsed)) { res.status(400).json({ error: "Only freeform artwork can be reviewed" }); return; }
  const config = normalizeFreeformConfig(parsed);
  const raw = parsed as Record<string, unknown>;
  const [brand] = await db.select().from(brandsTable).orderBy(brandsTable.id).limit(1);
  const masterId = t.sourceTemplateId ?? t.id;
  const cls = classifyAspect(t.width, t.height);
  // References: Right pieces from this family first (same shape, then any),
  // topped up with Right pieces from anywhere in the studio nearest in shape.
  const family = (await approvedExemplars(masterId)).filter((e) => e.id !== t.id);
  const familyRefs = [
    ...family.filter((e) => e.formatClass === cls),
    ...family.filter((e) => e.formatClass !== cls),
  ].slice(0, 3);
  // The standard is this campaign's: its own Right pieces, then Right pieces
  // from the same family (the profile's source masters and what was built
  // from them, or the built-in schema's name terms). Never another campaign.
  const [masterRow] = await db.select({ id: templatesTable.id, name: templatesTable.name, sourceTemplateId: templatesTable.sourceTemplateId }).from(templatesTable).where(eq(templatesTable.id, masterId));
  const resolvedStyle = await resolveStyleSchema({ masterId, masterName: masterRow?.name ?? t.name, sourceTemplateId: masterRow?.sourceTemplateId ?? null });
  const familyScope = resolvedStyle.source === "profile" && resolvedStyle.profileId
    ? { familyIds: [masterId, ...(((await getProfile(resolvedStyle.profileId))?.profile.sources ?? []).map((s) => s.templateId))] }
    : resolvedStyle.source === "builtin" && resolvedStyle.schema
      ? { familyIds: [masterId], nameTerms: resolvedStyle.schema.match }
      : {};
  const exemplars = familyRefs.length >= 3
    ? familyRefs
    : [...familyRefs, ...(await studioExemplars(t.width, t.height, [t.id, ...familyRefs.map((e) => e.id)], 3 - familyRefs.length, familyScope))];
  const noteRows = await db.execute(sql`SELECT verdict, note FROM feedback
    WHERE subject_type = 'template' AND subject_id = ${t.id} AND element_id IS NULL ORDER BY id DESC LIMIT 1`);
  const lastVerdict = (noteRows.rows as any[])[0] as { verdict?: string; note?: string } | undefined;
  const designerNote = lastVerdict?.verdict === "incorrect" && lastVerdict.note ? String(lastVerdict.note) : null;
  const measured = checkLayout(config, t.width, t.height);
  // Claude fixes what it finds on adapted pieces. Imported masters are never
  // touched (the studio reproduces imported artwork verbatim) — they are
  // reviewed only.
  const canFix = req.body?.fix !== false && t.sourceTemplateId != null;
  let review: ClaudeReview;
  let fixed: FixResult | null = null;
  try {
    const reviewInput = {
      name: t.name,
      config,
      width: t.width,
      height: t.height,
      brand: {
        name: brand?.name ?? "the brand",
        guidelines: brand?.guidelines ?? null,
        fontFamily: brand?.fontFamily ?? null,
      },
      loadImage: makeImageLoader(req),
      exemplars,
      measured,
      adaptMethod: typeof raw.adaptMethod === "string" ? raw.adaptMethod : null,
      designerNote,
      styleSpec: resolvedStyle.schema ? `${resolvedStyle.label}\n${describeStyleSchema(resolvedStyle.schema)}` : null,
      // The guideline passages for exactly the elements on this piece: logo
      // rules when there is a logo tile, pattern rules when there is a band…
      elementGuidelines: await guidelinesForConfig(brand?.id ?? null, config, t.width, t.height, 5).catch(() => []),
      elementTopics: topicsPerElement(config, t.width, t.height),
      headlineMaxH: (() => {
        const sp = resolvedStyle.schema;
        if (!sp || !hasLayeredSlots(config)) return null;
        const short = Math.min(t.width, t.height);
        const share = t.height > t.width * 0.8 ? sp.parts.headline?.display?.stacked ?? 0.19 : sp.parts.headline?.display?.side ?? 0.38;
        return Math.round(short * share);
      })(),
    };
    if (canFix) {
      fixed = await runArtworkGuard(reviewInput, requestedProvider, 2);
      review = fixed.review;
    } else {
      review = (await runArtworkGuard(reviewInput, requestedProvider, 1)).review;
    }
  } catch (err) {
    (req as any).log?.warn?.({ err, templateId: id }, "claude review failed");
    res.status(502).json({ error: err instanceof Error ? err.message : "Claude review failed" });
    return;
  }
  const priorNotes = Array.isArray(raw.adaptNotes) ? (raw.adaptNotes as unknown[]).filter((n): n is string => typeof n === "string") : [];
  // Claude's notes carry their marker up front (notes may be truncated on
  // save), so a re-check replaces the previous set rather than stacking.
  // Only what Claude could NOT fix becomes a note — those still need a person.
  const kept = priorNotes.filter((n) => !n.startsWith("Check: Claude —") && !n.includes("(Claude)"));
  const unfixed = fixed ? fixed.remaining : review.issues.filter((i) => i.severity === "send_back");
  const claudeNotes = unfixed.map((i) => `Check: Claude — ${i.message.slice(0, 160)}`);
  const priorFixes = raw.claudeFixes && typeof raw.claudeFixes === "object" ? (raw.claudeFixes as Record<string, unknown>) : null;
  const claudeFixes = fixed && fixed.applied.length > 0
    ? {
        at: new Date().toISOString(),
        rounds: fixed.rounds,
        applied: fixed.applied,
        // The elements as they were before Claude's first fix, for Undo.
        before: priorFixes?.before ?? config.elements,
      }
    : priorFixes ?? undefined;
  const next = {
    ...raw,
    ...(fixed ? { elements: fixed.config.elements } : {}),
    adaptNotes: [...kept, ...claudeNotes],
    claudeReview: review,
    ...(claudeFixes ? { claudeFixes } : {}),
  };
  const [updated] = await db
    .update(templatesTable)
    .set({ config: JSON.stringify(next), updatedAt: new Date() })
    .where(eq(templatesTable.id, id))
    .returning();
  res.json({ ...formatTemplate(updated), claudeReview: review });
});

/** POST /templates/:id/claude-review/undo — put the elements back as they were before Claude's fixes. */
router.post("/templates/:id/claude-review/undo", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [t] = await db.select().from(templatesTable).where(eq(templatesTable.id, id));
  if (!t) { res.status(404).json({ error: "Template not found" }); return; }
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(t.config || "{}"); } catch { raw = {}; }
  const fixes = raw.claudeFixes as { before?: unknown } | undefined;
  if (!fixes || !Array.isArray(fixes.before)) { res.status(400).json({ error: "Nothing to undo" }); return; }
  const { claudeFixes: _drop, claudeReview: _drop2, ...rest } = raw;
  const notes = Array.isArray(rest.adaptNotes) ? (rest.adaptNotes as unknown[]).filter((n): n is string => typeof n === "string" && !n.startsWith("Check: Claude —")) : [];
  const next = { ...rest, elements: fixes.before, adaptNotes: notes };
  const [updated] = await db.update(templatesTable).set({ config: JSON.stringify(next), updatedAt: new Date() }).where(eq(templatesTable.id, id)).returning();
  res.json(formatTemplate(updated));
});

/** Palette for CMYK->RGB snapping during dissection: the requested brand, or
 * the first brand (the import page previews against brands[0]). */
async function dissectPaletteHexes(rawBrandId: unknown): Promise<string[]> {
  try {
    const brandId = Number(rawBrandId);
    const [brand] = Number.isInteger(brandId) && brandId > 0
      ? await db.select().from(brandsTable).where(eq(brandsTable.id, brandId))
      : await db.select().from(brandsTable).orderBy(brandsTable.id).limit(1);
    return brand ? collectBrandPaletteHexes(brand) : [];
  } catch {
    return []; // palette snapping is an enhancement, never a reason to fail import
  }
}

router.post("/templates/dissect-pdf", requireAdmin, async (req, res): Promise<void> => {
  const objectPath = typeof req.body?.objectPath === "string" ? req.body.objectPath.trim() : "";
  if (!objectPath) { res.status(400).json({ error: "objectPath is required" }); return; }
  const page = Number.isInteger(req.body?.page) && req.body.page >= 1 ? req.body.page : 1;
  const mode = req.body?.mode === "keyVisual" ? "keyVisual" : "elements";
  try {
    const paletteHexes = await dissectPaletteHexes(req.body?.brandId);
    const result = await dissectPdfToTemplate(objectPath, page, paletteHexes, mode);
    res.json(result);
  } catch (err) {
    (req as any).log?.error({ err }, "PDF dissection failed");
    res.status(422).json({ error: "Could not read that PDF. It may be encrypted, corrupted, or unsupported." });
  }
});

router.post("/templates/dissect-image", requireAdmin, async (req, res): Promise<void> => {
  const objectPath = typeof req.body?.objectPath === "string" ? req.body.objectPath.trim() : "";
  if (!objectPath) { res.status(400).json({ error: "objectPath is required" }); return; }
  try {
    const result = await dissectImageToTemplate(objectPath);
    res.json(result);
  } catch (err) {
    (req as any).log?.error({ err }, "Image dissection failed");
    res.status(422).json({ error: "Could not learn that image. It may be corrupted or in an unsupported format." });
  }
});

/**
 * POST /templates/import-example  { objectPath, fileName, brandId? }
 *
 * Import example artwork of ANY supported kind — packaged InDesign, IDML,
 * PDF, Photoshop, or flat art — as master template(s) ready to build a
 * campaign from. Multi-page sources produce one master per message variant.
 */
router.post("/templates/import-example", requireAdmin, async (req, res): Promise<void> => {
  const objectPath = typeof req.body?.objectPath === "string" ? req.body.objectPath.trim() : "";
  const fileName = typeof req.body?.fileName === "string" ? req.body.fileName.trim() : "";
  if (!objectPath || !fileName) {
    res.status(400).json({ error: "objectPath and fileName are required" });
    return;
  }
  const kind = exampleKindFor(fileName);
  if (!kind) {
    res.status(400).json({
      error: "Unsupported file. Use a packaged InDesign folder (.zip), .idml, .pdf, .psd, or flat art (.jpg/.png).",
    });
    return;
  }
  try {
    const brandId = Number(req.body?.brandId);
    const [brand] = Number.isInteger(brandId) && brandId > 0
      ? await db.select().from(brandsTable).where(eq(brandsTable.id, brandId))
      : await db.select().from(brandsTable).orderBy(brandsTable.id).limit(1);
    const result = await importExample(
      objectPath,
      fileName,
      brand?.logoUrl ?? null,
      brand ? collectBrandPaletteHexes(brand) : [],
    );

    // Package assets land in the brand library so the campaign can reuse them.
    if (brand && result.assets.length > 0 && result.folder) {
      // Uploads go to WIP only: the package's support files are NOT added to
      // the library here. Their manifest rides on each created template so the
      // user can choose "add to library" at sign-off (promote).
      //
      // Fonts are the exception: the server renderer and the browser
      // (/api/fonts.css) need the designer's faces the moment the layouts
      // exist, or imported headlines draw in a substitute and overflow.
      const fonts = result.assets.filter((a) => a.kind === "font");
      if (fonts.length > 0) {
        const existing = await db
          .select({ objectPath: brandAssetsTable.objectPath, name: brandAssetsTable.name })
          .from(brandAssetsTable)
          .where(and(eq(brandAssetsTable.brandId, brand.id), eq(brandAssetsTable.kind, "font")));
        const known = new Set(existing.flatMap((e) => [e.objectPath, e.name]));
        for (const font of fonts) {
          if (known.has(font.objectPath) || known.has(font.name)) continue;
          await db.insert(brandAssetsTable).values({
            brandId: brand.id,
            name: font.name,
            kind: "font",
            folder: result.folder,
            objectPath: font.objectPath,
            contentType: font.contentType,
          });
          known.add(font.name);
        }
      }
    }

    const created: (typeof templatesTable.$inferSelect)[] = [];
    const manifest =
      result.folder && result.assets.length > 0
        ? { sourceFolder: result.folder, sourceAssets: result.assets }
        : {};
    for (const layout of result.layouts) {
      const [template] = await db
        .insert(templatesTable)
        .values({
          name: layout.name,
          description: `Example artwork imported from ${fileName}`,
          // Imports land in Work-in-progress: they only become selectable
          // templates when the user promotes them from the Templates page.
          category: "wip",
          width: layout.width,
          height: layout.height,
          config: JSON.stringify({ ...layout.config, ...manifest }),
          createdBy: (req as any).clerkUserId ?? null,
        })
        .returning();
      created.push(template);
    }

    // Two or more layouts from one package are two shapes of one campaign:
    // measure them into a layout profile straight away.
    let profileSummary: { id: number; name: string; notes: string[] } | null = null;
    if (created.length >= 2) {
      try {
        const learned = await learnProfile(created.map((t) => t.id), fileName.replace(/\.[a-z0-9]+$/i, ""), (req as any).clerkUserId ?? null);
        if (learned) profileSummary = { id: learned.stored.id, name: learned.stored.name, notes: learned.stored.profile.notes };
      } catch (err) {
        (req as any).log?.warn?.({ err }, "profile learn after import failed");
      }
    }
    res.status(201).json({
      kind: result.kind,
      templates: created.map(formatTemplate),
      warnings: [...result.warnings, ...(profileSummary ? [`Layout profile "${profileSummary.name}" measured: ${profileSummary.notes[0] ?? ""}`] : [])],
      assetsImported: result.assets.length,
      ...(profileSummary ? { layoutProfile: profileSummary } : {}),
    });
  } catch (err) {
    (req as any).log?.error({ err }, "Example import failed");
    res.status(422).json({
      error: err instanceof Error ? err.message.slice(0, 200) : "Could not read that file.",
    });
  }
});

router.get("/templates/:id", optionalAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [template] = await db.select().from(templatesTable).where(eq(templatesTable.id, id));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(formatTemplate(template));
});

router.patch("/templates/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const body = req.body;
  const error = validatePayload(body, true);
  if (error) { res.status(400).json({ error }); return; }
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.category !== undefined) updateData.category = body.category;
  if (body.width !== undefined) updateData.width = Number(body.width);
  if (body.height !== undefined) updateData.height = Number(body.height);
  if (body.sourceImageUrl !== undefined) updateData.sourceImageUrl = body.sourceImageUrl;
  if (body.config !== undefined) {
    if (body.config?.kind === "freeform") {
      // The editor saves elements and layout options only. Whatever arrived
      // with the import (the runnable HTML preview, the package's source
      // assets) or with the adapt engine (method, notes) stays on the piece
      // unless the caller sends a replacement or an explicit null.
      const [existing] = await db.select({ config: templatesTable.config }).from(templatesTable).where(eq(templatesTable.id, id));
      let prev: Record<string, unknown> = {};
      try { prev = JSON.parse(existing?.config || "{}"); } catch { prev = {}; }
      const merged: Record<string, unknown> = { ...body.config };
      if (prev.kind === "freeform") {
        for (const k of ["previewHtml", "sourceFolder", "sourceAssets", "adaptMethod", "adaptNotes"] as const) {
          if (merged[k] === undefined && prev[k] !== undefined) merged[k] = prev[k];
        }
      }
      updateData.config = JSON.stringify(normalizeFreeformConfig(merged));
    } else {
      updateData.config = JSON.stringify({ ...DEFAULT_CONFIG, ...body.config });
    }
  }

  const [template] = await db.update(templatesTable).set(updateData).where(eq(templatesTable.id, id)).returning();
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(formatTemplate(template));
});

/**
 * POST /templates/:id/add-to-library  { brandId? }
 *
 * The sign-off choice: file an imported package's source assets into the
 * brand library. The manifest was stashed on the template at import time;
 * inserts are deduped by (folder, name) so pressing it twice is harmless.
 */
router.post("/templates/:id/add-to-library", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [tpl] = await db.select().from(templatesTable).where(eq(templatesTable.id, id));
  if (!tpl) { res.status(404).json({ error: "Template not found" }); return; }
  let cfg: { sourceFolder?: string; sourceAssets?: { name: string; objectPath: string; contentType: string; kind: string }[] } = {};
  try { cfg = JSON.parse(tpl.config || "{}"); } catch { /* fallthrough */ }
  const assets = Array.isArray(cfg.sourceAssets) ? cfg.sourceAssets : [];
  if (assets.length === 0) { res.json({ added: 0 }); return; }
  const folder = cfg.sourceFolder || `Package — ${tpl.name}`;
  const brandId = Number(req.body?.brandId) || (await db.select().from(brandsTable).limit(1))[0]?.id;
  if (!brandId) { res.status(400).json({ error: "No brand" }); return; }
  const existing = await db
    .select({ name: brandAssetsTable.name })
    .from(brandAssetsTable)
    .where(and(eq(brandAssetsTable.brandId, brandId), eq(brandAssetsTable.folder, folder)));
  const seen = new Set(existing.map((e) => e.name));
  let added = 0;
  for (const a of assets) {
    if (!a?.name || !a?.objectPath || seen.has(a.name)) continue;
    seen.add(a.name);
    await db.insert(brandAssetsTable).values({
      brandId,
      name: a.name,
      kind: a.kind || "image",
      folder,
      objectPath: a.objectPath,
      contentType: a.contentType || "application/octet-stream",
    });
    added++;
  }
  res.json({ added, folder });
});

/**
 * POST /templates/:id/apply-artwork  { sourceTemplateId }
 *
 * Use a template as a layout skeleton for existing artwork: clone the target
 * template's structure and pour the source artwork's imagery into it (its
 * product-role image, falling back to its largest image layer). The result is
 * a new WIP piece to refine.
 */
router.post("/templates/:id/apply-artwork", requireAdmin, async (req, res): Promise<void> => {
  const targetId = Number(req.params.id);
  const sourceId = Number(req.body?.sourceTemplateId);
  const [target] = await db.select().from(templatesTable).where(eq(templatesTable.id, targetId));
  const [source] = await db.select().from(templatesTable).where(eq(templatesTable.id, sourceId));
  if (!target || !source) { res.status(404).json({ error: "Template not found" }); return; }

  let targetCfg: FreeformConfig;
  let sourceCfg: FreeformConfig;
  try {
    targetCfg = normalizeFreeformConfig(JSON.parse(target.config || "{}"));
    sourceCfg = normalizeFreeformConfig(JSON.parse(source.config || "{}"));
  } catch {
    res.status(400).json({ error: "Template config unreadable" });
    return;
  }
  if (targetCfg.elements.length === 0) {
    res.status(400).json({ error: "The chosen template has no layout elements to apply artwork into" });
    return;
  }
  // The artwork to pour in: the source's product image, else its largest image layer.
  const srcImages = sourceCfg.elements.filter(
    (e): e is Extract<FreeformElement, { type: "image" }> => e.type === "image" && !!e.src && e.role !== "logo",
  );
  const artwork =
    srcImages.find((e) => e.role === "product") ??
    srcImages.sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (!artwork) { res.status(400).json({ error: "The source artwork has no image to apply" }); return; }

  // Clone the target layout; imagery slots (product role, else the largest
  // image) take the artwork; everything else keeps the template's design.
  const imgEls = targetCfg.elements.filter(
    (e): e is Extract<FreeformElement, { type: "image" }> => e.type === "image" && e.role !== "logo",
  );
  const slots = imgEls.some((e) => e.role === "product")
    ? imgEls.filter((e) => e.role === "product")
    : imgEls.slice().sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 1);
  const slotIds = new Set(slots.map((e) => e.id));
  const elements = targetCfg.elements.map((e) =>
    e.type === "image" && slotIds.has(e.id)
      ? { ...e, src: artwork.src, fit: "cover" as const, ...(artwork.focusBox ? { focusBox: artwork.focusBox, focusX: artwork.focusX, focusY: artwork.focusY } : {}) }
      : e,
  );

  const [created] = await db
    .insert(templatesTable)
    .values({
      name: `${source.name} in ${target.name}`,
      description: `"${source.name}" artwork applied to the "${target.name}" template`,
      category: "wip",
      width: target.width,
      height: target.height,
      config: JSON.stringify({ ...targetCfg, elements }),
      createdBy: (req as any).clerkUserId ?? null,
    })
    .returning();
  res.status(201).json(formatTemplate(created));
});

/**
 * POST /templates/:id/trim-layers
 *
 * Retro-fit the "containers flush to their asset" rule on an existing
 * artwork: alpha-trim each image layer to its visible pixels (threshold 16,
 * only when it shrinks an axis >10%), shifting x/y by the display scale so
 * nothing moves on canvas. Same logic new imports get automatically.
 */
router.post("/templates/:id/trim-layers", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [tpl] = await db.select().from(templatesTable).where(eq(templatesTable.id, id));
  if (!tpl) { res.status(404).json({ error: "Template not found" }); return; }
  let cfg: FreeformConfig;
  try { cfg = normalizeFreeformConfig(JSON.parse(tpl.config || "{}")); } catch {
    res.status(400).json({ error: "Config unreadable" }); return;
  }
  const sharp = (await import("sharp")).default;
  const { ObjectStorageService } = await import("../lib/objectStorage");
  const objectStorageService = new ObjectStorageService();
  let trimmed = 0;
  const elements = [];
  for (const el of cfg.elements) {
    if (el.type !== "image" || !el.src || !/^\/api\/storage\//.test(el.src)) { elements.push(el); continue; }
    try {
      const objectPath = el.src.replace(/^\/api\/storage/, "");
      const file = await objectStorageService.getObjectEntityFile(objectPath);
      const bytes = Buffer.from(await (await objectStorageService.downloadObject(file)).arrayBuffer());
      const meta = await sharp(bytes).metadata();
      if (!meta.hasAlpha || !meta.width || !meta.height) { elements.push(el); continue; }
      const raw = await sharp(bytes).ensureAlpha().raw().toBuffer();
      const W = meta.width, H = meta.height;
      let minX = W, minY = H, maxX = -1, maxY = -1;
      for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
        if (raw[(py * W + px) * 4 + 3] > 16) {
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
      }
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      if (maxX < 0 || (bw >= W * 0.9 && bh >= H * 0.9)) { elements.push(el); continue; }
      const out = Buffer.from(await sharp(bytes).extract({ left: minX, top: minY, width: bw, height: bh }).png().toBuffer());
      const stored = await objectStorageService.uploadBytes(out, "image/png");
      const dispX = (el.w ?? W) / W, dispY = (el.h ?? H) / H;
      elements.push({
        ...el,
        src: `/api/storage${stored}`,
        x: Math.round((el.x ?? 0) + minX * dispX),
        y: Math.round((el.y ?? 0) + minY * dispY),
        w: Math.round(bw * dispX),
        h: Math.round(bh * dispY),
      });
      trimmed++;
    } catch { elements.push(el); }
  }
  if (trimmed > 0) {
    await db.update(templatesTable)
      .set({ config: JSON.stringify({ ...cfg, elements }), updatedAt: new Date() })
      .where(eq(templatesTable.id, id));
  }
  res.json({ trimmed });
});

/**
 * POST /templates/:id/redo
 *
 * Rebuild one piece from its master with the current engine, recipes and
 * designer feedback, replacing the piece's layout in place (name, category
 * and id are kept, so reviews and links still point at it). Manual edits on
 * the piece are discarded — the caller confirms that.
 */
router.post("/templates/:id/redo", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [piece] = await db.select().from(templatesTable).where(eq(templatesTable.id, id));
  if (!piece) { res.status(404).json({ error: "Template not found" }); return; }
  if (!piece.sourceTemplateId) {
    res.status(409).json({ error: "This is an original import, not a piece built from a master. Re-import the file to redo it." });
    return;
  }
  const [master] = await db.select().from(templatesTable).where(eq(templatesTable.id, piece.sourceTemplateId));
  if (!master) { res.status(409).json({ error: "The master this piece was built from no longer exists." }); return; }
  let parsed: unknown;
  try { parsed = JSON.parse(master.config || "{}"); } catch { parsed = {}; }
  if (!isFreeformConfig(parsed)) { res.status(400).json({ error: "The master is not a freeform template" }); return; }
  let masterConfig = normalizeFreeformConfig(parsed);
  try {
    const withMotion = await backfillKeyVisualMotion(masterConfig);
    if (withMotion) {
      masterConfig = normalizeFreeformConfig({ ...(parsed as Record<string, unknown>), elements: withMotion.elements });
      await db.update(templatesTable)
        .set({ config: JSON.stringify({ ...(parsed as Record<string, unknown>), elements: masterConfig.elements }), updatedAt: new Date() })
        .where(eq(templatesTable.id, master.id));
    }
  } catch { /* motion is a bonus on a redo */ }
  if (isFlatArtwork(masterConfig) && aspectDistance(master.width, master.height, piece.width, piece.height) > FLAT_SCALE_TOLERANCE) {
    res.status(422).json({ error: `"${master.name}" is flat artwork; a ${piece.width}×${piece.height} cannot be rebuilt from it. Import the working files.` });
    return;
  }
  const [brand] = await db.select().from(brandsTable).orderBy(brandsTable.id).limit(1);
  const brandInfo: BrandInfo = { logoUrl: brand?.logoUrl ?? null, strapline: brand?.strapline ?? null, panelFill: brand?.primaryColor ?? null };
  brandInfo.panelFill = (await layeredPanelFill(masterConfig, req)) ?? brandInfo.panelFill;
  try {
    await ensureBrandFontsRegistered();
    // The corrected, approved pieces of this family are the reference — never
    // the piece being redone itself.
    const exemplars = await approvedExemplars(master.id);
    const redoStyle = await resolveStyleSchema({ masterId: master.id, masterName: master.name, sourceTemplateId: master.sourceTemplateId ?? null });
    const { config, method, spec, reference } = await adaptOne(master, masterConfig, piece.width, piece.height, brandInfo, (req as any).log, exemplars, piece.id, { name: piece.name }, redoStyle.source === "none" ? null : { schema: redoStyle.schema, label: redoStyle.label, profile: redoStyle.profile }, { loadImage: makeImageLoader(req), brandFontFamily: brand?.fontFamily ?? "National 2" });
    const [updated] = await db
      .update(templatesTable)
      .set({
        config: JSON.stringify(config),
        description: `Adapted from "${master.name}" (${master.width}×${master.height}) · ${method.replace(":", " ")} · ${spec.formatClass} · redone ${new Date().toISOString().slice(0, 10)}`,
        updatedAt: new Date(),
      })
      .where(eq(templatesTable.id, id))
      .returning();
    (req as any).log?.info({ templateId: id, masterId: master.id, method, exemplars: exemplars.length, reference: reference?.exemplar.id ?? null }, "redo: rebuilt");
    res.json({
      ...formatTemplate(updated),
      redo: {
        method,
        exemplars: exemplars.length,
        // The approved piece this rebuild followed, so the editor can say so.
        reference: reference
          ? { id: reference.exemplar.id, name: reference.exemplar.name, width: reference.exemplar.width, height: reference.exemplar.height, scaled: reference.scaleFromExemplar, note: reference.note }
          : null,
        notes: config.adaptNotes ?? [],
      },
    });
  } catch (err) {
    (req as any).log?.error({ err, templateId: id, masterId: master.id }, "redo failed");
    res.status(500).json({ error: `Redo failed: ${err instanceof Error ? err.message.slice(0, 200) : "unknown error"}` });
  }
});

/**
 * POST /templates/clear-wip
 *
 * Empty the work-in-progress list in one go: every template in category
 * "wip" that no brief asset references. Designer feedback on those pieces
 * survives — each feedback row snapshots what it was about at insert time
 * (lib/feedbackLearning.ts) — so clearing WIP never loses a lesson.
 */
router.post("/templates/clear-wip", requireAdmin, async (req, res): Promise<void> => {
  const wip = await db.select({ id: templatesTable.id }).from(templatesTable).where(eq(templatesTable.category, "wip"));
  const used = new Set(
    (await db.select({ size: assetsTable.templateSize }).from(assetsTable)).map((a) => a.size),
  );
  const deletable = wip.map((t) => t.id).filter((id) => !used.has(`tpl_${id}`));
  if (deletable.length > 0) await db.delete(templatesTable).where(inArray(templatesTable.id, deletable));
  res.json({ deleted: deletable.length, kept: wip.length - deletable.length });
});

/**
 * POST /templates/delete-many  { ids: number[] }
 *
 * Delete a chosen set of work-in-progress pieces (the WIP page's Select all
 * / Delete selected). Only WIP templates are touched; anything a campaign
 * asset still uses is kept and reported.
 */
router.post("/templates/delete-many", requireAdmin, async (req, res): Promise<void> => {
  const raw: unknown[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
  if (ids.length === 0) { res.status(400).json({ error: "ids is required" }); return; }
  const wip = await db
    .select({ id: templatesTable.id })
    .from(templatesTable)
    .where(and(inArray(templatesTable.id, ids), eq(templatesTable.category, "wip")));
  const used = new Set((await db.select({ size: assetsTable.templateSize }).from(assetsTable)).map((a) => a.size));
  const deletable = wip.map((t) => t.id).filter((id) => !used.has(`tpl_${id}`));
  if (deletable.length > 0) await db.delete(templatesTable).where(inArray(templatesTable.id, deletable));
  res.json({ deleted: deletable.length, kept: ids.length - deletable.length });
});

router.delete("/templates/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const referencing = await db
    .select({ id: assetsTable.id })
    .from(assetsTable)
    .where(eq(assetsTable.templateSize, `tpl_${id}`))
    .limit(1);
  if (referencing.length > 0) {
    res.status(409).json({ error: "This template is in use by existing assets and cannot be deleted." });
    return;
  }
  await db.delete(templatesTable).where(eq(templatesTable.id, id));
  res.status(204).end();
});

export default router;
