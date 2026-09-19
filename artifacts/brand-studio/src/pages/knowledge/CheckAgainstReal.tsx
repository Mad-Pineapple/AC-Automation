import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearch } from "wouter";
import { useAuth } from "@clerk/react";
import { useListBrands, useListTemplates, type Template } from "@workspace/api-client-react";
import { ChevronLeft, GraduationCap, Loader2, Ruler, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TemplateThumbnail, type LayoutOptions } from "@/components/TemplateRenderer";
import { OrientationTag } from "@/components/SizePicker";
import { useToast } from "@/hooks/use-toast";
import { useMe } from "@/hooks/use-me";
import { tokenOrNull } from "@/lib/authToken";

/**
 * Check against a real file. Pick a size your studio actually made and a
 * master to build it from: the studio builds that size (saving nothing),
 * measures both the same way and shows where they differ, in points a
 * designer can picture. "Learn from this file" then adds the real file to
 * the campaign's layout, so its shape is measured instead of estimated.
 */

interface Metric { key: string; label: string; group: string; real: number | null; built: number | null; gap: number | null }
interface Result {
  real: { id: number; name: string; width: number; height: number };
  metrics: Metric[];
  averageGap: number | null;
  missingInBuilt: string[];
  extraInBuilt: string[];
  verdict: string;
  method: string;
  rejected: string[];
  builtConfig: { kind?: string; elements?: unknown[] } & Record<string, unknown>;
}

/** The shared thumbnail caps its own scale; a comparison needs the two
 *  pieces large enough to judge by eye, so the rendered thumbnail is zoomed
 *  to fill the box it is given. */
function FitPreview({ width, height, maxW, maxH, children }: { width: number; height: number; maxW: number; maxH: number; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const k = Math.min(maxW / width, maxH / height);
  useLayoutEffect(() => {
    const el = inner.current?.firstElementChild as HTMLElement | null;
    if (!el || !el.offsetWidth) return;
    setZoom((width * k) / el.offsetWidth);
  }, [width, height, k, children]);
  return (
    <div style={{ width: Math.round(width * k), height: Math.round(height * k), overflow: "hidden" }}>
      <div ref={inner} style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: "max-content" }}>{children}</div>
    </div>
  );
}

const gapClass = (g: number | null) =>
  g == null ? "text-muted-foreground" : Math.abs(g) <= 2 ? "text-[#3d7a1f]" : Math.abs(g) <= 5 ? "text-amber-700" : "text-red-700 font-semibold";

