/**
 * Google Web Designer motion capture.
 *
 * A GWD banner's HTML carries every layer's geometry (class rules) and its
 * choreography (`.gwd-gen-*animation` classes → `@keyframes`). This module
 * reads both and, for every image layer, produces
 *
 *   - the RESTING box: where the layer sits when the timeline has finished
 *     (the frame the designer signed off), and
 *   - a MOTION TRACK: the layer's box and opacity over the whole timeline,
 *     expressed relative to that resting box, so the same choreography can be
 *     replayed on a piece built at another size (offsets scale with the layer).
 *
 * Nested containers matter: lettering sits inside positioned divs whose own
 * animation flies the group in and scales it. Every leaf is evaluated through
 * its full ancestor chain at each sample time, exactly as the browser would.
 */

export interface Geo {
  top?: number;
  left?: number;
  width?: number;
  height?: number;
  opacity?: number;
  /** Base-rule `transform:` (GWD writes the resting transform here when an
   *  element has no animation, or when its animation only tweens opacity). */
  tx?: number;
  ty?: number;
  sx?: number;
  sy?: number;
  /** `transform-origin`, as a fraction of the box (0.5 = centre) or px. */
  ox?: { v: number; pct: boolean };
  oy?: { v: number; pct: boolean };
}

export interface Xf {
  dx: number;
  dy: number;
  opacity?: number;
  sx?: number;
  sy?: number;
  /** false when the frame carries no `transform` at all — the base rule's
   *  transform stays in force in that case. */
  hasTransform: boolean;
}

interface Keyframe {
  pct: number;
  tx?: number;
  ty?: number;
  sx?: number;
  sy?: number;
  hasTransform: boolean;
  opacity?: number;
  /** Timing function that applies FROM this frame to the next. */
  timing?: string;
}

export interface AnimSpec {
  name: string;
  /** seconds */
  dur: number;
  delay: number;
  /** Infinity for `infinite`. */
  iter: number;
  fill: "none" | "forwards" | "backwards" | "both";
  timing: string;
  frames: Keyframe[];
}

/** One sample of a layer's motion, relative to its resting box. */
export interface MotionFrame {
  /** 0..1 fraction of the timeline. */
  t: number;
  /** Offset of the layer's top-left from rest, in the master's canvas px. */
  dx: number;
  dy: number;
  /** Size relative to rest (1 = resting size). */
  sx: number;
  sy: number;
  /** Absolute composed opacity. */
  o: number;
}

export interface MotionTrack {
  /** Timeline length in seconds (shared by every layer of the banner). */
  dur: number;
  /** The layer's resting size in the master, so offsets can be scaled when
   *  the layer is placed at another size (kx = w / w0). */
  w0: number;
  h0: number;
  frames: MotionFrame[];
}

export interface GwdLeaf {
  classes: string[];
  relSrc: string;
  /** Resting box on the canvas, before any trim to visible pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  /** The leaf's full choreography (ancestors + its own animation). */
  motion?: MotionTrack;
  /** Ancestors' choreography only — what a group of glyph layers shares.
   *  Present only when the leaf also animates on its own. */
  groupMotion?: MotionTrack;
  /** The leaf's own animation only (ancestors held at rest) — what a glyph
   *  does inside its group: the letter-by-letter reveal. */
  ownMotion?: MotionTrack;
}

/** A glyph inside a merged headline: its box as fractions of the headline
 *  box, its own image and its own reveal. */
export interface MotionPart { src: string; fx: number; fy: number; fw: number; fh: number; motion?: MotionTrack }

export interface GwdAnalysis {
  width: number;
  height: number;
  /** Timeline length in seconds; 0 when nothing animates. */
  dur: number;
  leaves: GwdLeaf[];
}

// ---------------------------------------------------------------------------
// CSS parsing
// ---------------------------------------------------------------------------

