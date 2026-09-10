/**
 * Google Web Designer banner reconstruction.
 *
 * A GWD working-files zip holds one COMPLETE artwork per banner folder: the
 * layer images plus an index HTML whose CSS records exactly where every layer
 * sits. That means no AI guessing is needed to reassemble the art — we parse
 * the geometry out of the HTML and rebuild the banner as one freeform layout,
 * faithful to the designer's positions (imported creative is reproduced
 * verbatim, never redrawn).
 *
 * Subtlety: the base CSS holds each element's animation START position (often
 * off-canvas for slide-ins). The resting position adds the final keyframe's
 * translate3d offset, so we resolve `.gwd-gen-*animation` classes through
 * their @(?:-webkit-)?keyframes and take the LAST frame's transform.
 */
import JSZip from "jszip";
import sharp from "sharp";
import { ObjectStorageService } from "./objectStorage";
import { enrichLayeredArtwork, storageImageLoader } from "./layeredArtwork";
import { normalizeFreeformConfig, type FreeformConfig } from "./freeform";
import { analyseGwdHtml, type MotionTrack } from "./gwdMotion";

const objectStorageService = new ObjectStorageService();

export interface GwdBannerLayout {
  name: string;
  width: number;
  height: number;
  config: FreeformConfig;
  variant: string | null;
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * The visible-pixel bounds of a transparent layer, when trimming to them
 * meaningfully shrinks the box (>10% on either axis); null otherwise.
 * Layers exported as full-canvas PNGs are mostly transparent padding around
 * a small graphic, which would select as an artwork-sized box in the editor.
 */
export async function visibleBounds(bytes: Buffer): Promise<{ minX: number; minY: number; bw: number; bh: number; W: number; H: number } | null> {
  const meta = await sharp(bytes).metadata();
  if (!meta.hasAlpha || !meta.width || !meta.height) return null;
  const raw = await sharp(bytes).ensureAlpha().raw().toBuffer();
  const W = meta.width, H = meta.height;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      if (raw[(py * W + px) * 4 + 3] > 16) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }
  }
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  if (maxX < 0 || !(bw < W * 0.9 || bh < H * 0.9)) return null;
  return { minX, minY, bw, bh, W, H };
}

/**
 * Reconstruct every GWD banner in the zip. Returns one complete-artwork
 * layout per banner HTML found (gwd_preview copies are skipped). Layer
 * images are uploaded to storage as they are referenced.
 */
