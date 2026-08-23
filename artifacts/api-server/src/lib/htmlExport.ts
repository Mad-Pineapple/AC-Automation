/**
 * HTML5 ad package exporter — freeform template → self-contained creative.
 *
 * Deterministic (no AI): every element is written as absolutely-positioned
 * HTML/CSS matching the app's renderer, with National 2 embedded from the
 * deployment's own font files and images packaged alongside. The package
 * carries everything media partners validate and everything the studio
 * needs to measure it:
 *
 *  - `<meta name="ad.size">` + CM360/DV360 `clickTag` wiring
 *  - a creative ID and campaign / format / variant / layout tags as data
 *    attributes, appended to click-throughs as UTM parameters
 *  - analytics beacons (impression, viewable ≥50% for 1s with in-view time,
 *    first interaction, click) to the studio's /track/c/<token> endpoints
 *  - dynamic content: text and image elements read overrides from URL
 *    parameters (?headline=…&body=…&cta=…&image=…) or a JSON feed (?feed=…),
 *    with the baked copy as fallback so the creative never renders empty
 *  - fluid mode: the creative scales to its container when `?fluid=1`
 *  - an entrance animation (artwork → copy → logo) in pure CSS
 */
import JSZip from "jszip";
import type { FreeformConfig, FreeformElement, FreeformImage, FreeformRect, FreeformText } from "./freeform";

export interface CreativeTags {
  token: string;
  name: string;
  campaign?: string | null;
  format: string;
  variant?: string | null;
  layoutLabel?: string | null;
}

export interface HtmlExportOptions {
  width: number;
  height: number;
  config: FreeformConfig;
  tags: CreativeTags;
  /** Landing page; UTM tags are appended. */
  clickUrl?: string | null;
  /** Absolute origin of the studio (beacons + asset fetching). */
  studioBase: string;
  brandFontFamily?: string;
  animate?: boolean;
  fluid?: boolean;
  /** Fetch bytes for a src (storage object, public file, absolute URL). */
  loadAsset: (src: string) => Promise<{ bytes: Buffer; contentType: string } | null>;
}

export interface HtmlPackage {
  zip: Buffer;
  html: string;
  files: string[];
}