export function parseTransform(body: string): Pick<Xf, "dx" | "dy" | "sx" | "sy" | "hasTransform"> {
  // Prefixed blocks (`@-webkit-keyframes`) carry only `-webkit-transform`.
  const tf = /(?<![-\w])transform\s*:\s*([^;]+)/.exec(body) ?? /-webkit-transform\s*:\s*([^;]+)/.exec(body);
  if (!tf) return { dx: 0, dy: 0, hasTransform: false };
  // GWD writes a zero component without a unit: `translate3d(0, -223px, 0)`.
  const t = /translate(?:3d)?\(\s*(-?[\d.]+)(?:px)?\s*,\s*(-?[\d.]+)(?:px)?/.exec(tf[1]);
  const sc = /scale(?:3d)?\(\s*(-?[\d.]+)\s*(?:,\s*(-?[\d.]+))?/.exec(tf[1]);
  return {
    dx: t ? parseFloat(t[1]) : 0,
    dy: t ? parseFloat(t[2]) : 0,
    ...(sc ? { sx: parseFloat(sc[1]), sy: parseFloat(sc[2] ?? sc[1]) } : {}),
    hasTransform: true,
  };
}

export function parseOrigin(body: string): Pick<Geo, "ox" | "oy"> {
  const m = /(?<![-\w])transform-origin\s*:\s*(-?[\d.]+)(%|px)\s+(-?[\d.]+)(%|px)/.exec(body);
  if (!m) return {};
  return {
    ox: { v: parseFloat(m[1]) / (m[2] === "%" ? 100 : 1), pct: m[2] === "%" },
    oy: { v: parseFloat(m[3]) / (m[4] === "%" ? 100 : 1), pct: m[4] === "%" },
  };
}

export function parseClassRules(html: string): Map<string, Geo> {
  const rules = new Map<string, Geo>();
  for (const m of html.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
    const body = m[2];
    const geo: Geo = {};
    for (const prop of ["top", "left", "width", "height"] as const) {
      const mm = new RegExp(`(?<![-\\w])${prop}\\s*:\\s*(-?[\\d.]+)px`).exec(body);
      if (mm) geo[prop] = parseFloat(mm[1]);
    }
    const op = /(?<![-\w])opacity\s*:\s*([\d.]+)/.exec(body);
    if (op) geo.opacity = parseFloat(op[1]);
    const xf = parseTransform(body);
    if (xf.hasTransform) {
      geo.tx = xf.dx;
      geo.ty = xf.dy;
      if (xf.sx != null) geo.sx = xf.sx;
      if (xf.sy != null) geo.sy = xf.sy;
    }
    Object.assign(geo, parseOrigin(body));
    if (Object.keys(geo).length > 0) {
      rules.set(m[1], { ...(rules.get(m[1]) ?? {}), ...geo });
    }
  }
  return rules;
}

const TIMING_WORDS = new Set(["linear", "ease", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end"]);
const FILLS = new Set(["none", "forwards", "backwards", "both"]);

function parseTimingIn(body: string): string | undefined {
  const m = /(?<![-\w])(?:-webkit-)?animation-timing-function\s*:\s*([^;]+)/.exec(body);
  return m ? m[1].trim().replace(/\s+/g, "") : undefined;
}

/** Every @keyframes block by name; prefixed copies merge into the same entry. */
function parseKeyframes(html: string): Map<string, Keyframe[]> {
  const out = new Map<string, Map<number, Keyframe>>();
  for (const m of html.matchAll(/@(?:-webkit-|-moz-)?keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^}]*\})*)\s*\}/g)) {
    const byPct = out.get(m[1]) ?? new Map<number, Keyframe>();
    for (const f of m[2].matchAll(/([\d.]+%|from|to)(?:\s*,\s*(?:[\d.]+%|from|to))*\s*\{([^}]*)\}/g)) {
      const sel = f[1];
      const pct = sel === "from" ? 0 : sel === "to" ? 100 : parseFloat(sel);
      const body = f[2];
      const xf = parseTransform(body);
      const o = /(?<![-\w])opacity\s*:\s*([\d.]+)/.exec(body);
      const timing = parseTimingIn(body);
      const prev = byPct.get(pct) ?? { pct, hasTransform: false };
      const next: Keyframe = { ...prev };
      if (xf.hasTransform && !prev.hasTransform) {
        next.hasTransform = true;
        next.tx = xf.dx;
        next.ty = xf.dy;
        if (xf.sx != null) next.sx = xf.sx;
        if (xf.sy != null) next.sy = xf.sy;
      }
      if (o && prev.opacity == null) next.opacity = parseFloat(o[1]);
      if (timing && !prev.timing) next.timing = timing;
      byPct.set(pct, next);
    }
    out.set(m[1], byPct);
  }
  const frames = new Map<string, Keyframe[]>();
  for (const [name, byPct] of out) frames.set(name, [...byPct.values()].sort((a, b) => a.pct - b.pct));
  return frames;
}

