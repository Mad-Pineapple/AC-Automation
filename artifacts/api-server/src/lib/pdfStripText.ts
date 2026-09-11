/**
 * Text-free copy of a PDF, for cropping artwork regions.
 *
 * InDesign exports keep live type as text objects (`BT … ET`) in the page
 * content streams. When the importer has to reproduce a region from the
 * document PDF's pixels — a shaped photo frame, vector art, a photo whose
 * link was too large — cropping the page as exported bakes any copy that
 * overlaps the region into the crop, and the live text element then draws
 * over a ghost of itself. Removing the text objects first gives a render of
 * the artwork alone. Nothing is invented and no artwork pixel is touched:
 * the type is simply not drawn.
 *
 * Outlined type (converted to paths) is not text and survives — the caller
 * treats `removed === 0` as "this PDF may still carry copy".
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from "pdf-lib";

/** A text frame in PDF page coordinates (origin bottom-left, points). */
export interface TypeFrame { x0: number; y0: number; x1: number; y1: number }

export interface StripOptions {
  /** Per page index: the document's text frames (from the IDML). Filled
   *  vector paths that sit inside one are outlined type and are stripped. */
  typeFrames?: Map<number, TypeFrame[]>;
}

export interface StrippedPdf {
  bytes: Buffer;
  /** Text objects removed across all pages (page content + form XObjects). */
  removed: number;
  /** Per page (0-based): image XObjects carrying a soft mask. InDesign exports
   *  type effects (outer glow, drop shadow) this way, and those survive text
   *  stripping as a faint ghost of the copy. */
  softMaskedImages: number[];
  /** Type-effect images (glow, shadow) whose draw calls were removed. */
  effectsRemoved: number;
  /** Outlined-type path blocks removed (type exported as vector outlines). */
  outlinedRemoved: number;
}

const TEXT_OBJECT = /\bBT\b[\s\S]*?\bET\b/g;

/**
 * Outlined type: InDesign exports a headline whose font it cannot embed as
 * one filled path per line, wrapped `q a b c d tx ty cm … f Q`. Such a
 * block whose bounding box sits inside a text frame from the IDML is the
 * type itself, never artwork, and is removed with the text objects.
 */
const CM_BLOCK = /q\s+(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm([\s\S]*?)\bQ\b/g;
function stripOutlinedType(s: string, frames: TypeFrame[]): { out: string; o: number } {
  if (frames.length === 0) return { out: s, o: 0 };
  let o = 0;
  const out = s.replace(CM_BLOCK, (whole, a, b, c, d, tx, ty, body: string) => {
    if (Number(b) !== 0 || Number(c) !== 0) return whole; // rotated: leave it
    if (/\b(Do|BT)\b/.test(body) || !/\bf\*?\b/.test(body)) return whole;
    const sx = Number(a), sy = Number(d), ox = Number(tx), oy = Number(ty);
    const pts: Array<[number, number]> = [];
    for (const m of body.matchAll(/(-?[\d.]+) (-?[\d.]+) (?:m|l)\b/g)) pts.push([Number(m[1]), Number(m[2])]);
    for (const m of body.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) c\b/g)) pts.push([Number(m[5]), Number(m[6])]);
    for (const m of body.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (?:v|y)\b/g)) pts.push([Number(m[3]), Number(m[4])]);
    if (pts.length < 4) return whole;
    const xs = pts.map((p) => ox + p[0] * sx), ys = pts.map((p) => oy + p[1] * sy);
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
    const tol = 4;
    const inside = frames.some((f) => bx0 >= f.x0 - tol && bx1 <= f.x1 + tol && by0 >= f.y0 - tol && by1 <= f.y1 + tol && (bx1 - bx0) >= (f.x1 - f.x0) * 0.25);
    if (!inside) return whole;
    o++;
    return "";
  });
  return { out, o };
}

function stripFrom(raw: Uint8Array, effectNames: string[] = [], frames: TypeFrame[] = []): { out: Buffer; n: number; e: number; o: number } {
  const s = Buffer.from(raw).toString("latin1");
  let n = 0;
  let e = 0;
  let out = s.replace(TEXT_OBJECT, () => {
    n++;
    return "";
  });
  const outlined = stripOutlinedType(out, frames);
  out = outlined.out;
  const o = outlined.o;
  // Type effects (outer glow, drop shadow) are exported as small soft-masked
  // images drawn where the type sits; dropping their draw calls removes the
  // ghost of the headline the text strip leaves behind.
  for (const name of effectNames) {
    const re = new RegExp(`/${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\s+Do\b`, "g");
    out = out.replace(re, () => { e++; return ""; });
  }
  return { out: Buffer.from(out, "latin1"), n, e, o };
}

/** Pixel area of an image XObject. */
function imageArea(x: PDFRawStream): number {
  const num = (v: unknown): number => (v instanceof PDFNumber ? v.asNumber() : 0);
  return num(x.dict.get(PDFName.of("Width"))) * num(x.dict.get(PDFName.of("Height")));
}

