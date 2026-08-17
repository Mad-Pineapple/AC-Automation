/**
 * Deterministic post-processing for AI-generated HTML5 banners.
 *
 * The LLM produces the layout; this pass guarantees the parts ad servers
 * actually validate, so tagging accuracy never depends on the model:
 *  - `<meta name="ad.size" content="width=X,height=Y">` present in <head>
 *  - industry-standard `clickTag` wiring (CM360/DV360-compatible): a global
 *    `clickTag` variable plus a full-size click layer that opens it
 *  - no external font/stylesheet requests (stripped defensively)
 *
 * Modeled on the dispatched Auckland Council HTML5 creatives (Google Web
 * Designer exports whose exits resolve `clickTag`).
 */

export interface FinalizeOptions {
  width: number;
  height: number;
  /**
   * Master logo tile as a data URI (embedded — ad servers reject external
   * requests). Injected bottom-right on the brand grid: tile = shortest
   * axis / 4, margin = tile / 3, per the AC guidelines.
   */
  logoDataUri?: string;
}

/** Strip markdown code fences the model sometimes wraps output in. */
export function stripCodeFences(html: string): string {
  return html
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/** Remove external font/CSS loads that ad servers reject. */
function stripExternalFontLoads(html: string): string {
  return html
    // @import url(https://fonts...) inside <style> blocks
    .replace(/@import\s+url\([^)]*\)\s*;?/gi, "")
    .replace(/@import\s+["'][^"']*["']\s*;?/gi, "")
    // <link> tags pointing at font/CSS CDNs
    .replace(/<link\b[^>]*href=["']https?:\/\/[^"']*["'][^>]*>/gi, "");
}

const CLICKTAG_SNIPPET = (width: number, height: number) => `
<script type="text/javascript">var clickTag = window.clickTag || "";</script>
<a href="javascript:void(0)" id="clicktag-layer" aria-label="Advertisement"
   style="position:absolute;left:0;top:0;width:${width}px;height:${height}px;z-index:2147483647;display:block;text-decoration:none;background:transparent"
   onclick="if(window.clickTag){window.open(window.clickTag);}return false;"></a>`;

/**
 * Ensure the banner carries correct ad metadata and click wiring.
 * Idempotent: skips each injection when the document already has it.
 */
export function finalizeHtmlBanner(rawHtml: string, opts: FinalizeOptions): string {
  let html = stripExternalFontLoads(stripCodeFences(rawHtml));
  const { width, height } = opts;

  // 1. ad.size meta — replace a wrong one, insert if missing.
  const adSizeMeta = `<meta name="ad.size" content="width=${width},height=${height}">`;
  if (/<meta\s+name=["']ad\.size["'][^>]*>/i.test(html)) {
    html = html.replace(/<meta\s+name=["']ad\.size["'][^>]*>/i, adSizeMeta);
  } else if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n  ${adSizeMeta}`);
  } else {
    html = `${adSizeMeta}\n${html}`;
  }

  // 2. clickTag wiring — only when the creative has none of its own.
  if (!/clickTag/i.test(html)) {
    const snippet = CLICKTAG_SNIPPET(width, height);
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${snippet}\n</body>`);
    } else {
      html = `${html}\n${snippet}`;
    }
  }

  // 3. Master logo tile, bottom-right on the brand grid. Shipped AC HTML5
  // creative (Food Scraps FY26 GWD exports) sizes the mark at roughly a
  // 6-division tile of the shortest axis.
  if (opts.logoDataUri && !/id=["']ac-logo-tile["']/.test(html)) {
    const tile = Math.max(20, Math.round(Math.min(width, height) / 6));
    // Flush to the bottom-right corner: the tile occupies the corner grid
    // cell (the mark's clearspace is the 1/8 padding inside the white box);
    // the 1/3-tile page margin applies to copy, not the tile itself.
    const logoImg = `\n<img id="ac-logo-tile" src="${opts.logoDataUri}" alt="" style="position:absolute;right:0;bottom:0;width:${tile}px;height:${tile}px;object-fit:cover;z-index:2147483000;pointer-events:none">`;
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${logoImg}\n</body>`);
    } else {
      html = `${html}${logoImg}`;
    }
  }

  return html;
}

/**
 * Fetch a brand's logo and return it as a small PNG data URI for embedding
 * in banners. Relative logo URLs resolve against the given origin. Returns
 * undefined on any failure — a banner without a logo beats a failed brief.
 */
export async function fetchLogoDataUri(
  logoUrl: string | null | undefined,
  origin: string,
): Promise<string | undefined> {
  if (!logoUrl) return undefined;
  try {
    const sharp = (await import("sharp")).default;
    const abs = /^https?:\/\//i.test(logoUrl) ? logoUrl : `${origin}${logoUrl}`;
    const res = await fetch(abs);
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    const png = await sharp(buf).resize(240, 240, { fit: "cover" }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return undefined;
  }
}
