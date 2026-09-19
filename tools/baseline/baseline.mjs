#!/usr/bin/env node
/**
 * Regression baseline for the layout engines.
 *
 *   node tools/baseline/baseline.mjs record    lock in what the engines build today
 *   node tools/baseline/baseline.mjs compare   rebuild and report anything that moved
 *
 * Builds run through POST /api/templates/:id/adapt with { dryRun: true }:
 * the real engines, the real masters, nothing saved to WIP. `compare` exits
 * 1 when anything differs by more than the tolerance, so a change that was
 * meant to be neutral can be proven neutral before it ships.
 *
 * Options: --base http://localhost:8081   --tol 1   --only <family-key>
 *          --accept   (compare, then overwrite the snapshot: use after an
 *                      INTENDED change has been looked at and approved)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mode = args[0];
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const BASE = opt("base", "http://localhost:8081");
const TOL = Number(opt("tol", "1"));
const ONLY = opt("only", null);
const ACCEPT = args.includes("--accept");
if (mode !== "record" && mode !== "compare") { console.error("usage: baseline.mjs record|compare [--base URL] [--tol px] [--only key] [--accept]"); process.exit(2); }

const plan = JSON.parse(readFileSync(join(here, "families.json"), "utf8"));
const targets = plan.sizes.map((s) => { const [w, h] = s.split("x").map(Number); return { width: w, height: h }; });
const snapDir = join(here, "snapshots");
mkdirSync(snapDir, { recursive: true });

const FIELDS = ["x", "y", "w", "h", "fontSize"];
const EXACT = ["type", "text", "fill", "baselineFit", "align"];

function normalise(built) {
  const out = {};
  for (const b of built) {
    const els = {};
    const seen = new Map();
    for (const e of b.config.elements) {
      let key = e.id ?? `${e.type}`;
      const n = (seen.get(key) ?? 0) + 1; seen.set(key, n);
      if (n > 1) key = `${key}#${n}`;
      const rec = { slot: e.slot ?? null };
      for (const f of FIELDS) if (typeof e[f] === "number") rec[f] = Math.round(e[f] * 100) / 100;
      for (const f of EXACT) if (e[f] !== undefined) rec[f] = e[f];
      if (typeof e.radius === "number") rec.radius = Math.round(e.radius * 100) / 100;
      els[key] = rec;
    }
    out[`${b.width}x${b.height}`] = {
      method: b.method,
      rejected: b.rejected ?? [],
      dropped: (b.config.droppedParts ?? []).map((d) => d.slot).sort(),
      needsReview: b.config.needsReview === true,
      elements: els,
    };
  }
  return out;
}

async function build(masterId) {
  const res = await fetch(`${BASE}/api/templates/${masterId}/adapt`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun: true, targets }),
  });
  if (!res.ok) throw new Error(`master ${masterId}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  if (!body.dryRun) throw new Error("server does not support dryRun — rebuild and restart it");
  return { master: body.master, sizes: normalise(body.built) };
}

function diff(before, after) {
  const lines = [];
  for (const size of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[size], b = after[size];
    if (!a) { lines.push(`${size}: new size (not in baseline)`); continue; }
    if (!b) { lines.push(`${size}: no longer built`); continue; }
    if (a.method !== b.method) lines.push(`${size}: engine ${a.method} -> ${b.method}`);
    if (JSON.stringify(a.rejected) !== JSON.stringify(b.rejected)) lines.push(`${size}: rejections ${JSON.stringify(a.rejected)} -> ${JSON.stringify(b.rejected)}`);
    if (JSON.stringify(a.dropped) !== JSON.stringify(b.dropped)) lines.push(`${size}: left out [${a.dropped}] -> [${b.dropped}]`);
    if (a.needsReview !== b.needsReview) lines.push(`${size}: review flag ${a.needsReview} -> ${b.needsReview}`);
    for (const key of new Set([...Object.keys(a.elements), ...Object.keys(b.elements)])) {
      const ea = a.elements[key], eb = b.elements[key];
      const label = (ea ?? eb).slot ? `${(ea ?? eb).slot} (${key})` : key;
      if (!ea) { lines.push(`${size}: + ${label} added`); continue; }
      if (!eb) { lines.push(`${size}: - ${label} removed`); continue; }
      const moved = FIELDS.filter((f) => Math.abs((ea[f] ?? 0) - (eb[f] ?? 0)) > TOL).map((f) => `${f} ${ea[f]} -> ${eb[f]}`);
      const changed = [...EXACT, "radius"].filter((f) => JSON.stringify(ea[f]) !== JSON.stringify(eb[f]) && !(f === "radius" && Math.abs((ea[f] ?? 0) - (eb[f] ?? 0)) <= TOL)).map((f) => `${f} ${JSON.stringify(ea[f])} -> ${JSON.stringify(eb[f])}`);
      if (moved.length || changed.length) lines.push(`${size}: ${label}: ${[...moved, ...changed].join(", ")}`);
    }
  }
  return lines;
}

let failed = false;
for (const fam of plan.families) {
  if (ONLY && fam.key !== ONLY) continue;
  const file = join(snapDir, `${fam.key}.json`);
  let now;
  try { now = await build(fam.masterId); } catch (err) { console.error(`✗ ${fam.key}: ${err.message}`); failed = true; continue; }
  if (mode === "record") {
    writeFileSync(file, JSON.stringify(now, null, 1));
    console.log(`● ${fam.key}: recorded ${Object.keys(now.sizes).length} sizes from "${now.master.name}"`);
    continue;
  }
  if (!existsSync(file)) { console.error(`✗ ${fam.key}: no baseline recorded yet`); failed = true; continue; }
  const was = JSON.parse(readFileSync(file, "utf8"));
  const lines = diff(was.sizes, now.sizes);
  if (lines.length === 0) console.log(`✓ ${fam.key}: identical (${Object.keys(now.sizes).length} sizes, tolerance ${TOL}px)`);
  else {
    failed = true;
    console.log(`✗ ${fam.key}: ${lines.length} difference${lines.length === 1 ? "" : "s"}`);
    for (const l of lines.slice(0, 60)) console.log(`    ${l}`);
    if (lines.length > 60) console.log(`    … ${lines.length - 60} more`);
    if (ACCEPT) { writeFileSync(file, JSON.stringify(now, null, 1)); console.log(`    baseline updated (--accept)`); }
  }
}
process.exit(failed && !ACCEPT ? 1 : 0);