export async function stripPdfText(input: Buffer, options: StripOptions = {}): Promise<StrippedPdf> {
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context;
  let removed = 0;
  const softMaskedImages: number[] = [];

  let effectsRemoved = 0;
  let outlinedRemoved = 0;
  const rewrite = (stream: PDFRawStream, effectNames: string[] = [], frames: TypeFrame[] = []): PDFRawStream | null => {
    let raw: Uint8Array;
    try {
      raw = decodePDFRawStream(stream).decode();
    } catch {
      return null; // unsupported filter: leave the stream as it is
    }
    const { out, n, e, o } = stripFrom(raw, effectNames, frames);
    if (n === 0 && e === 0 && o === 0) return null;
    removed += n;
    effectsRemoved += e;
    outlinedRemoved += o;
    const fresh = ctx.flateStream(out);
    const skip = new Set([PDFName.of("Length"), PDFName.of("Filter"), PDFName.of("DecodeParms")]);
    for (const [k, v] of stream.dict.entries()) {
      if (skip.has(k)) continue; // PDFName instances are interned: identity comparison is exact
      fresh.dict.set(k, v);
    }
    return fresh;
  };

  for (const [pageIndex, page] of doc.getPages().entries()) {
    const contentsRef = page.node.get(PDFName.of("Contents"));
    if (!contentsRef) continue;
    const frames = options.typeFrames?.get(pageIndex) ?? [];

    // Image XObjects on the page and inside its forms. The largest is the
    // photography; soft-masked images well under a quarter of that area are
    // type effects and are stripped with the type. Soft-masked images near
    // the photo's size (a PNG with alpha) are kept and counted.
    const resources = page.node.Resources();
    const xobjects = resources?.get(PDFName.of("XObject"));
    const xdict = xobjects ? ctx.lookup(xobjects) : null;
    const pageImages: Array<{ name: string; area: number; smask: boolean }> = [];
    const formImages = new Map<string, Array<{ name: string; area: number; smask: boolean }>>();
    if (xdict instanceof PDFDict) {
      for (const [key, ref] of xdict.entries()) {
        const x = ctx.lookup(ref);
        if (!(x instanceof PDFRawStream)) continue;
        const subtype = x.dict.get(PDFName.of("Subtype"));
        if (subtype === PDFName.of("Image")) {
          pageImages.push({ name: key.decodeText(), area: imageArea(x), smask: x.dict.has(PDFName.of("SMask")) });
          continue;
        }
        if (subtype !== PDFName.of("Form")) continue;
        const inner = x.dict.get(PDFName.of("Resources"));
        const innerDict = inner ? ctx.lookup(inner) : null;
        const innerX = innerDict instanceof PDFDict ? innerDict.get(PDFName.of("XObject")) : null;
        const innerXDict = innerX ? ctx.lookup(innerX) : null;
        const list: Array<{ name: string; area: number; smask: boolean }> = [];
        if (innerXDict instanceof PDFDict) {
          for (const [ikey, iref] of innerXDict.entries()) {
            const ix = ctx.lookup(iref);
            if (ix instanceof PDFRawStream && ix.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) list.push({ name: ikey.decodeText(), area: imageArea(ix), smask: ix.dict.has(PDFName.of("SMask")) });
          }
        }
        formImages.set(key.decodeText(), list);
      }
    }
    const maxArea = Math.max(0, ...pageImages.map((i) => i.area), ...[...formImages.values()].flat().map((i) => i.area));
    const isEffect = (i: { area: number; smask: boolean }) => i.smask && maxArea > 0 && i.area < maxArea * 0.25;
    const pageEffects = pageImages.filter(isEffect).map((i) => i.name);

    // InDesign splits a page's content into ~12 KB chunks, and a text object
    // can start in one chunk and end in the next. Strip the page as ONE
    // stream, so no `BT … ET` straddling a boundary survives into a crop.
    const contents = ctx.lookup(contentsRef);
    const refs = contents instanceof PDFArray ? contents.asArray() : [contentsRef];
    const decoded: Buffer[] = [];
    let allDecoded = true;
    for (const ref of refs) {
      const stream = ctx.lookup(ref);
      if (!(stream instanceof PDFRawStream)) { allDecoded = false; break; }
      try { decoded.push(Buffer.from(decodePDFRawStream(stream).decode())); } catch { allDecoded = false; break; }
    }
    if (allDecoded && decoded.length > 0) {
      const joined = Buffer.concat(decoded.flatMap((b, i) => (i ? [Buffer.from("\n", "latin1"), b] : [b])));
      const { out, n, e, o } = stripFrom(joined, pageEffects, frames);
      removed += n;
      effectsRemoved += e;
      outlinedRemoved += o;
      const fresh = ctx.flateStream(out);
      page.node.set(PDFName.of("Contents"), ctx.register(fresh));
    } else {
      const next = refs.map((ref) => {
        const stream = ctx.lookup(ref);
        if (!(stream instanceof PDFRawStream)) return ref;
        const fresh = rewrite(stream, pageEffects, frames);
        return fresh ? ctx.register(fresh) : ref;
      });
      page.node.set(PDFName.of("Contents"), ctx.obj(next));
    }

    // Transparency groups and placed art are form XObjects and may carry text
    // and effect images of their own.
    let smasks = pageImages.filter((i) => i.smask && !isEffect(i)).length;
    if (xdict instanceof PDFDict) {
      for (const [key, ref] of xdict.entries()) {
        const x = ctx.lookup(ref);
        if (!(x instanceof PDFRawStream) || x.dict.get(PDFName.of("Subtype")) !== PDFName.of("Form")) continue;
        const list = formImages.get(key.decodeText()) ?? [];
        smasks += list.filter((i) => i.smask && !isEffect(i)).length;
        const fresh = rewrite(x, list.filter(isEffect).map((i) => i.name));
        if (fresh) xdict.set(key, ctx.register(fresh));
      }
    }
    softMaskedImages.push(smasks);
  }

  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  return { bytes, removed, softMaskedImages, effectsRemoved, outlinedRemoved };
}
