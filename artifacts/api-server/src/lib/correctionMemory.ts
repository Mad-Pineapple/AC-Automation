/**
 * Deterministic correction memory for artwork adaptations.
 *
 * A generated piece stores the engine's original element geometry as an
 * adaptation baseline. When a designer edits that piece we compare current
 * geometry with the baseline and store NORMALISED deltas, never raw pixels.
 * Those deltas can be applied to selected WIP pieces immediately and, when
 * remembered, to future builds from the same campaign master.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { classifyAspect, type FormatClass } from "./formatCatalog";
import { normalizeFreeformConfig, type FreeformConfig, type FreeformElement, type SlotRole } from "./freeform";

export type CorrectionScope = "campaign" | "family" | "format";
export interface GeometrySnapshot { id: string; slot?: SlotRole; x: number; y: number; w: number; h: number }
export interface GeometryDelta { id?: string; slot?: SlotRole; dx: number; dy: number; dw: number; dh: number }
export interface CorrectionRule {
  id?: number;
  masterId: number;
  scope: CorrectionScope;
  family: string | null;
  formatClass: FormatClass | null;
  deltas: GeometryDelta[];
}

let ensured: Promise<void> | null = null;
export function ensureCorrectionTable(): Promise<void> {
  ensured ??= db.execute(sql`CREATE TABLE IF NOT EXISTS layout_corrections (
    id serial PRIMARY KEY,
    master_id integer NOT NULL,
    scope text NOT NULL,
    family text,
    format_class text,
    deltas jsonb NOT NULL,
    source_template_id integer,
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`).then(() => undefined).catch((err) => { ensured = null; throw err; });
  return ensured;
}

export function geometrySnapshot(config: FreeformConfig): GeometrySnapshot[] {
  return config.elements.map((e) => ({ id: e.id, ...(e.slot ? { slot: e.slot } : {}), x: e.x, y: e.y, w: e.w, h: e.h }));
}

const round = (n: number) => Math.round(n * 100000) / 100000;
export function deriveDeltas(current: FreeformConfig, baseline: GeometrySnapshot[], width: number, height: number): GeometryDelta[] {
  const byId = new Map(baseline.map((b) => [b.id, b]));
  const bySlot = new Map(baseline.filter((b) => b.slot).map((b) => [b.slot!, b]));
  const out: GeometryDelta[] = [];
  for (const e of current.elements) {
    const b = byId.get(e.id) ?? (e.slot ? bySlot.get(e.slot) : undefined);
    if (!b) continue;
    const d: GeometryDelta = {
      ...(e.slot ? { slot: e.slot } : { id: e.id }),
      dx: round((e.x - b.x) / Math.max(1, width)),
      dy: round((e.y - b.y) / Math.max(1, height)),
      dw: round((e.w - b.w) / Math.max(1, width)),
      dh: round((e.h - b.h) / Math.max(1, height)),
    };
    if (Math.max(Math.abs(d.dx), Math.abs(d.dy), Math.abs(d.dw), Math.abs(d.dh)) >= 0.0005) out.push(d);
  }
  return out;
}

function patchElement(e: FreeformElement, d: GeometryDelta, width: number, height: number): FreeformElement {
  const w = Math.max(1, e.w + d.dw * width);
  const h = Math.max(1, e.h + d.dh * height);
  return { ...e, x: e.x + d.dx * width, y: e.y + d.dy * height, w, h } as FreeformElement;
}

export function applyDeltas(config: FreeformConfig, deltas: GeometryDelta[], width: number, height: number): FreeformConfig {
  const bySlot = new Map(deltas.filter((d) => d.slot).map((d) => [d.slot!, d]));
  const byId = new Map(deltas.filter((d) => d.id).map((d) => [d.id!, d]));
  return normalizeFreeformConfig({
    ...config,
    elements: config.elements.map((e) => {
      const d = (e.slot ? bySlot.get(e.slot) : undefined) ?? byId.get(e.id);
      return d ? patchElement(e, d, width, height) : e;
    }),
  });
}

export async function rememberCorrection(rule: CorrectionRule, sourceTemplateId: number, userId?: string | null): Promise<number> {
  await ensureCorrectionTable();
  const family = rule.scope === "family" ? rule.family : null;
  const formatClass = rule.scope === "format" ? rule.formatClass : null;
  // One active rule per campaign/scope discriminator. A newer deliberate
  // correction replaces the older one instead of stacking drift forever.
  const existing = await db.execute(sql`SELECT id FROM layout_corrections
    WHERE master_id=${rule.masterId} AND scope=${rule.scope}
      AND family IS NOT DISTINCT FROM ${family}
      AND format_class IS NOT DISTINCT FROM ${formatClass}
    ORDER BY id DESC LIMIT 1`);
  const id = Number((existing.rows as any[])[0]?.id ?? 0);
  if (id) {
    await db.execute(sql`UPDATE layout_corrections SET deltas=${JSON.stringify(rule.deltas)}::jsonb,
      source_template_id=${sourceTemplateId}, created_by=${userId ?? null}, updated_at=now() WHERE id=${id}`);
    return id;
  }
  const inserted = await db.execute(sql`INSERT INTO layout_corrections
    (master_id, scope, family, format_class, deltas, source_template_id, created_by)
    VALUES (${rule.masterId}, ${rule.scope}, ${family}, ${formatClass}, ${JSON.stringify(rule.deltas)}::jsonb, ${sourceTemplateId}, ${userId ?? null}) RETURNING id`);
  return Number((inserted.rows as any[])[0]?.id);
}

export async function correctionsFor(masterId: number, width: number, height: number, family?: string | null): Promise<CorrectionRule[]> {
  await ensureCorrectionTable();
  const fc = classifyAspect(width, height);
  const rows = await db.execute(sql`SELECT id, master_id, scope, family, format_class, deltas
    FROM layout_corrections WHERE master_id=${masterId} ORDER BY id ASC`);
  const rules = (rows.rows as any[]).map((r) => ({
    id: Number(r.id), masterId: Number(r.master_id), scope: r.scope as CorrectionScope,
    family: r.family ?? null, formatClass: r.format_class ?? null,
    deltas: (typeof r.deltas === "string" ? JSON.parse(r.deltas) : r.deltas) as GeometryDelta[],
  })).filter((r) => r.scope === "campaign" || (r.scope === "family" && !!family && r.family === family) || (r.scope === "format" && r.formatClass === fc));
  // broad first, specific last
  return rules.sort((a, b) => ({ campaign: 0, family: 1, format: 2 }[a.scope] - { campaign: 0, family: 1, format: 2 }[b.scope]));
}

export async function applyRememberedCorrections(config: FreeformConfig, masterId: number, width: number, height: number, family?: string | null): Promise<{ config: FreeformConfig; ruleIds: number[] }> {
  const rules = await correctionsFor(masterId, width, height, family);
  let next = config;
  for (const r of rules) next = applyDeltas(next, r.deltas, width, height);
  return { config: next, ruleIds: rules.map((r) => r.id!).filter(Boolean) };
}
