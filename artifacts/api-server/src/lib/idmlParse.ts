/**
 * IDML → editable freeform template (InDesign import, Stage 2).
 *
 * IDML is InDesign's interchange format: a zip of XML that carries the FULL
 * layout as structured data — exact text, point sizes, colours, alignment,
 * fonts, frame geometry, and stacking order. Parsing it means the template
 * reproduces the designer's decisions rather than inferring them from a
 * flattened render. This is the "structured master" that no-adjustment
 * adaptation needs.
 *
 * v1 scope (best-effort, review UI catches the rest):
 *  - First page of the first spread.
 *  - TextFrames → text elements: story content with line breaks, dominant
 *    point size, fill colour resolved from Resources/Graphic.xml (CMYK
 *    converted and snapped to the brand palette by the caller), bold from
 *    font style, paragraph justification.
 *  - Rectangles with placed images → image elements, matched by filename to
 *    the package's imported Links assets.
 *  - Plain filled rectangles → rect elements.
 *  - Document order = z-order. Rotated/skewed items imported axis-aligned
 *    (their bounding box) with a warning.
 */
import { constraintsFromIdml } from "./liquid";
import { XMLParser } from "fast-xml-parser";
import type JSZip from "jszip";
import { cmykToHex, rgbToHex } from "./colorAdapter";

