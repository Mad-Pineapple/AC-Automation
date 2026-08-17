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

/** Bounds of an item's path geometry, transformed into spread coordinates. */
function itemBounds(item: Record<string, any>): { x: number; y: number; w: number; h: number } | null {
  const m = parseMatrix(item["@_ItemTransform"]);
  const anchors: [number, number][] = [];
  const paths = asArray(item?.Properties?.PathGeometry?.GeometryPathType);
  for (const path of paths) {
    for (const pp of asArray(path?.PathPointArray?.PathPointType)) {
      const a = typeof pp?.["@_Anchor"] === "string" ? pp["@_Anchor"].trim().split(/\s+/).map(Number) : null;
      if (a && a.length === 2 && a.every(Number.isFinite)) {
        anchors.push(apply(m, a[0], a[1]));
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
  color?: string;
  align: "left" | "center" | "right";
  fontFamily?: string;
}

/** Flatten a story's paragraph/character ranges into renderable text + the
 * dominant styling (largest run wins). */
function parseStory(storyXml: Record<string, any>, colors: Map<string, string>): StoryText | null {
  const story = storyXml?.["idPkg:Story"]?.Story ?? storyXml?.Story;
  if (!story) return null;

  let text = "";
  let align: "left" | "center" | "right" = "left";
  let best = { len: 0, fontSize: 12, bold: false, color: undefined as string | undefined, font: undefined as string | undefined };

  const paragraphs = asArray(story.ParagraphStyleRange);
  paragraphs.forEach((para, pIdx) => {
    const j = JUSTIFY[para?.["@_Justification"]];
    if (j && pIdx === 0) align = j;
    if (pIdx > 0) text += "\n";
    for (const run of asArray(para?.CharacterStyleRange)) {
      // Content may be a string, an array (Br-separated), or absent.
      const contents = asArray(run?.Content).map((c: unknown) => (typeof c === "string" || typeof c === "number" ? String(c) : ""));
      const brCount = asArray(run?.Br).length;
      let runText = contents.join("\n");
      if (brCount > 0 && contents.length <= 1) runText = contents.join("") + "\n".repeat(0);
      text += runText;
      const len = runText.replace(/\s/g, "").length;
      if (len > best.len) {
        const size = Number(run?.["@_PointSize"]);
        const fillRef = run?.["@_FillColor"];
        const fontStyle = String(run?.["@_FontStyle"] ?? "");
        const applied = run?.Properties?.AppliedFont;
        const appliedName = typeof applied === "object" ? applied?.["#text"] : applied;
        best = {
          len,
          fontSize: Number.isFinite(size) && size > 0 ? size : 12,
          bold: /bold|black|heavy|semibold|condensed bold/i.test(fontStyle),
          color: typeof fillRef === "string" ? colors.get(fillRef) : undefined,
          font: typeof appliedName === "string" ? appliedName : undefined,
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

/** Depth-first walk of a spread's page items in document (z) order. */
function walkItems(node: Record<string, any>, visit: (kind: string, item: Record<string, any>) => void): void {
  const KINDS = ["Rectangle", "Oval", "Polygon", "TextFrame", "GraphicLine", "Group"];
  for (const kind of KINDS) {
    for (const item of asArray(node?.[kind])) {
      if (kind === "Group") {
        walkItems(item, visit);
      } else {
        visit(kind, item);
        // Nested items (images live inside Rectangles) are visited by the
        // handler itself, not the walker.
      }
    }
  }
}

export async function parseIdmlToLayout(
  idml: JSZip,
  linksByName: Map<string, { objectPath: string; kind: string }>,
): Promise<IdmlParseResult> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const warnings: string[] = [];

  const readXml = async (path: string): Promise<Record<string, any> | null> => {
    const entry = idml.file(path);
    if (!entry) return null;
    try {
      return parser.parse(await entry.async("string"));
    } catch {
      return null;
    }
  };

  // Colours.
  const colors = buildColorTable(await readXml("Resources/Graphic.xml"));

  // First spread listed in the design map.
  const designMap = await readXml("designmap.xml");
  const spreadRefs = asArray(designMap?.Document?.["idPkg:Spread"]).map((s: any) => s?.["@_src"]).filter(Boolean);
  if (spreadRefs.length === 0) {
    throw new Error("IDML has no spreads");
  }
  const spreadXml = await readXml(spreadRefs[0]);
  const spread = spreadXml?.["idPkg:Spread"]?.Spread ?? spreadXml?.Spread;
  if (!spread) throw new Error("IDML spread could not be read");

  // Page geometry: bounds are [top left bottom right] in page space; the
  // page's ItemTransform maps them into spread space.
  const pages = asArray(spread.Page);
  if (pages.length === 0) throw new Error("IDML spread has no pages");
  const page = pages[0];
  if (pages.length > 1) warnings.push(`Document has ${pages.length} pages on the first spread; only the first was imported.`);
  const gb = String(page?.["@_GeometricBounds"] ?? "").trim().split(/\s+/).map(Number);
  if (gb.length !== 4 || !gb.every(Number.isFinite)) throw new Error("IDML page bounds unreadable");
  const [top, left, bottom, right] = gb;
  const pm = parseMatrix(page?.["@_ItemTransform"]);
  const [pageX, pageY] = apply(pm, left, top);
  const pageW = right - left;
  const pageH = bottom - top;

  // Preload stories for text frames.
  const storyByFrame = new Map<string, StoryText>();
  const storyRefs = asArray(designMap?.Document?.["idPkg:Story"]).map((s: any) => s?.["@_src"]).filter(Boolean);
  const storyCache = new Map<string, StoryText | null>();
  for (const ref of storyRefs) {
    const xml = await readXml(ref);
    const story = xml?.["idPkg:Story"]?.Story ?? xml?.Story;
    const self = story?.["@_Self"];
    if (typeof self === "string" && xml) {
      storyCache.set(self, parseStory(xml, colors));
    }
  }

  const elements: Record<string, unknown>[] = [];
  let idCounter = 0;
  let unmatchedImages = 0;
  let rotatedItems = 0;

  walkItems(spread, (kind, item) => {
    const bounds = itemBounds(item);
    if (!bounds) return;
    const x = bounds.x - pageX;
    const y = bounds.y - pageY;
    // Skip items entirely off the first page (pasteboard or other pages).
    if (x + bounds.w < -2 || y + bounds.h < -2 || x > pageW + 2 || y > pageH + 2) return;

    const m = parseMatrix(item["@_ItemTransform"]);
    if (Math.abs(m[1]) > 0.001 || Math.abs(m[2]) > 0.001) rotatedItems++;

    if (kind === "TextFrame") {
      const storySelf = item?.["@_ParentStory"];
      const story = typeof storySelf === "string" ? storyCache.get(storySelf) : null;
      if (!story) return;
      const roleGuess = story.fontSize >= 30 ? "headline" : story.fontSize >= 18 ? "subhead" : "body";
      elements.push({
        id: `idml_txt_${idCounter++}`,
        type: "text",
        role: roleGuess,
        text: story.text,
        x,
        y,
        w: Math.max(1, bounds.w),
        h: Math.max(1, bounds.h),
        fontSize: Math.round(story.fontSize),
        fontWeight: story.bold ? 700 : 400,
        color: story.color ?? "#111827",
        align: story.align,
        lineHeight: 1.2,
        ...(story.fontFamily ? { fontFamily: story.fontFamily } : {}),
      });
      return;
    }

    // Placed image inside a frame?
    const placed = [...asArray(item?.Image), ...asArray(item?.PDF), ...asArray(item?.EPS)];
    if (placed.length > 0) {
      const link = placed[0]?.Link;
      const name = linkBasename(link?.["@_LinkResourceURI"]);
      const match =
        (name && linksByName.get(name)) ||
        // Converted links change extension (.tif -> .png): match on the stem.
        (name &&
          [...linksByName.entries()].find(([k]) => k.replace(/\.[^.]+$/, "") === name.replace(/\.[^.]+$/, ""))?.[1]);
      if (match && match.kind === "image") {
        elements.push({
          id: `idml_img_${idCounter++}`,
          type: "image",
          role: "product",
          src: `/api/storage${match.objectPath}`,
          fit: "cover",
          x,
          y,
          w: Math.max(1, bounds.w),
          h: Math.max(1, bounds.h),
        });
      } else {
        unmatchedImages++;
      }
      return;
    }

    // Plain filled shape.
    const fillRef = item?.["@_FillColor"];
    const fill = typeof fillRef === "string" ? colors.get(fillRef) : undefined;
    if (fill && kind !== "GraphicLine") {
      elements.push({
        id: `idml_rect_${idCounter++}`,
        type: "rect",
        fill,
        x,
        y,
        w: Math.max(1, bounds.w),
        h: Math.max(1, bounds.h),
      });
    }
  });

  if (unmatchedImages > 0) {
    warnings.push(`${unmatchedImages} placed image(s) had no matching Links file and were skipped.`);
  }
  if (rotatedItems > 0) {
    warnings.push(`${rotatedItems} rotated item(s) were imported axis-aligned (rotation is not yet supported).`);
  }
  if (elements.length === 0) {
    throw new Error("No importable items found on the first page");
  }

  return { width: Math.round(pageW), height: Math.round(pageH), elements, warnings };
}
