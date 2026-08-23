/**
 * Hero-box detection: where the subject is in a piece of artwork, as a box
 * in image fractions (0..1). Adaptation crops every format's window around
 * this box — a strip takes a slice through the hero, a skyscraper a column.
 *
 * Detection uses sharp's attention strategy (highest-detail region of the
 * image — reliable for product-on-surface shots). Designers can correct the
 * box in the editor; the stored box is always the authority.
 */
import sharp from "sharp";

export interface HeroBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Box size as a fraction of the image's short side. */
const BOX_FRACTION = 0.7;

export async function detectHeroBox(image: Buffer): Promise<HeroBox | null> {
  try {
    const meta = await sharp(image).metadata();
    const imgW = meta.width ?? 0;
    const imgH = meta.height ?? 0;
    if (!imgW || !imgH) return null;
    const side = Math.max(16, Math.round(Math.min(imgW, imgH) * BOX_FRACTION));
    const { info } = await sharp(image)
      .resize(side, side, { fit: "cover", position: sharp.strategy.attention })
      .toBuffer({ resolveWithObject: true });
    // sharp reports the crop translation as negative offsets.
    const left = Math.abs((info as { cropOffsetLeft?: number }).cropOffsetLeft ?? 0);
    const top = Math.abs((info as { cropOffsetTop?: number }).cropOffsetTop ?? 0);
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    return {
      x: clamp01(left / imgW),
      y: clamp01(top / imgH),
      w: clamp01(side / imgW),
      h: clamp01(side / imgH),
    };
  } catch {
    return null;
  }
}