export interface IdmlParseResult {
  width: number;
  height: number;
  elements: Record<string, unknown>[];
  warnings: string[];
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** The item's InDesign object-based liquid rule, when the designer set one. */
function liquidOf(item: Record<string, any> | undefined): { constraints?: NonNullable<ReturnType<typeof constraintsFromIdml>> } {
  const c = constraintsFromIdml(item?.["@_HorizontalLayoutConstraints"], item?.["@_VerticalLayoutConstraints"]);
  return c ? { constraints: c } : {};
}

function parseMatrix(raw: unknown): Matrix {
  if (typeof raw !== "string") return IDENTITY;
  const parts = raw.trim().split(/\s+/).map(Number);
  return parts.length === 6 && parts.every(Number.isFinite) ? (parts as Matrix) : IDENTITY;
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Forward declaration wrapper so itemBounds (defined above the walker) can
 * compose matrices; identical maths to compose(). */
function composeForBounds(parent: Matrix, child: Matrix): Matrix {
  return [
    parent[0] * child[0] + parent[2] * child[1],
    parent[1] * child[0] + parent[3] * child[1],
    parent[0] * child[2] + parent[2] * child[3],
    parent[1] * child[2] + parent[3] * child[3],
    parent[0] * child[4] + parent[2] * child[5] + parent[4],
    parent[1] * child[4] + parent[3] * child[5] + parent[5],
  ];
}

/** Bounds of an item's path geometry, transformed into spread coordinates
 * (through its own transform composed onto any ancestor-group transforms). */
function itemBounds(
  item: Record<string, any>,
  parentMatrix: Matrix = IDENTITY,
): { x: number; y: number; w: number; h: number } | null {
  const m = composeForBounds(parentMatrix, parseMatrix(item["@_ItemTransform"]));
  const anchors: [number, number][] = [];
  const paths = asArray(item?.Properties?.PathGeometry?.GeometryPathType);
  for (const path of paths) {
    for (const pp of asArray(path?.PathPointArray?.PathPointType)) {
      // Anchors alone under-estimate a curved path (koru masks, circles):
      // the Bézier handles bound the curve, so include them. A slightly
      // generous box is harmless; a tight one clips the crop.
      for (const key of ["@_Anchor", "@_LeftDirection", "@_RightDirection"] as const) {
        const a = typeof pp?.[key] === "string" ? pp[key].trim().split(/\s+/).map(Number) : null;
        if (a && a.length === 2 && a.every(Number.isFinite)) anchors.push(apply(m, a[0], a[1]));
      }
    }
  }
  if (anchors.length < 2) return null;
  const xs = anchors.map((p) => p[0]);
  const ys = anchors.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Resolve IDML colour references ("Color/c1", "Color/C=0 M=100...") to hex. */
function buildColorTable(graphicXml: Record<string, any> | null): Map<string, string> {
  const table = new Map<string, string>();
  const colors = asArray(graphicXml?.["idPkg:Graphic"]?.Color ?? graphicXml?.Graphic?.Color);
  for (const c of colors) {
    const self = c?.["@_Self"];
    const space = c?.["@_Space"];
    const values = typeof c?.["@_ColorValue"] === "string" ? c["@_ColorValue"].trim().split(/\s+/).map(Number) : [];
    if (typeof self !== "string") continue;
    if (space === "CMYK" && values.length === 4) {
      table.set(self, cmykToHex(values[0], values[1], values[2], values[3]));
    } else if (space === "RGB" && values.length === 3) {
      table.set(self, rgbToHex({ r: values[0], g: values[1], b: values[2] }));
    }
  }
  return table;
}

/** Resolved paragraph-style attributes (with BasedOn inheritance applied). */
interface ParaStyle {
  font?: string;
  fontStyle?: string;
  pointSize?: number;
  justification?: string;
  /** InDesign Capitalization attribute (AllCaps, SmallCaps, ...). */
  capitalization?: string;
  /** InDesign Tracking, in thousandths of an em (e.g. -25). */
  tracking?: number;
  /** Style name — carries conventions like "N2B" (National 2 Bold). */
  name: string;
}

function buildParaStyleTable(stylesXml: Record<string, any> | null): Map<string, ParaStyle> {
  const table = new Map<string, ParaStyle>();
  const raw = new Map<string, Record<string, any>>();
  const collect = (group: Record<string, any> | undefined) => {
    if (!group) return;
    for (const ps of asArray(group.ParagraphStyle)) {
      const self = ps?.["@_Self"];
      if (typeof self === "string") raw.set(self, ps);
    }
    for (const sub of asArray(group.ParagraphStyleGroup)) collect(sub);
  };
  const root = stylesXml?.["idPkg:Styles"] ?? stylesXml?.Styles ?? stylesXml;
  collect(root?.RootParagraphStyleGroup);

  const resolve = (self: string, depth = 0): ParaStyle => {
    const cached = table.get(self);
    if (cached) return cached;
    const ps = raw.get(self);
    const empty: ParaStyle = { name: self };
    if (!ps || depth > 4) return empty;
    const basedOnRaw = ps?.Properties?.BasedOn;
    const basedOn = typeof basedOnRaw === "object" ? basedOnRaw?.["#text"] : basedOnRaw;
    const parent =
      typeof basedOn === "string" && basedOn !== self
        ? resolve(basedOn.startsWith("ParagraphStyle/") ? basedOn : `ParagraphStyle/${basedOn}`, depth + 1)
        : empty;
    const appliedRaw = ps?.Properties?.AppliedFont;
    const applied = typeof appliedRaw === "object" ? appliedRaw?.["#text"] : appliedRaw;
    const size = Number(ps?.["@_PointSize"]);
    const style: ParaStyle = {
      name: self,
      font: typeof applied === "string" && applied ? applied : parent.font,
      fontStyle:
        typeof ps?.["@_FontStyle"] === "string" && ps["@_FontStyle"] !== "None"
          ? ps["@_FontStyle"]
          : parent.fontStyle,
      pointSize: Number.isFinite(size) && size > 0 ? size : parent.pointSize,
      justification: typeof ps?.["@_Justification"] === "string" ? ps["@_Justification"] : parent.justification,
      capitalization:
        typeof ps?.["@_Capitalization"] === "string" && ps["@_Capitalization"] !== "Normal"
          ? ps["@_Capitalization"]
          : parent.capitalization,
      tracking: Number.isFinite(Number(ps?.["@_Tracking"])) && ps?.["@_Tracking"] !== undefined ? Number(ps["@_Tracking"]) : parent.tracking,
    };
    table.set(self, style);
    return style;
  };
  for (const self of raw.keys()) resolve(self);
  return table;
}

/** Normalize font names to the families the app self-hosts. */
function normalizeFontFamily(font: string | undefined): string | undefined {
  if (!font) return undefined;
  // The condensed cut is a different family to the renderer and the browser
  // (its own OTF in Document fonts/); collapsing it to "National 2" sets
  // headlines in the wide face and they overflow their frames.
  if (/national\s*2\s*cond/i.test(font)) return "National 2 Condensed";
  if (/national\s*2/i.test(font)) return "National 2";
  return font.replace(/[^\w\s,'-]/g, "").trim() || undefined;
}

const BOLD_HINT = /bold|black|heavy|semibold|n2b|n2cb/i;

const JUSTIFY: Record<string, "left" | "center" | "right"> = {
  LeftAlign: "left",
  CenterAlign: "center",
  RightAlign: "right",
  LeftJustified: "left",
  CenterJustified: "center",
  RightJustified: "right",
  FullyJustified: "left",
};

interface StoryText {
  text: string;
  fontSize: number;
  bold: boolean;
  /** InDesign tracking in thousandths of an em (0 when unset). */
  tracking: number;
  /** Runs of different weights in one paragraph (rendered with one weight here). */
  mixedWeights: boolean;
  color?: string;
  align: "left" | "center" | "right";
  fontFamily?: string;
}

/** Flatten a story's paragraph/character ranges into renderable text + the
 * dominant styling (largest run wins). Run attributes override the resolved
 * paragraph style, which is where real documents keep their typography. */
function parseStory(
  storyXml: Record<string, any>,
  colors: Map<string, string>,
  paraStyles: Map<string, ParaStyle>,
): StoryText | null {
  const story = storyXml?.["idPkg:Story"]?.Story ?? storyXml?.Story;
  if (!story) return null;

  let text = "";
  let align: "left" | "center" | "right" = "left";
  let best = { len: 0, fontSize: 12, bold: false, color: undefined as string | undefined, font: undefined as string | undefined, tracking: 0 };
  // Across all runs: length-weighted tracking, and whether weights are mixed
  // ("Search" regular + "layouts" bold) — a single element can only carry one
  // weight, so such paragraphs measure wider here than in InDesign.
  let trackSum = 0;
  let trackLen = 0;
  const weightsSeen = new Set<boolean>();

  const paragraphs = asArray(story.ParagraphStyleRange);
  paragraphs.forEach((para, pIdx) => {
    const styleRef = para?.["@_AppliedParagraphStyle"];
    const style = typeof styleRef === "string" ? paraStyles.get(styleRef) : undefined;
    const j = JUSTIFY[para?.["@_Justification"]] ?? (style?.justification ? JUSTIFY[style.justification] : undefined);
    if (j && pIdx === 0) align = j;
    if (pIdx > 0) text += "\n";
    for (const run of asArray(para?.CharacterStyleRange)) {
      // Content may be a string, an array (Br-separated), or absent.
      const contents = asArray(run?.Content).map((c: unknown) => (typeof c === "string" || typeof c === "number" ? String(c) : ""));
      let runText = contents.join("\n");
      // All-caps is display styling in InDesign — the stored text keeps the
      // typed case, so apply it here or the render loses the styling.
      const cap = typeof run?.["@_Capitalization"] === "string" ? run["@_Capitalization"] : style?.capitalization;
      if (cap && cap !== "Normal" && /caps/i.test(cap)) runText = runText.toUpperCase();
      text += runText;
      const len = runText.replace(/\s/g, "").length;
      if (len > 0) {
        const rt = Number(run?.["@_Tracking"]);
        const t = Number.isFinite(rt) && run?.["@_Tracking"] !== undefined ? rt : (style?.tracking ?? 0);
        trackSum += t * len;
        trackLen += len;
        // An explicit run FontStyle overrides its character style: "Search"
        // can be Regular inside a paragraph whose character style is N2 Bold.
        const runCharStyle = typeof run?.["@_AppliedCharacterStyle"] === "string" ? run["@_AppliedCharacterStyle"] : "";
        const runBold =
          typeof run?.["@_FontStyle"] === "string"
            ? BOLD_HINT.test(run["@_FontStyle"])
            : BOLD_HINT.test(runCharStyle) || BOLD_HINT.test(style?.fontStyle ?? "") || (!!style && BOLD_HINT.test(style.name));
        weightsSeen.add(runBold);
      }
      if (len > best.len) {
        const size = Number(run?.["@_PointSize"]);
        const fillRef = run?.["@_FillColor"];
        const runFontStyle = typeof run?.["@_FontStyle"] === "string" ? run["@_FontStyle"] : undefined;
        const applied = run?.Properties?.AppliedFont;
        const appliedName = typeof applied === "object" ? applied?.["#text"] : applied;
        const effFontStyle = runFontStyle ?? style?.fontStyle ?? "";
        const runTracking = Number(run?.["@_Tracking"]);
        best = {
          len,
          fontSize: Number.isFinite(size) && size > 0 ? size : (style?.pointSize ?? 12),
          bold: BOLD_HINT.test(effFontStyle) || (!!style && BOLD_HINT.test(style.name)),
          // Tracking (thousandths of an em) decides whether a line fits the
          // designer's frame: body copy at -25 is ~2.5% narrower than untracked.
          tracking: Number.isFinite(runTracking) && run?.["@_Tracking"] !== undefined ? runTracking : (style?.tracking ?? 0),
          color: typeof fillRef === "string" ? colors.get(fillRef) : undefined,
          font: normalizeFontFamily(
            (typeof appliedName === "string" ? appliedName : undefined) ?? style?.font,
          ),
        };
      }
    }
  });

  // IDML uses U+2028/U+2029 as forced line/paragraph separators.
  const trimmed = text.replace(/[\u2028\u2029]/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!trimmed) return null;
  return {
    text: trimmed,
    fontSize: best.fontSize,
    bold: best.bold,
    tracking: trackLen > 0 ? trackSum / trackLen : best.tracking,
    mixedWeights: weightsSeen.size > 1,
    color: best.color,
    align,
    fontFamily: best.font,
  };
}

/** Basename of an IDML LinkResourceURI (file:/Users/.../Links/hero%20image.png). */
function linkBasename(uri: unknown): string | null {
  if (typeof uri !== "string" || !uri) return null;
  try {
    const decoded = decodeURIComponent(uri);
    const parts = decoded.split(/[\\/]/);
    return parts[parts.length - 1] || null;
  } catch {
    const parts = uri.split(/[\\/]/);
    return parts[parts.length - 1] || null;
  }
}

/** Compose two ItemTransform matrices: child coordinates -> parent -> out. */
function compose(parent: Matrix, child: Matrix): Matrix {
  return [
    parent[0] * child[0] + parent[2] * child[1],
    parent[1] * child[0] + parent[3] * child[1],
    parent[0] * child[2] + parent[2] * child[3],
    parent[1] * child[2] + parent[3] * child[3],
    parent[0] * child[4] + parent[2] * child[5] + parent[4],
    parent[1] * child[4] + parent[3] * child[5] + parent[5],
  ];
}

/** Item opacity from its BlendingSetting (InDesign percentages). Blend modes
 * other than Normal can't be reproduced; opacity is the closest stand-in. */
function itemOpacity(item: Record<string, any>): { opacity?: number; feathered: boolean; blended: boolean } {
  const ts = item?.TransparencySetting;
  const blend = ts?.BlendingSetting;
  const raw = Number(blend?.["@_Opacity"]);
  const mode = blend?.["@_BlendMode"];
  const feathered = ts?.GradientFeatherSetting?.["@_Applied"] === "true" || !!ts?.GradientFeatherSetting;
  const blended = typeof mode === "string" && mode !== "Normal";
  if (Number.isFinite(raw) && raw >= 0 && raw < 100) {
    return { opacity: raw / 100, feathered, blended };
  }
  return { opacity: blended ? 0.85 : undefined, feathered, blended };
}

/** A group that is the vector pōhutukawa lockup: a paper-white tile plus a
 * cluster of small coloured polygons (anther, waves, leaves). */
function isLogoGroup(group: Record<string, any>, colors: Map<string, string>): Record<string, any> | null {
  const rects = asArray(group?.Rectangle);
  const polys = asArray(group?.Polygon);
  const whiteTile = rects.find((r) => {
    const fill = typeof r?.["@_FillColor"] === "string" ? colors.get(r["@_FillColor"]) : undefined;
    return fill && fill.toLowerCase() === "#ffffff";
  });
  const colouredPolys = polys.filter((p) => typeof p?.["@_FillColor"] === "string" && colors.get(p["@_FillColor"]));
  return whiteTile && colouredPolys.length >= 3 ? whiteTile : null;
}

interface WalkVisit {
  kind: string;
  item: Record<string, any>;
  /** Transform composed through all ancestor groups. */
  matrix: Matrix;
  layer: string | null;
  logoTile?: Record<string, any>;
}

/** Depth-first walk of a spread's page items, compounding group transforms
 * and inheriting the group's layer. Logo-lockup groups are emitted as a
 * single `Group` visit carrying the tile, not flattened into fragments. */
function walkItems(
  node: Record<string, any>,
  colors: Map<string, string>,
  visit: (v: WalkVisit) => void,
  parentMatrix: Matrix = IDENTITY,
  parentLayer: string | null = null,
): void {
  const KINDS = ["Rectangle", "Oval", "Polygon", "TextFrame", "GraphicLine", "Group"];
  for (const kind of KINDS) {
    for (const item of asArray(node?.[kind])) {
      const layer = typeof item?.["@_ItemLayer"] === "string" ? item["@_ItemLayer"] : parentLayer;
      if (item?.["@_Visible"] === "false") continue;
      if (kind === "Group") {
        const groupMatrix = compose(parentMatrix, parseMatrix(item["@_ItemTransform"]));
        const tile = isLogoGroup(item, colors);
        if (tile) {
          visit({ kind: "Group", item, matrix: groupMatrix, layer, logoTile: tile });
        } else {
          walkItems(item, colors, visit, groupMatrix, layer);
        }
      } else {
        visit({ kind, item, matrix: parentMatrix, layer });
      }
    }
  }
}

/** One spread of a multi-variant document, parsed to a layout. */
export interface IdmlSpreadLayout extends IdmlParseResult {
  /** Variant label inferred from the spread's copy or main image (e.g. "Storms"). */
  label: string | null;
  /** 0-based index of the spread in the document — document PDF page = index + 1.
   *  (Empty spreads are skipped from the results but still occupy a PDF page.) */
  spreadIndex: number;
}

/** Hazard/variant words looked for in a spread's copy to name the variant.
 * Copy is squashed to letters only first, so display-styled fragments like
 * the digital-clock headline "St:OR:MS" still read as "storms". */
const VARIANT_WORD_RE =
  /(storms?|quakes?|earthquakes?|tsunamis?|floods?|flooding|volcano(?:es)?|wildfires?|fires?|drought|landslides?|pandemics?)/;

/** Merge adjacent rasterRegion fragments (one per vector shape) into whole
 * regions — a pattern band or logo lockup is hundreds of tiny shapes but ONE
 * crop from the document PDF. Fragments may only merge with fragments from
 * the same InDesign layer. Without that boundary, nearby artwork from two
 * layers becomes one composite PDF crop and reappears in WIP as a duplicated
 * "decoration" artifact. Mutates `elements`: the first fragment of each
 * cluster becomes the union box, the rest (and any plain rects from the same
 * layer living fully inside a cluster) are removed.
 * Returns the number of merged regions. */
function mergeRasterRegions(elements: Record<string, unknown>[], pad = 8): number {
  const idx: number[] = [];
  elements.forEach((e, i) => {
    // Photo-frame fallbacks are whole regions already; merging one with the
    // band or lockup fragments touching it would glue the slots together.
    if (e.type === "rasterRegion" && !e.photoFallback) idx.push(i);
  });
  if (idx.length === 0) return 0;
  const parent = idx.map((_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const box = (i: number) => elements[idx[i]] as { x: number; y: number; w: number; h: number; layerName?: string };
  const sameLayer = (a: ReturnType<typeof box>, b: ReturnType<typeof box>): boolean =>
    typeof a.layerName === "string" && a.layerName.length > 0 && a.layerName === b.layerName;
  for (let a = 0; a < idx.length; a++) {
    for (let b = a + 1; b < idx.length; b++) {
      const A = box(a);
      const B = box(b);
      if (
        sameLayer(A, B) &&
        A.x - pad < B.x + B.w + pad &&
        B.x - pad < A.x + A.w + pad &&
        A.y - pad < B.y + B.h + pad &&
        B.y - pad < A.y + A.h + pad
      ) {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[rb] = ra;
      }
    }
  }
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < idx.length; i++) {
    const root = find(i);
    const list = clusters.get(root) ?? [];
    list.push(i);
    clusters.set(root, list);
  }
  const remove = new Set<number>();
  const unionBoxes: { x: number; y: number; w: number; h: number; layerName?: string }[] = [];
  for (const members of clusters.values()) {
    const keep = Math.min(...members.map((m) => idx[m]));
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const m of members) {
      const b = box(m);
      x1 = Math.min(x1, b.x);
      y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.w);
      y2 = Math.max(y2, b.y + b.h);
      if (idx[m] !== keep) remove.add(idx[m]);
    }
    const layerName = box(members[0]).layerName;
    const union = { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1), ...(layerName ? { layerName } : {}) };
    Object.assign(elements[keep], union);
    unionBoxes.push(union);
  }
  // Plain rects wholly inside a merged region are fragments of the same
  // vector art (the crop already contains them) — drawing them again on top
  // would double the art.
  elements.forEach((e, i) => {
    if (e.type !== "rect" || remove.has(i)) return;
    const r = e as unknown as { x: number; y: number; w: number; h: number; layerName?: string };
    for (const u of unionBoxes) {
      if (r.layerName === u.layerName && r.x >= u.x - 1 && r.y >= u.y - 1 && r.x + r.w <= u.x + u.w + 1 && r.y + r.h <= u.y + u.h + 1) {
        remove.add(i);
        return;
      }
    }
  });
  for (let i = elements.length - 1; i >= 0; i--) {
    if (remove.has(i)) elements.splice(i, 1);
  }
  return unionBoxes.length;
}

/**
 * Parse EVERY spread of the document — real campaign masters carry one
 * message variant per page (e.g. Storms / Quakes / Tsunami), and each
 * becomes its own template.
 */
export async function parseIdmlToLayouts(
  idml: JSZip,
  linksByName: Map<string, { objectPath: string; kind: string }>,
  brandLogoUrl: string | null = null,
): Promise<IdmlSpreadLayout[]> {
  // trimValues:false — a run that starts with a space (" layouts" after a bold
  // "Search") must keep it, or words fuse across style changes.
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: false });

  const readXml = async (path: string): Promise<Record<string, any> | null> => {
    const entry = idml.file(path);
    if (!entry) return null;
    try {
      return parser.parse(await entry.async("string"));
    } catch {
      return null;
    }
  };

  // Colours and paragraph styles (real documents keep typography in styles).
  const colors = buildColorTable(await readXml("Resources/Graphic.xml"));
  const paraStyles = buildParaStyleTable(await readXml("Resources/Styles.xml"));

  const designMap = await readXml("designmap.xml");

  // Layer visibility: items on hidden layers (guides, backups) are skipped.
  const hiddenLayers = new Set<string>();
  const layerNames = new Map<string, string>();
  for (const layer of asArray(designMap?.Document?.Layer)) {
    if (typeof layer?.["@_Self"] === "string" && typeof layer?.["@_Name"] === "string") {
      layerNames.set(layer["@_Self"], layer["@_Name"].trim());
    }
    if (layer?.["@_Visible"] === "false" && typeof layer?.["@_Self"] === "string") {
      hiddenLayers.add(layer["@_Self"]);
    }
  }
  const semanticLayer = (layerRef: string | null): string | null => {
    const name = layerRef ? layerNames.get(layerRef) : undefined;
    if (!name) return null;
    return name.replace(/^art\s*[:_/-]\s*/i, "").trim().toLowerCase();
  };
  const layerMetadata = (layerRef: string | null): Record<string, string> => {
    const layerName = layerRef ? layerNames.get(layerRef) : undefined;
    if (!layerName) return {};
    const key = semanticLayer(layerRef);
    const slots: Record<string, string> = {
      hero: "photo",
      photo: "photo",
      headline: "headline",
      subheadline: "subheadline",
      subhead: "subheadline",
      body: "message",
      message: "message",
      cta: "cta",
      logo: "logo",
      lockup: "lockup",
    };
    return { layerName, ...(key && slots[key] ? { slot: slots[key] } : {}) };
  };
  const spreadRefs = asArray(designMap?.Document?.["idPkg:Spread"]).map((s: any) => s?.["@_src"]).filter(Boolean);
  if (spreadRefs.length === 0) {
    throw new Error("IDML has no spreads");
  }

  // Preload stories for text frames (document-wide, shared across spreads).
  const storyRefs = asArray(designMap?.Document?.["idPkg:Story"]).map((s: any) => s?.["@_src"]).filter(Boolean);
  const storyCache = new Map<string, StoryText | null>();
  for (const ref of storyRefs) {
    const xml = await readXml(ref);
    const story = xml?.["idPkg:Story"]?.Story ?? xml?.Story;
    const self = story?.["@_Self"];
    if (typeof self === "string" && xml) {
      storyCache.set(self, parseStory(xml, colors, paraStyles));
    }
  }

  const results: IdmlSpreadLayout[] = [];
  const spreadErrors: string[] = [];

  for (let spreadIdx = 0; spreadIdx < spreadRefs.length; spreadIdx++) {
  const warnings: string[] = [];
  const spreadXml = await readXml(spreadRefs[spreadIdx]);
  const spread = spreadXml?.["idPkg:Spread"]?.Spread ?? spreadXml?.Spread;
  if (!spread) {
    spreadErrors.push(`Spread ${spreadIdx + 1} could not be read`);
    continue;
  }

  // Page geometry: bounds are [top left bottom right] in page space; the
  // page's ItemTransform maps them into spread space.
  const pages = asArray(spread.Page);
  if (pages.length === 0) {
    spreadErrors.push(`Spread ${spreadIdx + 1} has no pages`);
    continue;
  }
  const page = pages[0];
  if (pages.length > 1) warnings.push(`Spread ${spreadIdx + 1} has ${pages.length} pages; only the first was imported.`);
  const gb = String(page?.["@_GeometricBounds"] ?? "").trim().split(/\s+/).map(Number);
  if (gb.length !== 4 || !gb.every(Number.isFinite)) {
    spreadErrors.push(`Spread ${spreadIdx + 1} page bounds unreadable`);
    continue;
  }
  const [top, left, bottom, right] = gb;
  const pm = parseMatrix(page?.["@_ItemTransform"]);
  const [pageX, pageY] = apply(pm, left, top);
  const pageW = right - left;
  const pageH = bottom - top;

  let elements: Record<string, unknown>[] = [];
  let idCounter = 0;
  let unmatchedImages = 0;
  let rotatedItems = 0;
  let featheredItems = 0;
  let blendedItems = 0;
  // Largest placed image's original link name, used to label the variant
  // when the copy doesn't name it. (Object holder: assigned inside the
  // walker closure, which TS's narrowing can't see.)
  const mainImage: { name: string | null; area: number } = { name: null, area: 0 };

  walkItems(spread, colors, ({ kind, item, matrix, layer, logoTile }) => {
    if (layer && hiddenLayers.has(layer)) return;
    const sourceLayer = layerMetadata(layer);
    const sourceLayerRole = semanticLayer(layer);
    // The logo lockup group imports as ONE brand-logo image at its tile.
    const boundsSource = logoTile ?? item;
    const bounds = itemBounds(boundsSource, matrix);
    if (!bounds) return;
    const x = bounds.x - pageX;
    const y = bounds.y - pageY;
    // Skip items entirely off the first page (pasteboard or other pages).
    if (x + bounds.w < -2 || y + bounds.h < -2 || x > pageW + 2 || y > pageH + 2) return;

    const m = parseMatrix(item["@_ItemTransform"]);
    if (Math.abs(m[1]) > 0.001 || Math.abs(m[2]) > 0.001) rotatedItems++;

    const { opacity, feathered, blended } = itemOpacity(item);
    if (feathered) featheredItems++;
    if (blended) blendedItems++;

    if (logoTile) {
      if (brandLogoUrl) {
        // The logo asset IS the master tile (mark on white with clearspace
        // baked in): drawn as-is at the designer's tile position — never
        // wrapped in another box, inset, or moved.
        elements.push({
          ...sourceLayer,
          ...liquidOf(item),
          id: `idml_logo_${idCounter++}`,
          type: "image",
          role: "logo",
          slot: "logo",
          src: brandLogoUrl,
          fit: "contain",
          x,
          y,
          w: Math.max(1, bounds.w),
          h: Math.max(1, bounds.h),
          locked: true,
        });
        warnings.push("Vector pōhutukawa lockup imported as the master logo tile at the designer's position.");
      }
      return;
    }

    if (kind === "TextFrame") {
      const storySelf = item?.["@_ParentStory"];
      const story = typeof storySelf === "string" ? storyCache.get(storySelf) : null;
      if (!story) return;
      const roleGuess =
        sourceLayerRole === "headline" ? "headline" :
        sourceLayerRole === "subheadline" || sourceLayerRole === "subhead" ? "subhead" :
        sourceLayerRole === "body" || sourceLayerRole === "message" ? "body" :
        sourceLayerRole === "cta" ? "cta" :
        story.fontSize >= 30 ? "headline" : story.fontSize >= 18 ? "subhead" : "body";
      // InDesign auto-sized frames hug the cap height: frame top = cap top,
      // frame bottom = baseline. Flag them so the renderer sets the first
      // baseline at the frame bottom instead of CSS line-box maths.
      const capFit =
        !story.text.includes("\n") &&
        bounds.h > story.fontSize * 0.45 &&
        bounds.h < story.fontSize * 1.05;
      // Text boxes are layout guides, not clips. Our font metrics differ from
      // InDesign's by a percent or two (mixed-weight runs collapse to one
      // weight here), which is enough to wrap a line the designer set on one
      // line. Give the box 2% grace on the side its alignment grows toward.
      const grace = bounds.w * (story.mixedWeights ? 0.08 : 0.02);
      const boxX = story.align === "center" ? x - grace / 2 : story.align === "right" ? x - grace : x;
      const letterSpacing = story.tracking ? Math.round((story.tracking / 1000) * story.fontSize * 100) / 100 : 0;
      elements.push({
        ...sourceLayer,
        ...liquidOf(item),
        ...(capFit ? { baselineFit: "cap" } : {}),
        id: `idml_txt_${idCounter++}`,
        type: "text",
        role: roleGuess,
        text: story.text,
        x: boxX,
        y,
        w: Math.max(1, bounds.w + grace),
        h: Math.max(1, bounds.h),
        fontSize: Math.round(story.fontSize),
        fontWeight: story.bold ? 700 : 400,
        ...(letterSpacing ? { letterSpacing } : {}),
        color: story.color ?? "#111827",
        align: story.align,
        lineHeight: 1.2,
        ...(story.fontFamily ? { fontFamily: story.fontFamily } : {}),
        ...(opacity !== undefined ? { opacity } : {}),
      });
      return;
    }

    // Placed image inside a frame?
    const placed = [...asArray(item?.Image), ...asArray(item?.PDF), ...asArray(item?.EPS)];
    if (placed.length > 0 && (kind === "Oval" || kind === "Polygon")) {
      // A photo masked by a shaped frame (koru, circle, custom path) cannot be
      // expressed as a rectangular image element — the render would show the
      // square photo. Reproduce the frame from the document PDF instead.
      elements.push({
        ...sourceLayer,
        ...liquidOf(item),
        id: `idml_img_${idCounter++}`,
        type: "rasterRegion",
        photoFallback: true,
        maskedFrame: true,
        x,
        y,
        w: Math.max(1, bounds.w),
        h: Math.max(1, bounds.h),
        ...(opacity !== undefined ? { opacity } : {}),
      });
      return;
    }
    if (placed.length > 0) {
      const link = placed[0]?.Link;
      const name = linkBasename(link?.["@_LinkResourceURI"]);
      const match =
        (name && linksByName.get(name)) ||
        // Converted links change extension (.tif -> .png): match on the stem.
        (name &&
          [...linksByName.entries()].find(([k]) => k.replace(/\.[^.]+$/, "") === name.replace(/\.[^.]+$/, ""))?.[1]);
      if (match && match.kind === "image") {
        if (name && bounds.w * bounds.h > mainImage.area) {
          mainImage.area = bounds.w * bounds.h;
          mainImage.name = name;
        }
        // The designer's crop inside the frame: the placed image's own
        // transform says which window of the photo shows. Emit it as a
        // fractional srcRect; the importer pre-crops the stored asset so
        // every consumer (render, adapt, editor) sees exactly that window.
        let srcRect: { x: number; y: number; w: number; h: number } | undefined;
        const gbx = placed[0]?.Properties?.GraphicBounds;
        const gL = Number(gbx?.["@_Left"]);
        const gT = Number(gbx?.["@_Top"]);
        const gR = Number(gbx?.["@_Right"]);
        const gB = Number(gbx?.["@_Bottom"]);
        if ([gL, gT, gR, gB].every(Number.isFinite) && gR > gL && gB > gT) {
          const contentM = composeForBounds(
            composeForBounds(matrix, parseMatrix(item["@_ItemTransform"])),
            parseMatrix(placed[0]?.["@_ItemTransform"]),
          );
          const pts = [
            apply(contentM, gL, gT),
            apply(contentM, gR, gT),
            apply(contentM, gL, gB),
            apply(contentM, gR, gB),
          ];
          const cx = Math.min(...pts.map((p) => p[0])) - pageX;
          const cy = Math.min(...pts.map((p) => p[1])) - pageY;
          const cw = Math.max(...pts.map((p) => p[0])) - pageX - cx;
          const ch = Math.max(...pts.map((p) => p[1])) - pageY - cy;
          if (cw > 1 && ch > 1) {
            const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
            const rx = clamp01((x - cx) / cw);
            const ry = clamp01((y - cy) / ch);
            const rw = clamp01(bounds.w / cw);
            const rh = clamp01(bounds.h / ch);
            // Only meaningful when the frame actually windows the image.
            if (rw < 0.985 || rh < 0.985) srcRect = { x: rx, y: ry, w: Math.max(0.01, rw), h: Math.max(0.01, rh) };
          }
        }
        elements.push({
          ...sourceLayer,
          ...liquidOf(item),
          id: `idml_img_${idCounter++}`,
          type: "image",
          role: sourceLayerRole === "logo" ? "logo" : sourceLayerRole === "decoration" ? "decoration" : "product",
          src: `/api/storage${match.objectPath}`,
          fit: "cover",
          x,
          y,
          w: Math.max(1, bounds.w),
          h: Math.max(1, bounds.h),
          ...(srcRect ? { srcRect } : {}),
          ...(opacity !== undefined ? { opacity } : {}),
        });
      } else {
        // No usable Links file (missing, or too large to inflate): keep the
        // frame as a region the importer crops from the document PDF — the
        // designer's own pixels — instead of dropping the photo outright.
        unmatchedImages++;
        if (name && bounds.w * bounds.h > mainImage.area) {
          mainImage.area = bounds.w * bounds.h;
          mainImage.name = name;
        }
        elements.push({
          ...sourceLayer,
          ...liquidOf(item),
          id: `idml_img_${idCounter++}`,
          type: "rasterRegion",
          photoFallback: true,
          x,
          y,
          w: Math.max(1, bounds.w),
          h: Math.max(1, bounds.h),
          ...(opacity !== undefined ? { opacity } : {}),
        });
      }
      return;
    }

    const fillRef = item?.["@_FillColor"];
    const fill = typeof fillRef === "string" ? colors.get(fillRef) : undefined;
    const strokeRefRaw = item?.["@_StrokeColor"];
    const hasStroke =
      typeof strokeRefRaw === "string" && !!colors.get(strokeRefRaw) && Number(item?.["@_StrokeWeight"]) > 0;

    // Non-rectangular vector art (koru patterns, lockups, outlined type,
    // the anther device) can't be recreated as live shapes — mark the region
    // so the importer reproduces it from the original document PDF's pixels.
    if (kind === "Polygon" || kind === "Oval" || kind === "GraphicLine") {
      if (fill || hasStroke) {
        elements.push({
          ...sourceLayer,
          ...liquidOf(item),
          id: `idml_raster_${idCounter++}`,
          type: "rasterRegion",
          x,
          y,
          w: Math.max(1, bounds.w),
          h: Math.max(1, bounds.h),
        });
      }
      return;
    }

    // Plain filled shape — with a real linear gradient when the design used
    // a gradient feather (e.g. a scrim fading over photography).
    if (fill) {
      const feather = item?.TransparencySetting?.GradientFeatherSetting;
      let gradient: { angle: number; stops: { color: string; alpha: number; at: number }[] } | undefined;
      if (feather) {
        const rawStops = asArray(feather?.OpacityGradientStop)
          .map((s: any) => ({ opacity: Number(s?.["@_Opacity"]), at: Number(s?.["@_Location"]) }))
          .filter((s) => Number.isFinite(s.opacity) && Number.isFinite(s.at))
          .sort((a, b) => a.at - b.at);
        const startRaw = String(feather?.["@_GradientStart"] ?? "").trim().split(/\s+/).map(Number);
        const angleDeg = Number(feather?.["@_Angle"]);
        if (rawStops.length >= 2 && startRaw.length === 2 && Number.isFinite(angleDeg)) {
          const own = composeForBounds(matrix, parseMatrix(item["@_ItemTransform"]));
          const rad = (angleDeg * Math.PI) / 180;
          // Direction of the feather axis in page space (linear part only).
          let dx = own[0] * Math.cos(rad) + own[2] * Math.sin(rad);
          let dy = own[1] * Math.cos(rad) + own[3] * Math.sin(rad);
          // Orient the axis from the gradient's start point into the shape.
          const [sx, sy] = apply(own, startRaw[0], startRaw[1]);
          const cx = bounds.x + bounds.w / 2;
          const cy = bounds.y + bounds.h / 2;
          if (dx * (cx - sx) + dy * (cy - sy) < 0) {
            dx = -dx;
            dy = -dy;
          }
          // CSS: 0deg points up, angles run clockwise.
          const cssAngle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
          const baseAlpha = opacity ?? 1;
          gradient = {
            angle: cssAngle,
            stops: rawStops.slice(0, 4).map((s) => ({
              color: fill,
              alpha: (s.opacity / 100) * baseAlpha,
              at: Math.max(0, Math.min(1, s.at / 100)),
            })),
          };
        }
      }
      // Rounded corners (the search pill, buttons): uniform legacy attr or
      // the per-corner options — use the smallest applied radius.
      const corners = ["TopLeft", "TopRight", "BottomLeft", "BottomRight"].map((c) => {
        const opt = item?.[`@_${c}CornerOption`];
        const r = Number(item?.[`@_${c}CornerRadius`]);
        return typeof opt === "string" && /rounded/i.test(opt) && Number.isFinite(r) && r > 0 ? r : 0;
      });
      let radius = corners.every((r) => r > 0) ? Math.min(...corners) : 0;
      if (radius === 0) {
        const uniOpt = item?.["@_CornerOption"];
        const uniR = Number(item?.["@_CornerRadius"]);
        if (typeof uniOpt === "string" && /rounded/i.test(uniOpt) && Number.isFinite(uniR) && uniR > 0) radius = uniR;
      }
      elements.push({
        ...sourceLayer,
        ...liquidOf(item),
        id: `idml_rect_${idCounter++}`,
        type: "rect",
        fill,
        x,
        y,
        w: Math.max(1, bounds.w),
        h: Math.max(1, bounds.h),
        ...(radius > 0 ? { radius } : {}),
        ...(gradient ? { gradient } : opacity !== undefined ? { opacity } : {}),
      });
      return;
    }
  });

  if (unmatchedImages > 0) {
    warnings.push(`${unmatchedImages} placed image(s) had no usable Links file (missing or too large) and were reproduced from the document PDF instead.`);
  }
  if (rotatedItems > 0) {
    warnings.push(`${rotatedItems} rotated item(s) were imported axis-aligned (rotation is not yet supported).`);
  }
  // Collapse the vector-art debris into whole regions to crop from the PDF.
  const clusterCount = mergeRasterRegions(elements);
  if (clusterCount > 0) {
    warnings.push(`${clusterCount} vector-art region(s) reproduced from the original document's pixels.`);
  }
  if (featheredItems > 0 || blendedItems > 0) {
    warnings.push(
      "Some elements use blend modes or gradient fades; they were approximated with flat opacity — check panels over photography.",
    );
  }
  if (elements.length === 0) {
    spreadErrors.push(`Spread ${spreadIdx + 1} had no importable items`);
    continue;
  }

  // Variant label: hazard word hidden in the copy (letters-only squash catches
  // display-styled fragments), else the main image's filename stem.
  const squashed = elements
    .filter((e) => e.type === "text")
    .map((e) => String(e.text ?? ""))
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  let label: string | null = null;
  const wordHit = squashed.match(VARIANT_WORD_RE)?.[1];
  if (wordHit) {
    label = wordHit[0].toUpperCase() + wordHit.slice(1);
  } else if (mainImage.name) {
    const stem = mainImage.name
      .replace(/\.[^.]+$/, "")
      .replace(/[_\-()]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    label = stem ? stem.slice(0, 30) : null;
  }
  if (spreadRefs.length > 1 && !label) label = `Page ${spreadIdx + 1}`;

  results.push({ width: Math.round(pageW), height: Math.round(pageH), elements, warnings, label, spreadIndex: spreadIdx });
  }

  if (results.length === 0) {
    throw new Error(spreadErrors[0] ?? "No importable items found");
  }
  for (const err of spreadErrors) results[0].warnings.push(err);
  return results;
}

/** Back-compat single-layout parse: the first spread of the document. */
export async function parseIdmlToLayout(
  idml: JSZip,
  linksByName: Map<string, { objectPath: string; kind: string }>,
  brandLogoUrl: string | null = null,
): Promise<IdmlParseResult> {
  const all = await parseIdmlToLayouts(idml, linksByName, brandLogoUrl);
  return all[0];
}