export default function CheckAgainstReal() {
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const { data: templates, isLoading } = useListTemplates();
  const { data: brands } = useListBrands();
  const brand = brands?.[0];
  const { getToken } = useAuth();
  const { toast } = useToast();
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";

  // Real files and masters are the same kind of thing: an imported piece
  // with live layers that nothing else was built into.
  const masters = useMemo(
    () => (templates ?? []).filter((t) => t.config?.kind === "freeform" && !t.sourceTemplateId).sort((a, b) => b.id - a.id),
    [templates],
  );
  const [realId, setRealId] = useState<string>(params.get("real") ?? "");
  const [fromId, setFromId] = useState<string>(params.get("from") ?? "");
  const real = masters.find((m) => String(m.id) === realId);
  const from = masters.find((m) => String(m.id) === fromId);
  const [busy, setBusy] = useState<"check" | "learn" | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [before, setBefore] = useState<number | null>(null);

  const call = useCallback(async (path: string, body: unknown) => {
    const token = await tokenOrNull(getToken);
    return fetch(path, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  }, [getToken]);

  const runCheck = async (keepBefore = false): Promise<Result | null> => {
    if (!real || !from) return null;
    setBusy("check");
    try {
      const built = await call(`/api/templates/${from.id}/adapt`, { dryRun: true, targets: [{ width: real.width, height: real.height }] });
      if (!built.ok) throw new Error((await built.json().catch(() => null))?.error ?? "The size could not be built.");
      const b = (await built.json()) as { built: Array<{ method: string; rejected: string[]; config: Result["builtConfig"] }> };
      const piece = b.built?.[0];
      if (!piece) throw new Error("The size could not be built.");
      const cmp = await call("/api/layout-compare", { realId: real.id, builtConfig: piece.config });
      if (!cmp.ok) throw new Error((await cmp.json().catch(() => null))?.error ?? "The two pieces could not be measured.");
      const out = { ...(await cmp.json()), method: piece.method, rejected: piece.rejected ?? [], builtConfig: piece.config } as Result;
      if (!keepBefore) setBefore(null);
      setResult(out);
      return out;
    } catch (err) {
      toast({ title: "Check failed", description: err instanceof Error ? err.message.slice(0, 200) : undefined, variant: "destructive" });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const learn = async () => {
    if (!real || !from || !result) return;
    if (!confirm(`Add "${real.name}" (${real.width}×${real.height}) to the layout "${from.name}" builds from?\n\nNew sizes of that shape will then use the numbers MEASURED on your file instead of the studio's estimate. Other shapes keep their numbers. This changes what future builds look like for this campaign.`)) return;
    const was = result.averageGap;
    setBusy("learn");
    const res = await call("/api/layout-profiles/learn-from-real", { masterId: from.id, realId: real.id });
    setBusy(null);
    if (!res.ok) { toast({ title: "Not learned", description: (await res.json().catch(() => null))?.error, variant: "destructive" }); return; }
    setBefore(was);
    const after = await runCheck(true);
    toast({ title: "Learned from your file", description: after?.averageGap != null && was != null ? `Average gap ${was} → ${after.averageGap} points.` : undefined });
  };

  const groups = useMemo(() => {
    const m = new Map<string, Metric[]>();
    for (const x of result?.metrics ?? []) m.set(x.group, [...(m.get(x.group) ?? []), x]);
    return [...m.entries()];
  }, [result]);

  const thumb = (t: { width: number; height: number; key?: string }, config: unknown) =>
    brand ? (
      <FitPreview width={t.width} height={t.height} maxW={520} maxH={420}>
      <TemplateThumbnail
        maxWidth={520}
        maxHeight={420}
        templateSize={(t.key ?? "custom") as never}
        overrideConfig={{ width: t.width, height: t.height, layout: config as LayoutOptions, kind: (config as { kind?: string })?.kind, elements: (config as { elements?: unknown[] })?.elements } as never}
        brand={brand}
      />
      </FitPreview>
    ) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/knowledge/styles" className="rounded-full p-2 transition-colors hover:bg-muted"><ChevronLeft className="h-5 w-5" /></Link>
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Check against a real file</h1>
          <p className="mt-1.5 max-w-3xl text-muted-foreground">
            Pick a size your studio actually made, and a master of a different shape to build it from. The studio builds that size, measures both the same way and shows where they differ. Nothing is saved.
          </p>
        </div>
      </div>

      <Card className="border-border/60">
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <Picker label="Real file (made by the studio)" value={realId} onChange={(v) => { setRealId(v); setResult(null); }} items={masters.filter((m) => String(m.id) !== fromId)} testId="select-real" loading={isLoading} />
          <Picker label="Build it from this master" value={fromId} onChange={(v) => { setFromId(v); setResult(null); }} items={masters.filter((m) => String(m.id) !== realId)} testId="select-from" loading={isLoading} />
          <Button onClick={() => runCheck()} disabled={!real || !from || busy !== null || !isAdmin} data-testid="button-run-check" title={!isAdmin ? "Only an admin can run a build" : undefined}>
            {busy === "check" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Scale className="mr-2 h-4 w-4" />}
            Build and compare
          </Button>
        </CardContent>
        {real && from && real.width === from.width && real.height === from.height && (
          <p className="px-6 pb-4 text-xs text-amber-800">These two are the same size, so the build is an exact copy. Choose a master of a different shape to learn something.</p>
        )}
      </Card>

      {result && real && (
        <>
          <Card className="border-border/60" data-testid="check-result">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-3 text-lg">
                <span className={`rounded-md px-2.5 py-1 text-base ${result.averageGap == null ? "bg-muted" : result.averageGap <= 2 ? "bg-[#e6f2dc] text-[#2f5f17]" : result.averageGap <= 5 ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-900"}`} data-testid="text-average-gap">
                  {result.averageGap == null ? "—" : `${result.averageGap} pts`} average gap
                </span>
                {before != null && result.averageGap != null && <span className="text-sm font-normal text-muted-foreground">was {before} pts before learning</span>}
              </CardTitle>
              <p className="text-sm text-muted-foreground">{result.verdict}</p>
              {result.rejected.length > 0 && <p className="text-sm text-red-700">The build was rejected by the quality gate: {result.rejected.join(" ")}</p>}
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 lg:grid-cols-2">
                <figure>
                  <figcaption className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">Your file</figcaption>
                  <div className="flex items-center justify-center rounded border border-border/60 bg-muted/30 p-3">{thumb(real, real.config)}</div>
                </figure>
                <figure>
                  <figcaption className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">Built by the studio <span className="font-normal normal-case">({result.method.replace(":", " ")})</span></figcaption>
                  <div className="flex items-center justify-center rounded border border-border/60 bg-muted/30 p-3">{thumb({ width: real.width, height: real.height }, result.builtConfig)}</div>
                </figure>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-lg"><Ruler className="h-4 w-4" /> Where they differ</CardTitle>
              <p className="text-xs text-muted-foreground">Every number is a share, so sizes compare like for like. The gap is in percentage points: green within 2, amber within 5, red beyond.</p>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm" data-testid="table-gaps">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 font-semibold">Measured</th>
                    <th className="py-1.5 text-right font-semibold">Your file</th>
                    <th className="py-1.5 text-right font-semibold">Built</th>
                    <th className="py-1.5 text-right font-semibold">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(([group, rows]) => (
                    <GroupRows key={group} group={group} rows={rows} />
                  ))}
                </tbody>
              </table>
              {(result.missingInBuilt.length > 0 || result.extraInBuilt.length > 0) && (
                <p className="mt-3 text-sm">
                  {result.missingInBuilt.length > 0 && <span className="text-red-700">Left out of the build: {result.missingInBuilt.join(", ")}. </span>}
                  {result.extraInBuilt.length > 0 && <span className="text-muted-foreground">In the build but not in your file: {result.extraInBuilt.join(", ")}.</span>}
                </p>
              )}
              {isAdmin && (
                <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border/50 pt-4">
                  <Button variant="outline" onClick={learn} disabled={busy !== null} data-testid="button-learn-real">
                    {busy === "learn" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GraduationCap className="mr-2 h-4 w-4" />}
                    Learn from this file
                  </Button>
                  <p className="max-w-xl text-xs text-muted-foreground">
                    Adds your file to the layout this master builds from, so its shape is measured rather than estimated. Worth doing when the gap is amber or red. The check re-runs afterwards so you can see what it gained.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function GroupRows({ group, rows }: { group: string; rows: Metric[] }) {
  return (
    <>
      <tr><td colSpan={4} className="pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{group}</td></tr>
      {rows.map((m) => (
        <tr key={m.key} className="border-b border-border/30">
          <td className="py-1.5">{m.label}</td>
          <td className="py-1.5 text-right tabular-nums">{m.real == null ? "—" : `${m.real}%`}</td>
          <td className="py-1.5 text-right tabular-nums">{m.built == null ? "—" : `${m.built}%`}</td>
          <td className={`py-1.5 text-right tabular-nums ${gapClass(m.gap)}`}>{m.gap == null ? "—" : `${m.gap > 0 ? "+" : ""}${m.gap}`}</td>
        </tr>
      ))}
    </>
  );
}

function Picker({ label, value, onChange, items, testId, loading }: { label: string; value: string; onChange: (v: string) => void; items: Template[]; testId: string; loading: boolean }) {
  return (
    <label className="flex min-w-[300px] flex-1 flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
      {label}
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger data-testid={testId}><SelectValue placeholder={loading ? "Loading…" : "Choose artwork"} /></SelectTrigger>
        <SelectContent className="max-h-[360px]">
          {items.slice(0, 200).map((t) => (
            <SelectItem key={t.id} value={String(t.id)}>
              <span className="inline-flex items-center gap-2">
                <span className="max-w-[340px] truncate">{t.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{t.width}×{t.height}</span>
                <OrientationTag width={t.width} height={t.height} />
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