function secs(tok: string): number | null {
  const m = /^(-?[\d.]+)(ms|s)$/.exec(tok);
  if (!m) return null;
  return m[2] === "ms" ? parseFloat(m[1]) / 1000 : parseFloat(m[1]);
}

/** `.cls { animation: … }` → the animation each class plays. */
export function parseAnimationSpecs(html: string): Map<string, AnimSpec> {
  const keyframes = parseKeyframes(html);
  const specs = new Map<string, AnimSpec>();
  for (const m of html.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
    const body = m[2];
    if (!/(?<![-\w])animation(?:-name)?\s*:/.test(body)) continue;
    const spec: AnimSpec = { name: "", dur: 0, delay: 0, iter: 1, fill: "none", timing: "linear", frames: [] };
    const shorthand = /(?<![-\w])animation\s*:\s*([^;]+)/.exec(body);
    if (shorthand) {
      // Keep `cubic-bezier(.4, 0, .2, 1)` as one token.
      const value = shorthand[1].replace(/\(\s*([^)]*?)\s*\)/g, (_s, inner: string) => `(${inner.replace(/\s+/g, "")})`);
      const tokens = value.split(/\s+/).filter(Boolean);
      let times = 0;
      for (const tok of tokens) {
        const s = secs(tok);
        if (s != null) {
          if (times === 0) spec.dur = s;
          else if (times === 1) spec.delay = s;
          times++;
          continue;
        }
        if (TIMING_WORDS.has(tok) || /^cubic-bezier\(/.test(tok) || /^steps\(/.test(tok)) { spec.timing = tok; continue; }
        if (FILLS.has(tok)) { spec.fill = tok as AnimSpec["fill"]; continue; }
        if (tok === "infinite") { spec.iter = Infinity; continue; }
        if (/^\d+(\.\d+)?$/.test(tok)) { spec.iter = parseFloat(tok); continue; }
        if (keyframes.has(tok)) spec.name = tok;
      }
    }
    const long = (prop: string) => /(?<![-\w])animation-PROP\s*:\s*([^;]+)/.source.replace("PROP", prop);
    const nameL = new RegExp(long("name")).exec(body);
    if (nameL && keyframes.has(nameL[1].trim())) spec.name = nameL[1].trim();
    const durL = new RegExp(long("duration")).exec(body);
    if (durL && secs(durL[1].trim()) != null) spec.dur = secs(durL[1].trim())!;
    const delayL = new RegExp(long("delay")).exec(body);
    if (delayL && secs(delayL[1].trim()) != null) spec.delay = secs(delayL[1].trim())!;
    const iterL = new RegExp(long("iteration-count")).exec(body);
    if (iterL) spec.iter = iterL[1].trim() === "infinite" ? Infinity : parseFloat(iterL[1]) || 1;
    const fillL = new RegExp(long("fill-mode")).exec(body);
    if (fillL && FILLS.has(fillL[1].trim())) spec.fill = fillL[1].trim() as AnimSpec["fill"];
    const timingL = new RegExp(long("timing-function")).exec(body);
    if (timingL) spec.timing = timingL[1].trim().replace(/\s+/g, "");
    if (!spec.name) continue;
    spec.frames = keyframes.get(spec.name) ?? [];
    if (spec.frames.length === 0) continue;
    specs.set(m[1], spec);
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Timing functions
// ---------------------------------------------------------------------------

function bezier(p1x: number, p1y: number, p2x: number, p2y: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-5) return sampleY(t);
    const d = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0, hi = 1;
  t = x;
  for (let i = 0; i < 24; i++) {
    const v = sampleX(t);
    if (Math.abs(v - x) < 1e-5) break;
    if (v < x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return sampleY(t);
}

function ease(timing: string | undefined, p: number): number {
  switch (timing) {
    case undefined:
    case "linear": return p;
    case "ease": return bezier(0.25, 0.1, 0.25, 1, p);
    case "ease-in": return bezier(0.42, 0, 1, 1, p);
    case "ease-out": return bezier(0, 0, 0.58, 1, p);
    case "ease-in-out": return bezier(0.42, 0, 0.58, 1, p);
    case "step-start": return p > 0 ? 1 : 0;
    case "step-end": return p >= 1 ? 1 : 0;
  }
  const cb = /^cubic-bezier\(([^)]*)\)/.exec(timing);
  if (cb) {
    const n = cb[1].split(",").map(Number);
    if (n.length === 4 && n.every((v) => Number.isFinite(v))) return bezier(n[0], n[1], n[2], n[3], p);
  }
  const st = /^steps\((\d+)/.exec(timing);
  if (st) {
    const k = Math.max(1, parseInt(st[1], 10));
    return Math.min(1, Math.floor(p * k) / k);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

interface State { tx: number; ty: number; sx: number; sy: number; opacity: number }

function baseState(geo: Geo): State {
  return { tx: geo.tx ?? 0, ty: geo.ty ?? 0, sx: geo.sx ?? 1, sy: geo.sy ?? geo.sx ?? 1, opacity: geo.opacity ?? 1 };
}

type Prop = "tx" | "ty" | "sx" | "sy" | "opacity";

function frameHas(f: Keyframe, prop: Prop): boolean {
  if (prop === "opacity") return f.opacity != null;
  return f.hasTransform;
}
function frameVal(f: Keyframe, prop: Prop, base: State): number {
  switch (prop) {
    case "tx": return f.tx ?? 0;
    case "ty": return f.ty ?? 0;
    case "sx": return f.sx ?? 1;
    case "sy": return f.sy ?? f.sx ?? 1;
    case "opacity": return f.opacity ?? base.opacity;
  }
}

/** The element's own transform/opacity at absolute time T (seconds). */
function stateAt(geo: Geo, anim: AnimSpec | undefined, T: number): State {
  const base = baseState(geo);
  if (!anim || anim.frames.length === 0) return base;
  let p: number; // 0..100
  const total = anim.dur * (Number.isFinite(anim.iter) ? anim.iter : 1e9);
  if (T < anim.delay) {
    if (anim.fill === "backwards" || anim.fill === "both") p = 0;
    else return base;
  } else if (T - anim.delay >= total) {
    if (anim.fill === "forwards" || anim.fill === "both") p = 100;
    else return base;
  } else {
    const local = T - anim.delay;
    p = anim.dur > 0 ? ((local % anim.dur) / anim.dur) * 100 : 100;
  }
  const out: State = { ...base };
  const props: Prop[] = ["tx", "ty", "sx", "sy", "opacity"];
  for (const prop of props) {
    const withProp = anim.frames.filter((f) => frameHas(f, prop));
    if (withProp.length === 0) continue;
    // Implicit 0%/100% frames carry the base value when the author omitted them.
    const seq: { pct: number; v: number; timing?: string }[] = withProp.map((f) => ({ pct: f.pct, v: frameVal(f, prop, base), timing: f.timing }));
    if (seq[0].pct > 0) seq.unshift({ pct: 0, v: (base as Record<Prop, number>)[prop] });
    if (seq[seq.length - 1].pct < 100) seq.push({ pct: 100, v: (base as Record<Prop, number>)[prop] });
    let a = seq[0], b = seq[seq.length - 1];
    for (let i = 0; i < seq.length - 1; i++) {
      if (p >= seq[i].pct && p <= seq[i + 1].pct) { a = seq[i]; b = seq[i + 1]; break; }
    }
    const span = b.pct - a.pct;
    const u = span <= 0 ? 1 : ease(a.timing ?? anim.timing, (p - a.pct) / span);
    (out as Record<Prop, number>)[prop] = a.v + (b.v - a.v) * u;
  }
  return out;
}

interface Node { geo: Geo; anim?: AnimSpec }
interface Frame { x0: number; y0: number; s: number; o: number }

/** Where an element's box lands in its parent's local space after its own
 *  transform, which CSS applies about `transform-origin` (default centre). */
function placed(geo: Geo, st: State) {
  const l = geo.left ?? 0, t = geo.top ?? 0, w = geo.width ?? 0, h = geo.height ?? 0;
  const ox = geo.ox ? (geo.ox.pct ? geo.ox.v * w : geo.ox.v) : w / 2;
  const oy = geo.oy ? (geo.oy.pct ? geo.oy.v * h : geo.oy.v) : h / 2;
  return { x: l + ox * (1 - st.sx) + st.tx, y: t + oy * (1 - st.sy) + st.ty, w: w * st.sx, h: h * st.sy };
}

/** A leaf's canvas box and opacity at time T through its ancestor chain. */
function composeAt(chain: Node[], T: number, freezeLeafAt?: number, freezeAncestorsAt?: number): { x: number; y: number; w: number; h: number; o: number } {
  let f: Frame = { x0: 0, y0: 0, s: 1, o: 1 };
  for (let i = 0; i < chain.length - 1; i++) {
    const n = chain[i];
    const st = stateAt(n.geo, n.anim, freezeAncestorsAt ?? T);
    const b = placed(n.geo, st);
    f = { x0: f.x0 + f.s * b.x, y0: f.y0 + f.s * b.y, s: f.s * st.sx, o: f.o * st.opacity };
  }
  const leaf = chain[chain.length - 1];
  const st = stateAt(leaf.geo, leaf.anim, freezeLeafAt ?? T);
  const b = placed(leaf.geo, st);
  return { x: f.x0 + f.s * b.x, y: f.y0 + f.s * b.y, w: f.s * b.w, h: f.s * b.h, o: f.o * st.opacity };
}

const MAX_TIMELINE = 30;

function sampleTimes(chain: Node[], end: number): number[] {
  const pts = new Set<number>([0, end]);
  for (const n of chain) {
    if (!n.anim) continue;
    const reps = Number.isFinite(n.anim.iter) ? Math.min(n.anim.iter, 3) : 3;
    for (let k = 0; k < reps; k++) {
      for (const f of n.anim.frames) pts.add(n.anim.delay + n.anim.dur * k + (f.pct / 100) * n.anim.dur);
      pts.add(n.anim.delay + n.anim.dur * (k + 1));
    }
    pts.add(n.anim.delay);
  }
  const sorted = [...pts].filter((t) => t >= 0 && t <= end).sort((a, b) => a - b);
  const dense: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    dense.push(sorted[i]);
    if (i < sorted.length - 1) {
      const a = sorted[i], b = sorted[i + 1];
      if (b - a > 0.02) { dense.push(a + (b - a) / 3, a + (2 * (b - a)) / 3); }
    }
  }
  return dense;
}

function simplify(frames: MotionFrame[]): MotionFrame[] {
  if (frames.length <= 2) return frames;
  const keep: MotionFrame[] = [frames[0]];
  for (let i = 1; i < frames.length - 1; i++) {
    const a = keep[keep.length - 1], c = frames[i + 1], b = frames[i];
    const u = c.t === a.t ? 0 : (b.t - a.t) / (c.t - a.t);
    const lin = (k: keyof MotionFrame) => a[k] + (c[k] - a[k]) * u;
    const redundant =
      Math.abs(lin("dx") - b.dx) <= 0.5 &&
      Math.abs(lin("dy") - b.dy) <= 0.5 &&
      Math.abs(lin("sx") - b.sx) <= 0.005 &&
      Math.abs(lin("sy") - b.sy) <= 0.005 &&
      Math.abs(lin("o") - b.o) <= 0.01;
    if (!redundant) keep.push(b);
  }
  keep.push(frames[frames.length - 1]);
  return keep.slice(0, 200);
}

function trackFor(chain: Node[], end: number, rest: { x: number; y: number; w: number; h: number }, freeze: "none" | "leaf" | "ancestors"): MotionTrack | undefined {
  if (end <= 0 || rest.w <= 0 || rest.h <= 0) return undefined;
  const times = sampleTimes(chain, end);
  const frames: MotionFrame[] = times.map((T) => {
    const b = composeAt(chain, T, freeze === "leaf" ? end : undefined, freeze === "ancestors" ? end : undefined);
    return {
      t: Math.round((T / end) * 10000) / 10000,
      dx: Math.round((b.x - rest.x) * 100) / 100,
      dy: Math.round((b.y - rest.y) * 100) / 100,
      sx: Math.round((b.w / rest.w) * 1000) / 1000,
      sy: Math.round((b.h / rest.h) * 1000) / 1000,
      o: Math.round(Math.max(0, Math.min(1, b.o)) * 100) / 100,
    };
  });
  const last = frames[frames.length - 1];
  const moves = frames.some((f) => Math.abs(f.dx - last.dx) > 0.5 || Math.abs(f.dy - last.dy) > 0.5 || Math.abs(f.sx - last.sx) > 0.005 || Math.abs(f.sy - last.sy) > 0.005 || Math.abs(f.o - last.o) > 0.02);
  if (!moves) return undefined;
  return { dur: Math.round(end * 100) / 100, w0: Math.round(rest.w), h0: Math.round(rest.h), frames: simplify(frames) };
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/** Read a GWD banner: page size, timeline length and every image layer with
 *  its resting box and motion. Pure — nothing is fetched or written. */
export function analyseGwdHtml(html: string): GwdAnalysis | null {
  const page = /\.gwd-page-size\s*\{[^}]*width\s*:\s*([\d.]+)px[^}]*height\s*:\s*([\d.]+)px/.exec(html);
  if (!page) return null;
  const width = Math.round(parseFloat(page[1]));
  const height = Math.round(parseFloat(page[2]));
  const rules = parseClassRules(html);
  const specs = parseAnimationSpecs(html);

  const body = html.slice(Math.max(0, html.indexOf("<body")));
  const tags = [...body.matchAll(/<(\/?)(div|gwd-page|gwd-image)([^>]*)>/g)];

  // Timeline: the longest (delay + duration) of any animation actually used.
  let end = 0;
  const used = new Set<string>();
  for (const tag of tags) {
    if (tag[1] === "/") continue;
    for (const c of (/class="([^"]+)"/.exec(tag[3])?.[1] ?? "").split(/\s+/)) if (specs.has(c)) used.add(c);
  }
  for (const c of used) {
    const a = specs.get(c)!;
    end = Math.max(end, a.delay + a.dur * (Number.isFinite(a.iter) ? Math.max(1, a.iter) : 1));
  }
  end = Math.min(MAX_TIMELINE, end);

  const resolve = (classes: string[]): Node => {
    const geo: Geo = {};
    let anim: AnimSpec | undefined;
    for (const c of classes) {
      Object.assign(geo, rules.get(c) ?? {});
      const a = specs.get(c);
      if (a) anim = a;
    }
    return { geo, anim };
  };

  const stack: Node[] = [];
  const leaves: GwdLeaf[] = [];
  for (const tag of tags) {
    const closing = tag[1] === "/";
    const name = tag[2];
    const attrs = tag[3];
    if (closing) {
      if ((name === "div" || name === "gwd-page") && stack.length > 0) stack.pop();
      continue;
    }
    const classes = (/class="([^"]+)"/.exec(attrs)?.[1] ?? "").split(/\s+/).filter(Boolean);
    const node = resolve(classes);
    if (name === "div" || name === "gwd-page") {
      stack.push(node);
      continue;
    }
    const relSrc = /source="([^"]+)"/.exec(attrs)?.[1];
    if (!relSrc || node.geo.width == null || node.geo.height == null) continue;
    const chain = [...stack, node];
    const rest = composeAt(chain, end);
    const leaf: GwdLeaf = { classes, relSrc, x: rest.x, y: rest.y, w: rest.w, h: rest.h, opacity: rest.o };
    if (end > 0) {
      const motion = trackFor(chain, end, rest, "none");
      if (motion) leaf.motion = motion;
      if (node.anim && motion) {
        const group = trackFor(chain, end, rest, "leaf");
        if (group) leaf.groupMotion = group;
        const own = trackFor(chain, end, rest, "ancestors");
        if (own) leaf.ownMotion = own;
      }
    }
    leaves.push(leaf);
  }
  return { width, height, dur: end, leaves };
}

// ---------------------------------------------------------------------------
// Backfill for artwork imported before motion capture existed
// ---------------------------------------------------------------------------

interface BoxLike { x: number; y: number; w: number; h: number }

function contains(outer: BoxLike, inner: BoxLike, tol: number): boolean {
  return inner.x >= outer.x - tol && inner.y >= outer.y - tol && inner.x + inner.w <= outer.x + outer.w + tol && inner.y + inner.h <= outer.y + outer.h + tol;
}

/**
 * Give motion tracks to an imported layer stack from the banner HTML it came
 * from. Layers are matched by geometry: an element sits inside the resting
 * box of the DOM layer it was cut from; a merged headline covers several
 * glyph layers and takes the group's shared motion.
 */
export function motionForElements<E extends BoxLike & { motion?: MotionTrack; motionParts?: MotionPart[] }>(
  elements: E[],
  analysis: GwdAnalysis,
  /** Each leaf's box trimmed to its visible pixels (what the importer stored
   *  as the element box). Falls back to the untrimmed resting box. */
  trimmed: Map<GwdLeaf, BoxLike> = new Map(),
): { elements: E[]; assigned: number } {
  let assigned = 0;
  const tol = 3;
  const boxOf = (l: GwdLeaf): BoxLike => trimmed.get(l) ?? l;
  const near = (a: BoxLike, b: BoxLike) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= Math.max(tol, b.w * 0.03) && Math.abs(a.h - b.h) <= Math.max(tol, b.h * 0.03);
  const out = elements.map((el) => {
    if (el.motion || el.w <= 0 || el.h <= 0) return el;
    // 1. The layer this element was cut from: same trimmed box.
    const exact = analysis.leaves.filter((l) => l.motion && near(boxOf(l), el));
    if (exact.length) {
      assigned++;
      return { ...el, motion: { ...exact[exact.length - 1].motion!, w0: Math.round(el.w), h0: Math.round(el.h) } };
    }
    // 2. A merged headline covers the glyph layers it was built from: the
    //    group motion goes on the headline, each glyph's own reveal on a part.
    const inside = visibleStack(analysis.leaves.filter((l) => contains(el, boxOf(l), tol)));
    const animated = inside.find((l) => l.motion);
    if (inside.length >= 2 && animated) {
      assigned++;
      const track = animated.groupMotion ?? animated.motion!;
      return { ...el, motion: { ...track, w0: Math.round(el.w), h0: Math.round(el.h) }, motionParts: partsFor(el, inside) };
    }
    // 3. Else the smallest layer that contains it.
    const hosts = analysis.leaves.filter((l) => l.motion && contains(boxOf(l), el, tol)).sort((a, b) => boxOf(a).w * boxOf(a).h - boxOf(b).w * boxOf(b).h);
    if (hosts.length) {
      assigned++;
      return { ...el, motion: { ...hosts[0].motion!, w0: Math.round(el.w), h0: Math.round(el.h) } };
    }
    return el;
  });
  return { elements: out, assigned };
}

/** Resting-visible leaves, with stacked cycling states collapsed to the
 *  topmost one (the same rule the importer applies). */
function visibleStack(leaves: GwdLeaf[]): GwdLeaf[] {
  const vis = leaves.filter((l) => l.opacity >= 0.1 && l.w > 0 && l.h > 0);
  return vis.filter((a, i) => {
    for (let j = i + 1; j < vis.length; j++) {
      const b = vis[j];
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const inter = ix * iy;
      const union = a.w * a.h + b.w * b.h - inter;
      if (union > 0 && inter / union > 0.75) return false;
    }
    return true;
  });
}

export function partsFor(box: BoxLike, leaves: GwdLeaf[]): MotionPart[] {
  const rd = (v: number) => Math.round(v * 10000) / 10000;
  return leaves.slice(0, 40).map((l) => ({
    src: l.relSrc,
    fx: rd((l.x - box.x) / box.w),
    fy: rd((l.y - box.y) / box.h),
    fw: rd(l.w / box.w),
    fh: rd(l.h / box.h),
    ...(l.ownMotion ? { motion: { ...l.ownMotion, w0: Math.round(l.w), h0: Math.round(l.h) } } : {}),
  }));
}
