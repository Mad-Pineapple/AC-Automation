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
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";

export interface StrippedPdf {
  bytes: Buffer;
  /** Text objects removed across all pages (page content + form XObjects). */
  removed: number;
  /** Per page (0-based): image XObjects carrying a soft mask. InDesign exports
   *  type effects (outer glow, drop shadow) this way, and those survive text
   *  stripping as a faint ghost of the copy. */
  softMaskedImages: number[];
}

const TEXT_OBJECT = /\bBT\b[\s\S]*?\bET\b/g;

function stripFrom(raw: Uint8Array): { out: Buffer; n: number } {
  const s = Buffer.from(raw).toString("latin1");
  let n = 0;
  const out = s.replace(TEXT_OBJECT, () => {
    n++;
    return "";
  });
  return { out: Buffer.from(out, "latin1"), n };
}

export async function stripPdfText(input: Buffer): Promise<StrippedPdf> {
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context;
  let removed = 0;
  const softMaskedImages: number[] = [];

  const rewrite = (stream: PDFRawStream): PDFRawStream | null => {
    let raw: Uint8Array;
    try {
      raw = decodePDFRawStream(stream).decode();
    } catch {
      return null; // unsupported filter: leave the stream as it is
    }
    const { out, n } = stripFrom(raw);
    if (n === 0) return null;
    removed += n;
    const fresh = ctx.flateStream(out);
    const skip = new Set([PDFName.of("Length"), PDFName.of("Filter"), PDFName.of("DecodeParms")]);
    for (const [k, v] of stream.dict.entries()) {
      if (skip.has(k)) continue; // PDFName instances are interned: identity comparison is exact
      fresh.dict.set(k, v);
    }
    return fresh;
  };

  for (const page of doc.getPages()) {
    const contentsRef = page.node.get(PDFName.of("Contents"));
    if (!contentsRef) continue;
    const contents = ctx.lookup(contentsRef);
    const refs = contents instanceof PDFArray ? contents.asArray() : [contentsRef];
    const next = refs.map((ref) => {
      const stream = ctx.lookup(ref);
      if (!(stream instanceof PDFRawStream)) return ref;
      const fresh = rewrite(stream);
      return fresh ? ctx.register(fresh) : ref;
    });
    page.node.set(PDFName.of("Contents"), ctx.obj(next));

    // Transparency groups and placed art are form XObjects and may carry text.
    let smasks = 0;
    const resources = page.node.Resources();
    const xobjects = resources?.get(PDFName.of("XObject"));
    const xdict = xobjects ? ctx.lookup(xobjects) : null;
    if (xdict instanceof PDFDict) {
      for (const [key, ref] of xdict.entries()) {
        const x = ctx.lookup(ref);
        if (!(x instanceof PDFRawStream)) continue;
        const subtype = x.dict.get(PDFName.of("Subtype"));
        if (subtype === PDFName.of("Image")) {
          if (x.dict.has(PDFName.of("SMask"))) smasks++;
          continue;
        }
        if (subtype !== PDFName.of("Form")) continue;
        // Images nested inside a form (transparency group) count too.
        const inner = x.dict.get(PDFName.of("Resources"));
        const innerDict = inner ? ctx.lookup(inner) : null;
        const innerX = innerDict instanceof PDFDict ? innerDict.get(PDFName.of("XObject")) : null;
        const innerXDict = innerX ? ctx.lookup(innerX) : null;
        if (innerXDict instanceof PDFDict) {
          for (const [, iref] of innerXDict.entries()) {
            const ix = ctx.lookup(iref);
            if (ix instanceof PDFRawStream && ix.dict.get(PDFName.of("Subtype")) === PDFName.of("Image") && ix.dict.has(PDFName.of("SMask"))) smasks++;
          }
        }
        const fresh = rewrite(x);
        if (fresh) xdict.set(key, ctx.register(fresh));
      }
    }
    softMaskedImages.push(smasks);
  }

  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  return { bytes, removed, softMaskedImages };
}
