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

  return html;
}