export async function reconstructGwdBanners(
  zip: JSZip,
  baseName: string,
): Promise<GwdBannerLayout[]> {
  const layouts: GwdBannerLayout[] = [];
  const htmlEntries = Object.entries(zip.files).filter(
    ([path, f]) =>
      !f.dir &&
      path.endsWith(".html") &&
      !/gwd_preview|preview\.html|__MACOSX/i.test(path),
  );

  for (const [htmlPath, entry] of htmlEntries) {
    const html = await entry.async("text");
    if (!html.includes("gwd-page")) continue;

    const analysis = analyseGwdHtml(html);
    if (!analysis) continue;
    const { width, height } = analysis;
    const dir = htmlPath.slice(0, htmlPath.lastIndexOf("/") + 1);

    const elements: Record<string, unknown>[] = [];
    let i = 0;
    // Every image layer with its RESTING box (the designer's final frame,
    // nested containers composed) and its motion track over the timeline.
    for (const leaf of analysis.leaves) {
      const { relSrc } = leaf;
      const restingOpacity = leaf.opacity;
      // Glyph lettering (single-character images) is kept ONLY as the
      // designer's final frame shows it: layers resting hidden are dropped by
      // the opacity gate below, and stacked cycling states collapse to the
      // topmost visible one in the slot-dedupe pass after this loop.
      if (restingOpacity < 0.1) continue;
      let x = leaf.x;
      let y = leaf.y;
      let w = leaf.w;
      let h = leaf.h;
      const visW = Math.min(x + w, width) - Math.max(x, 0);
      const visH = Math.min(y + h, height) - Math.max(y, 0);
      if (visW < w * 0.4 || visH < h * 0.4) continue;

      const assetPath = (dir + relSrc).replace(/\/\.\//g, "/");
      const assetEntry = zip.file(assetPath) ?? zip.file(relSrc);
      if (!assetEntry) continue;
      const ext = relSrc.split(".").pop()?.toLowerCase() ?? "";
      const contentType = IMAGE_TYPES[ext];
      if (!contentType) continue;
      let bytes: Buffer = Buffer.from(await assetEntry.async("uint8array"));

      // Containers sit flush to their asset: layers exported as full-canvas
      // PNGs are mostly transparent padding around a small graphic, which
      // would select as an artwork-sized box in the editor. Trim each layer
      // to its visible pixels and shift x/y so nothing moves on canvas.
      try {
        const vb = await visibleBounds(bytes);
        if (vb) {
          const dispX = w / vb.W, dispY = h / vb.H;
          bytes = Buffer.from(await sharp(bytes).extract({ left: vb.minX, top: vb.minY, width: vb.bw, height: vb.bh }).png().toBuffer());
          x += vb.minX * dispX;
          y += vb.minY * dispY;
          w = vb.bw * dispX;
          h = vb.bh * dispY;
        }
      } catch { /* un-trimmable image — keep as-is */ }

      const stored = await objectStorageService.uploadBytes(bytes, contentType);

      elements.push({
        id: `gwd_${i++}`,
        type: "image",
        role: "decoration",
        src: `/api/storage${stored}`,
        fit: "cover",
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
        ...(restingOpacity < 1 ? { opacity: Math.round(restingOpacity * 100) / 100 } : {}),
        ...(leaf.motion ? { motion: { ...leaf.motion, w0: Math.round(w), h0: Math.round(h) } satisfies MotionTrack } : {}),
        ...(leaf.groupMotion ? { groupMotion: { ...leaf.groupMotion, w0: Math.round(w), h0: Math.round(h) } satisfies MotionTrack } : {}),
        ...(leaf.ownMotion ? { ownMotion: { ...leaf.ownMotion, w0: Math.round(w), h0: Math.round(h) } satisfies MotionTrack } : {}),
      });
    }

    // Cycling animation slots stack many glyph states in one box even after
    // the opacity gate (several states can rest visible mid-loop). Keep the
    // TOPMOST layer per slot — small elements only, so full-canvas overlays
    // (gradients, text plates) are never touched.
    const kept: typeof elements = [];
    const smallCap = width * height * 0.15;
    for (let a = 0; a < elements.length; a++) {
      const ea = elements[a] as { x: number; y: number; w: number; h: number };
      let covered = false;
      if (ea.w * ea.h < smallCap) {
        for (let b = a + 1; b < elements.length && !covered; b++) {
          const eb = elements[b] as { x: number; y: number; w: number; h: number };
          if (eb.w * eb.h >= smallCap) continue;
          const ix = Math.max(0, Math.min(ea.x + ea.w, eb.x + eb.w) - Math.max(ea.x, eb.x));
          const iy = Math.max(0, Math.min(ea.y + ea.h, eb.y + eb.h) - Math.max(ea.y, eb.y));
          const inter = ix * iy;
          const union = ea.w * ea.h + eb.w * eb.h - inter;
          if (union > 0 && inter / union > 0.75) covered = true;
        }
      }
      if (!covered) kept.push(elements[a]);
    }
    if (kept.length < 2) continue;
    let label = htmlPath
      .replace(/^.*?\//, "")
      .replace(/\/[^/]*$/, "")
      .split("/")
      .filter(Boolean)
      .join(" ")
      .replace(/px$/i, "");
    // A banner html at the zip root has no folder to name it — use the size.
    if (!label || /\.html?$/i.test(label)) label = `${width}×${height}`;
    // Store a runnable copy of the ORIGINAL banner (animation intact): every
    // referenced asset is uploaded and the html rewritten to point at it, so
    // WIP offers a live "Preview" of the real motion alongside the layers.
    let previewHtml: string | undefined;
    try {
      let rewritten = html;
      const uploadedBySrc = new Map<string, string>();
      // Everything the banner references locally: layer images (source=), the
      // GWD runtime scripts (src=) and stylesheets (href=). Without the
      // runtime the custom elements never render and the preview is blank.
      const PREVIEW_TYPES: Record<string, string> = {
        ...IMAGE_TYPES,
        js: "application/javascript",
        css: "text/css",
        svg: "image/svg+xml",
        gif: "image/gif",
        woff: "font/woff",
        woff2: "font/woff2",
      };
      const refs = new Set<string>();
      for (const m of html.matchAll(/(?:source|src|href)="([^"]+)"/g)) {
        const v = m[1];
        if (/^(https?:)?\/\//.test(v) || v.startsWith("data:")) continue;
        refs.add(v);
      }
      for (const rel of refs) {
        const aEntry = zip.file((dir + rel).replace(/\/\.\//g, "/")) ?? zip.file(rel);
        const aExt = rel.split(".").pop()?.toLowerCase() ?? "";
        const aType = PREVIEW_TYPES[aExt];
        if (!aEntry || !aType) continue;
        const aBytes = Buffer.from(await aEntry.async("uint8array"));
        const aStored = await objectStorageService.uploadBytes(aBytes, aType);
        uploadedBySrc.set(rel, `/api/storage${aStored}`);
      }
      for (const [rel, url] of uploadedBySrc) {
        rewritten = rewritten.split(`"${rel}"`).join(`"${url}"`);
      }
      const htmlStored = await objectStorageService.uploadBytes(Buffer.from(rewritten, "utf8"), "text/html");
      previewHtml = `/api/storage${htmlStored}`;
    } catch { /* preview is a bonus — the layers import regardless */ }

    // Recognise the layers (photo, headline glyph run, CTA, panel…) so the
    // stack can be built into other shapes; glyph runs merge into one headline.
    let recognised = kept;
    try {
      const enriched = await enrichLayeredArtwork(
        normalizeFreeformConfig({ kind: "freeform", elements: kept }),
        width,
        height,
        { loadImage: storageImageLoader(), uploadBytes: (bytes, ct) => objectStorageService.uploadBytes(bytes, ct) },
      );
      if (enriched.changed) recognised = enriched.config.elements as unknown as typeof kept;
    } catch {
      /* recognition is an enhancement, never a reason to fail the import */
    }

    layouts.push({
      name: `${baseName} — ${label || `${width}×${height}`}`,
      width,
      height,
      config: normalizeFreeformConfig({ kind: "freeform", elements: recognised, ...(previewHtml ? { previewHtml } : {}) }),
      variant: label || null,
    });
  }

  return layouts;
}