const FONT_FILES = [
  { file: "fonts/national2-regular.woff", weight: 400, src: "/fonts/national2-regular.woff" },
  { file: "fonts/national2-bold.woff", weight: 700, src: "/fonts/national2-bold.woff" },
];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${Math.max(0, Math.min(1, alpha))})`;
}

function safeFileName(src: string, index: number, contentType: string): string {
  const ext =
    contentType.includes("png") ? "png"
    : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg"
    : contentType.includes("svg") ? "svg"
    : contentType.includes("webp") ? "webp"
    : contentType.includes("gif") ? "gif"
    : (src.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "").slice(0, 4) || "bin";
  return `assets/img-${index}.${ext}`;
}

function rectStyle(el: FreeformRect): string {
  const parts: string[] = [];
  if (el.gradient && el.gradient.stops.length >= 2) {
    const stops = el.gradient.stops.map((s) => `${hexWithAlpha(s.color, s.alpha)} ${Math.round(s.at * 100)}%`).join(", ");
    parts.push(`background:linear-gradient(${Math.round(el.gradient.angle)}deg, ${stops})`);
  } else {
    parts.push(`background-color:${el.fill}`);
  }
  if (el.radius) parts.push(`border-radius:${el.radius}px`);
  if (el.borderWidth) parts.push(`border:${el.borderWidth}px solid ${el.borderColor ?? "#000"}`);
  return parts.join(";");
}

function imageStyle(el: FreeformImage): string {
  const fit = el.fit ?? (el.role === "logo" ? "contain" : "cover");
  const pos =
    typeof el.focusX === "number" || typeof el.focusY === "number"
      ? `${Math.round((el.focusX ?? 0.5) * 100)}% ${Math.round((el.focusY ?? 0.5) * 100)}%`
      : "center";
  return `object-fit:${fit};object-position:${pos};border-radius:${el.radius ?? 0}px`;
}

function textStyle(el: FreeformText, brandFont: string): string {
  // Single quotes: these land inside a double-quoted style attribute.
  const fam = el.fontFamily ? `'${el.fontFamily.replace(/'/g, "")}', ` : "";
  return [
    `font-family:${fam}'National 2', '${brandFont.replace(/'/g, "")}', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
    `font-size:${el.fontSize ?? 16}px`,
    `font-weight:${el.fontWeight ?? 400}`,
    `font-style:${el.fontStyle === "italic" ? "italic" : "normal"}`,
    `color:${el.color ?? "#111827"}`,
    `text-align:${el.align ?? "left"}`,
    `line-height:${el.lineHeight ?? 1.2}`,
    "white-space:pre-wrap",
    "overflow:visible",
    ...(el.letterSpacing != null ? [`letter-spacing:${el.letterSpacing}px`] : []),
  ].join(";");
}

function dynamicKey(el: FreeformText): string | null {
  switch (el.role) {
    case "headline": return "headline";
    case "subhead": return "subhead";
    case "body": return "body";
    case "cta": return "cta";
    default: return null;
  }
}

export async function buildHtmlPackage(opts: HtmlExportOptions): Promise<HtmlPackage> {
  const { width, height, config, tags, studioBase } = opts;
  const zip = new JSZip();
  const files: string[] = [];
  const brandFont = opts.brandFontFamily ?? "National 2";

  // Fonts: embedded from the deployment's own files.
  const fontFaces: string[] = [];
  for (const f of FONT_FILES) {
    const asset = await opts.loadAsset(f.src);
    if (asset) {
      zip.file(f.file, asset.bytes);
      files.push(f.file);
      fontFaces.push(`@font-face{font-family:"National 2";font-weight:${f.weight};font-style:normal;src:url("${f.file}") format("woff");font-display:block}`);
    }
  }

  // Elements.
  const body: string[] = [];
  let imgIndex = 0;
  let seq = 0;
  const delayFor = (el: FreeformElement): number => {
    // Entrance order: artwork first, then shapes, then copy, logo last.
    if (el.type === "image" && el.role === "logo") return 0.9;
    if (el.type === "image") return 0;
    if (el.type === "rect") return 0.15;
    return 0.45 + Math.min(0.3, (seq++) * 0.12);
  };

  for (const el of config.elements) {
    const base = `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;opacity:${el.opacity ?? 1}`;
    const anim = opts.animate === false ? "" : `animation:enter .6s ease-out ${delayFor(el).toFixed(2)}s both`;
    if (el.type === "rect") {
      body.push(`<div class="el rect" style="${base};${rectStyle(el)};${anim}"></div>`);
    } else if (el.type === "image") {
      let src = "";
      if (el.src) {
        const asset = await opts.loadAsset(el.src);
        if (asset) {
          const name = safeFileName(el.src, imgIndex++, asset.contentType);
          zip.file(name, asset.bytes);
          files.push(name);
          src = name;
        }
      }
      const dyn = el.role === "product" ? ` data-dynamic="image"` : "";
      body.push(
        `<img class="el img ${el.role}" src="${esc(src)}" alt=""${dyn} style="${base};${imageStyle(el)};${anim}">`,
      );
    } else if (el.type === "text") {
      const key = dynamicKey(el);
      const dyn = key ? ` data-dynamic="${key}"` : "";
      body.push(
        `<div class="el text ${el.role}"${dyn} style="${base};${textStyle(el, brandFont)};${anim}">${esc(el.text)}</div>`,
      );
    }
  }

  const utm = new URLSearchParams({
    utm_source: "brand-studio",
    utm_medium: "display",
    utm_campaign: tags.campaign ?? "",
    utm_content: `${tags.format}${tags.variant ? `-${tags.variant}` : ""}`,
    utm_term: tags.token,
  });
  const landing = opts.clickUrl ? `${opts.clickUrl}${opts.clickUrl.includes("?") ? "&" : "?"}${utm.toString()}` : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="ad.size" content="width=${width},height=${height}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(tags.name)}</title>
<style>
${fontFaces.join("\n")}
html,body{margin:0;padding:0;background:transparent}
#stage{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#ffffff;transform-origin:top left}
#fluid{position:relative;width:100%;}
.el{box-sizing:border-box}
.img{display:block}
@keyframes enter{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.el{animation:none!important}}
#clicktag-layer{position:absolute;left:0;top:0;width:${width}px;height:${height}px;z-index:2147483647;display:block;text-decoration:none;background:transparent;cursor:pointer}
</style>
<script type="text/javascript">var clickTag = window.clickTag || ${JSON.stringify(landing)};</script>
</head>
<body>
<div id="fluid">
<div id="stage"
  data-creative="${esc(tags.token)}"
  data-name="${esc(tags.name)}"
  data-campaign="${esc(tags.campaign ?? "")}"
  data-format="${esc(tags.format)}"
  data-variant="${esc(tags.variant ?? "")}"
  data-layout="${esc(tags.layoutLabel ?? "")}">
${body.join("\n")}
<a href="javascript:void(0)" id="clicktag-layer" aria-label="${esc(tags.name)}"></a>
</div>
</div>
<script>
(function(){
  var STUDIO=${JSON.stringify(studioBase)};
  var TOKEN=${JSON.stringify(tags.token)};
  var W=${width},H=${height};
  var stage=document.getElementById('stage');
  var params=new URLSearchParams(location.search);
  var dynKey='';

  // ---- Dynamic content: URL params or a JSON feed override baked copy. ----
  function applyDynamic(data){
    if(!data) return;
    var keys=['headline','subhead','body','cta','image'];
    keys.forEach(function(k){
      if(data[k]==null||data[k]==='') return;
      var els=stage.querySelectorAll('[data-dynamic="'+k+'"]');
      for(var i=0;i<els.length;i++){
        if(k==='image') els[i].setAttribute('src',data[k]); else els[i].textContent=data[k];
      }
    });
    dynKey=data.key||data.variant||'';
  }
  var urlData={};
  ['headline','subhead','body','cta','image','key','variant'].forEach(function(k){ if(params.get(k)) urlData[k]=params.get(k); });
  applyDynamic(urlData);
  if(params.get('feed')){
    try{ fetch(params.get('feed'),{mode:'cors'}).then(function(r){return r.json();}).then(applyDynamic).catch(function(){}); }catch(e){}
  }

  // ---- Fluid mode: scale the stage to its container. ----
  var fluid=params.get('fluid')==='1'||${opts.fluid ? "true" : "false"};
  function fit(){
    if(!fluid) return;
    var box=document.getElementById('fluid');
    var s=Math.min(box.clientWidth/W, (window.innerHeight||H)/H);
    if(!isFinite(s)||s<=0) s=1;
    stage.style.transform='scale('+s+')';
    box.style.height=(H*s)+'px';
  }
  fit(); window.addEventListener('resize',fit);

  // ---- Analytics beacons (fire-and-forget; never block the creative). ----
  function beacon(type,extra){
    try{
      var q='?t='+encodeURIComponent(type)+(dynKey?'&k='+encodeURIComponent(dynKey):'')+(extra||'');
      var url=STUDIO+'/track/c/'+TOKEN+q;
      if(navigator.sendBeacon){ navigator.sendBeacon(url); } else { (new Image()).src=url+'&_='+Date.now(); }
    }catch(e){}
  }
  beacon('impression');
  var viewMs=0,inView=false,since=0,viewableSent=false;
  function flush(){ if(inView){ viewMs+=Date.now()-since; since=Date.now(); } }
  if('IntersectionObserver' in window){
    new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.intersectionRatio>=0.5 && !inView){ inView=true; since=Date.now(); }
        else if(e.intersectionRatio<0.5 && inView){ flush(); inView=false; }
      });
    },{threshold:[0,0.5,1]}).observe(stage);
  } else { inView=true; since=Date.now(); }
  setInterval(function(){ flush(); if(!viewableSent && viewMs>=1000){ viewableSent=true; beacon('viewable','&ms='+viewMs); } },500);
  window.addEventListener('pagehide',function(){ flush(); if(viewMs>0) beacon('view','&ms='+viewMs); });
  var interacted=false;
  function onInteract(){ if(interacted) return; interacted=true; beacon('interaction'); }
  stage.addEventListener('pointerenter',onInteract); stage.addEventListener('touchstart',onInteract,{passive:true});

  document.getElementById('clicktag-layer').addEventListener('click',function(ev){
    ev.preventDefault();
    beacon('click');
    var url=window.clickTag||'';
    if(url){ window.open(url,'_blank'); }
  });
})();
</script>
</body>
</html>`;

  zip.file("index.html", html);
  files.unshift("index.html");
  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { zip: zipBuf, html, files };
}
