import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { useGetTemplate, useListTemplates, useListBrands, getGetTemplateQueryKey, getListTemplatesQueryKey, useClaudeReviewTemplate, useUndoClaudeReviewTemplate, Template } from "@workspace/api-client-react";
import { ChevronLeft, Pencil, AlertTriangle, Sparkles, Loader2, RefreshCw, Undo2, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMe } from "@/hooks/use-me";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TemplateThumbnail, LayoutOptions } from "@/components/TemplateRenderer";
import { ExportStaticMenu } from "@/components/ExportStaticMenu";
import { FeedbackButtons, useFeedbackList } from "@/components/FeedbackButtons";
import { ADAPT_PRESETS } from "@/lib/adaptPresets";

type Filter = "all" | "check" | "wrong" | "unreviewed";

function formatClass(w: number, h: number): string {
  const r = w / h;
  if (r >= 5 || (h <= 120 && r >= 2.5)) return "strip";
  if (r <= 0.35) return "tower";
  if (r < 0.8) return "portrait";
  if (r <= 1.25) return "square";
  if (r < 2) return "landscape";
  return "wide";
}
const CLASS_ORDER = ["portrait", "tower", "square", "landscape", "wide", "strip"];

function formatLabel(w: number, h: number): string {
  return ADAPT_PRESETS.find((p) => p.width === w && p.height === h)?.label ?? `${w}×${h}`;
}

function methodLabel(method: string | undefined): { text: string; tone: "rebuilt" | "scaled" | "other" } {
  if (!method) return { text: "scaled", tone: "scaled" };
  if (method.startsWith("recomposed:")) return { text: `rebuilt · ${method.split(":")[1]}`, tone: "rebuilt" };
  if (method === "key-visual") return { text: "re-cropped", tone: "other" };
  if (method === "panel") return { text: "panel rebuilt", tone: "other" };
  return { text: "scaled", tone: "scaled" };
}


interface ClaudeReviewShape {
  verdict: "right" | "wrong";
  confidence: number;
  summary: string;
  issues: Array<{ elementId: string | null; fault: string; message: string; fix: string | null; severity: "send_back" | "fix_next_time"; edit?: unknown }>;
  reviewedAt: string;
  answeredBy?: string;
  guidelinesApplied?: Array<{ topic: string; label: string; elementIds: string[]; sources: string[]; passages: number }>;
  elementChecks?: Array<{ elementId: string; label: string; topics: string[]; status: "ok" | "issue"; note: string | null }>;
}
interface ClaudeFixesShape {
  at: string;
  rounds: number;
  applied: Array<{ elementId: string; label: string; changes: Record<string, { from: unknown; to: unknown }>; deleted?: boolean }>;
  canUndo?: boolean;
}
const claudeReviewOf = (t: Template): ClaudeReviewShape | null =>
  ((t.config as { claudeReview?: ClaudeReviewShape })?.claudeReview) ?? null;
const claudeFixesOf = (t: Template): ClaudeFixesShape | null =>
  ((t.config as { claudeFixes?: ClaudeFixesShape })?.claudeFixes) ?? null;

/** The configured AI guard checks and fixes the piece; this shows the outcome. */
function ClaudeReviewPanel({ template, busy, onCheck, onUndo, undoing }: { template: Template; busy: boolean; onCheck: () => void; onUndo: () => void; undoing: boolean }) {
  const r = claudeReviewOf(template);
  const f = claudeFixesOf(template);
  const remaining = r?.issues.filter((i) => i.severity === "send_back" && !i.edit) ?? [];
  const fixedCount = f?.applied.length ?? 0;
  const touched = f ? Array.from(new Set(f.applied.map((a) => a.label))).slice(0, 4) : [];
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-2.5 space-y-1.5" data-testid={`claude-review-${template.id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-[11px] font-semibold uppercase tracking-wide">AI Artwork Guard</span>
          {r && (
            <Badge
              variant="outline"
              className={`text-[10px] font-normal ${r.verdict === "right" ? "border-emerald-300 text-emerald-700" : "border-amber-300 text-amber-700"}`}
            >
              {r.verdict === "right" ? "signed off" : "needs a designer"} · {Math.round(r.confidence * 100)}%
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {f?.canUndo && (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={onUndo} disabled={busy || undoing} data-testid={`claude-undo-${template.id}`}>
              {undoing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
              Undo
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={onCheck} disabled={busy || undoing} data-testid={`claude-recheck-${template.id}`}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {busy ? "Fixing…" : r ? "Run again" : "Check & fix"}
          </Button>
        </div>
      </div>
      {!r && !busy && <p className="text-xs text-muted-foreground">Not checked yet.</p>}
      {busy && <p className="text-xs text-muted-foreground">The AI Artwork Guard is checking the piece and applying controlled fixes, up to two passes.</p>}
      {r && !busy && (
        <>
          {fixedCount > 0 ? (
            <p className="text-xs text-foreground/90">
              Fixed {fixedCount} thing{fixedCount === 1 ? "" : "s"} in {f!.rounds} pass{f!.rounds === 1 ? "" : "es"}
              {touched.length > 0 ? ` (${touched.join(", ")})` : ""}.
            </p>
          ) : (
            <p className="text-xs text-foreground/90">{r.verdict === "right" ? "Nothing to change." : "Nothing the AI guard could safely change itself."}</p>
          )}
          {remaining.length > 0 && (
            <p className="text-xs text-amber-700 flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>{remaining.length} thing{remaining.length === 1 ? "" : "s"} still need{remaining.length === 1 ? "s" : ""} a designer: {remaining.map((i) => i.message).join(" ")}</span></p>
          )}
          {r.elementChecks && r.elementChecks.length > 0 && (
            <p className="text-[10px] text-muted-foreground" data-testid={`claude-coverage-${template.id}`}>
              Every element checked against the guidelines: {r.elementChecks.length} elements, {r.elementChecks.filter((c) => c.status === "issue").length} with an issue
              {r.elementChecks.some((c) => c.status === "issue") ? ` (${r.elementChecks.filter((c) => c.status === "issue").map((c) => `${c.label}${c.note ? `: ${c.note}` : ""}`).join("; ")})` : ""}.
            </p>
          )}
          {r.guidelinesApplied && r.guidelinesApplied.length > 0 && (
            <p className="text-[10px] text-muted-foreground" data-testid={`claude-guidelines-${template.id}`}>
              Guidelines read: {r.guidelinesApplied.map((g) => g.label.toLowerCase()).join(", ")}
              {" · from "}{Array.from(new Set(r.guidelinesApplied.flatMap((g) => g.sources))).join(", ")}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">{new Date(r.reviewedAt).toLocaleString("en-NZ")}{r.answeredBy ? ` · answered by ${r.answeredBy}` : ""}</p>
        </>
      )}
    </div>
  );
}

/** Review every piece created from a master beside the original it came
 * from: the original stays in view on the left while the pieces scroll,
 * each labelled with how it was made, what the engine wants checked, and
 * the designer's own verdict. */
export default function CompareTemplates() {
  const params = useParams();
  const id = Number(params.id);
  const { data: master, isLoading } = useGetTemplate(id, { query: { queryKey: getGetTemplateQueryKey(id) } });
  const { data: all } = useListTemplates();
  const { data: brands } = useListBrands();
  const { data: feedback } = useFeedbackList("template");
  const brand = brands?.[0];
  const [filter, setFilter] = useState<Filter>("all");
  const [location, setLocation] = useLocation();
  const focusId = Number(new URLSearchParams(window.location.search).get("focus")) || null;

  // Opened from a piece rather than its master? Go to the master's review
  // with this piece highlighted, so the family is always what is shown.
  useEffect(() => {
    if (!master || !all) return;
    let masterId: number | null = master.sourceTemplateId ?? null;
    if (!masterId) {
      const m = /^Adapted from "(.+?)" \(/.exec(master.description ?? "");
      if (m) masterId = all.find((t) => t.name === m[1] && t.id !== master.id)?.id ?? null;
    }
    if (masterId && masterId !== master.id) {
      const real = all.find((t) => t.id === masterId);
      const b = real?.category === "wip" ? "/wip" : "/templates";
      setLocation(`${b}/${masterId}/compare?focus=${master.id}`, { replace: true });
      return;
    }
    // Reviewing a WIP piece (or a WIP family) stays under /wip even when the
    // master it was built from is a Template; only a Templates-only review
    // lives under /templates.
    const focusPiece = focusId ? all.find((t) => t.id === focusId) : undefined;
    const want = master.category === "wip" || focusPiece?.category === "wip" ? "/wip" : "/templates";
    if (!location.startsWith(`${want}/`)) setLocation(`${want}/${master.id}/compare${focusId ? `?focus=${focusId}` : ""}`, { replace: true });
  }, [master, all, setLocation, location, focusId]);

  useEffect(() => {
    if (!focusId) return;
    const el = document.querySelector(`[data-testid="compare-card-${focusId}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [focusId, all]);

  const pieces = useMemo(() => {
    if (!master) return [];
    const prefix = `Adapted from "${master.name}"`;
    return (all ?? [])
      .filter((t) => t.id !== master.id && (t.sourceTemplateId === master.id || (t.description ?? "").startsWith(prefix)))
      .sort((a, b) => {
        const ca = CLASS_ORDER.indexOf(formatClass(a.width, a.height));
        const cb = CLASS_ORDER.indexOf(formatClass(b.width, b.height));
        return ca - cb || a.width * a.height - b.width * b.height;
      });
  }, [all, master]);

  // Latest designer verdict per piece.
  const verdicts = useMemo(() => {
    const m = new Map<number, "correct" | "incorrect">();
    for (const f of [...(feedback?.items ?? [])].sort((a, b) => a.id - b.id)) {
      if (f.subjectType === "template") m.set(f.subjectId, f.verdict);
    }
    return m;
  }, [feedback]);

  // Claude's final check: every piece gets one automatically the first time it
  // is seen here (two at a time, never twice); Re-check runs it again.
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const claudeReview = useClaudeReviewTemplate();
  const undoReview = useUndoClaudeReviewTemplate();
  const [undoing, setUndoing] = useState<Set<number>>(new Set());
  const { data: me } = useMe();
  const signedIn = !!me;
  const [checking, setChecking] = useState<Set<number>>(new Set());
  const requested = useRef<Set<number>>(new Set());
  const runCheck = async (id: number) => {
    setChecking((prev) => new Set(prev).add(id));
    try {
      await claudeReview.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
    } catch (err) {
      const status = (err as { response?: { status?: number }; status?: number })?.response?.status ?? (err as { status?: number })?.status;
      if (status === 404) return; // deleted while the check was queued
      const detail = (err as { data?: { error?: string } })?.data?.error ?? (err instanceof Error ? err.message : "");
      toast({ title: "AI Artwork Guard couldn't check this piece", description: detail || undefined, variant: "destructive" });
    } finally {
      setChecking((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };
  const runUndo = async (id: number) => {
    setUndoing((prev) => new Set(prev).add(id));
    try {
      await undoReview.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
      toast({ title: "AI Artwork Guard changes undone" });
    } catch (err) {
      toast({ title: "Couldn't undo", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setUndoing((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };
  useEffect(() => {
    if (!signedIn) return; // checks are auth-gated; a signed-out viewer just reads
    // Pieces marked Right are the standard and are left alone; everything
    // else (undecided or marked Wrong) is checked and fixed against them.
    // Auto-check at most six pieces per visit (each check is a few cents and
    // ~30s); the rest wait for Check & fix so a 60-piece family can't spend
    // dollars on a page load.
    if (requested.current.size >= 6) return;
    const pending = pieces.filter((t) => !claudeReviewOf(t) && verdicts.get(t.id) !== "correct" && !requested.current.has(t.id) && !checking.has(t.id));
    const slots = Math.max(0, Math.min(2 - checking.size, 6 - requested.current.size));
    for (const t of pending.slice(0, slots)) {
      requested.current.add(t.id);
      void runCheck(t.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces, checking, verdicts, signedIn]);

  if (isLoading || !master) {
    return <div className="w-full"><Skeleton className="h-96 rounded-lg" /></div>;
  }

  const notesOf = (t: Template): string[] => ((t.config as { adaptNotes?: string[] })?.adaptNotes ?? []);
  const checksOf = (t: Template) => notesOf(t).filter((n) => n.startsWith("Check:"));
  const visible = pieces.filter((t) => {
    if (filter === "check") return checksOf(t).length > 0;
    if (filter === "wrong") return verdicts.get(t.id) === "incorrect";
    if (filter === "unreviewed") return !verdicts.has(t.id);
    return true;
  });
  const counts = {
    all: pieces.length,
    check: pieces.filter((t) => checksOf(t).length > 0).length,
    wrong: pieces.filter((t) => verdicts.get(t.id) === "incorrect").length,
    unreviewed: pieces.filter((t) => !verdicts.has(t.id)).length,
  };
  const masterCfg = master.config as { kind?: string; elements?: any[] };
  const masterTall = master.height > master.width * 1.2;

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center gap-4 flex-wrap">
        <Link href={location.startsWith("/wip/") ? (focusId ? `/wip/${focusId}` : "/wip") : `/templates/${master.id}`} className="p-2 hover:bg-muted rounded-full transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Review against the original</h1>
          <p className="text-muted-foreground text-sm mt-1 truncate">
            {master.name} · {pieces.length} piece{pieces.length === 1 ? "" : "s"} created from it
          </p>
        </div>
        {location.startsWith("/wip/") && (
          <Link href={`/wip/banners?family=${master.id}`}>
            <Button type="button" variant="outline" className="gap-1.5" data-testid="button-family-banner-preview" title="See every size playing together as HTML banners">
              <Play className="w-4 h-4" />HTML banner preview
            </Button>
          </Link>
        )}
        <ExportStaticMenu templateId={master.id} templateName={master.name} familyIds={[master.id, ...pieces.map((t) => t.id)]} />
      </div>

      {pieces.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing has been created from this artwork yet — use “Adapt to other sizes” on it, or build a campaign with it as an example.</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* The original stays put while the pieces scroll. */}
        <div className="lg:col-span-4 lg:sticky lg:top-4 space-y-3">
          <Card className="border-border/50 overflow-hidden" data-testid="compare-original">
            <div className="flex items-center justify-center bg-muted/30 p-4" style={{ height: masterTall ? 520 : 360 }}>
              {brand && (
                <TemplateThumbnail
                  templateSize={master.key}
                  maxWidth={440}
                  maxHeight={(masterTall ? 520 : 360) - 32}
                  overrideConfig={{ width: master.width, height: master.height, layout: master.config as LayoutOptions, kind: masterCfg.kind, elements: masterCfg.elements }}
                  brand={brand}
                />
              )}
            </div>
            <div className="p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold truncate">{master.name}</p>
                <Badge variant="secondary" className="shrink-0">Original</Badge>
              </div>
              <p className="text-xs text-muted-foreground font-mono">{master.width}×{master.height} · {formatLabel(master.width, master.height)}</p>
              <p className="text-xs text-muted-foreground">{master.description?.startsWith("Example artwork imported from") ? master.description : "As imported — every piece on the right was built from this."}</p>
              {master.sourceImageUrl && (
                <a href={master.sourceImageUrl} target="_blank" rel="noreferrer" className="block mt-2">
                  <img src={master.sourceImageUrl} alt="Uploaded file" className="max-h-40 w-auto border border-border/60 bg-white" />
                  <span className="text-[11px] text-muted-foreground">Uploaded file</span>
                </a>
              )}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-8 space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            {([
              ["all", `All (${counts.all})`],
              ["check", `Needs a check (${counts.check})`],
              ["wrong", `Marked wrong (${counts.wrong})`],
              ["unreviewed", `Not reviewed (${counts.unreviewed})`],
            ] as [Filter, string][]).map(([key, label]) => (
              <Button key={key} type="button" size="sm" variant={filter === key ? "default" : "outline"} className="h-7" onClick={() => setFilter(key)} data-testid={`compare-filter-${key}`}>
                {label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {visible.map((t) => {
              const cfg = t.config as { kind?: string; elements?: any[]; adaptMethod?: string };
              const method = methodLabel(cfg.adaptMethod);
              const checks = checksOf(t);
              const verdict = verdicts.get(t.id);
              const tall = t.height > t.width * 1.3;
              const cls = formatClass(t.width, t.height);
              const focused = t.id === focusId;
              return (
                <Card
                  key={t.id}
                  className={`border-border/50 overflow-hidden ${focused ? "ring-2 ring-primary" : verdict === "incorrect" ? "ring-1 ring-red-300" : verdict === "correct" ? "ring-1 ring-emerald-300" : ""}`}
                  data-testid={`compare-card-${t.id}`}
                >
                  <div className="flex items-center justify-center bg-muted/30 p-4" style={{ height: tall ? 420 : 300 }}>
                    {brand && (
                      <TemplateThumbnail
                        templateSize={t.key}
                        maxWidth={480}
                        maxHeight={(tall ? 420 : 300) - 32}
                        overrideConfig={{ width: t.width, height: t.height, layout: t.config as LayoutOptions, kind: cfg.kind, elements: cfg.elements }}
                        brand={brand}
                      />
                    )}
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate" title={t.name}>{formatLabel(t.width, t.height)}</p>
                        <p className="text-xs text-muted-foreground font-mono">{t.width}×{t.height} · {cls}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {focused && <Badge className="text-[10px] font-normal">this piece</Badge>}
                        <Badge variant="outline" className={`text-[10px] font-normal ${method.tone === "rebuilt" ? "border-primary/40 text-primary" : ""}`}>{method.text}</Badge>
                        {verdict === "correct" && <Badge variant="outline" className="text-[10px] font-normal border-emerald-300 text-emerald-700">right</Badge>}
                        {verdict === "incorrect" && <Badge variant="outline" className="text-[10px] font-normal border-red-300 text-red-700">wrong</Badge>}
                      </div>
                    </div>
                    {(() => {
                      const pr = (t.config as { principles?: { alignment: number; margins: number; balance: number; contrast: number | null } })?.principles;
                      if (!pr) return null;
                      const pct = (n: number) => `${Math.round(n * 100)}%`;
                      const tone = (n: number) => (n >= 0.85 ? "text-emerald-700" : n >= 0.6 ? "text-amber-700" : "text-red-700");
                      return (
                        <p className="text-[10px] text-muted-foreground flex flex-wrap gap-x-2" data-testid={`principles-${t.id}`} title="Design principles measured on this size: alignment with the master, margins kept clear, balance of visual weight, and the worst contrast ratio behind copy">
                          <span>Alignment <b className={tone(pr.alignment)}>{pct(pr.alignment)}</b></span>
                          <span>Margins <b className={tone(pr.margins)}>{pct(pr.margins)}</b></span>
                          <span>Balance <b className={tone(pr.balance)}>{pct(pr.balance)}</b></span>
                          {pr.contrast != null && <span>Contrast <b className={pr.contrast >= 4.5 ? "text-emerald-700" : pr.contrast >= 3 ? "text-amber-700" : "text-red-700"}>{pr.contrast.toFixed(1)}:1</b></span>}
                        </p>
                      );
                    })()}
                    {checks.length > 0 && (
                      <ul className="text-xs text-amber-700 space-y-0.5">
                        {checks.slice(0, 2).map((c, i) => (
                          <li key={i} className="flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>{c.replace(/^Check:\s*/, "")}</span></li>
                        ))}
                        {checks.length > 2 && <li className="text-muted-foreground">+{checks.length - 2} more in the editor</li>}
                      </ul>
                    )}
                    <ClaudeReviewPanel template={t} busy={checking.has(t.id)} undoing={undoing.has(t.id)} onCheck={() => { requested.current.add(t.id); void runCheck(t.id); }} onUndo={() => void runUndo(t.id)} />
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <FeedbackButtons subjectType="template" subjectId={t.id} />
                      {/* A WIP review never links into Templates: siblings that
                          already are templates show as reference only. */}
                      {location.startsWith("/wip/") && t.category !== "wip" ? (
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" title="Already a template — reference only">Template</span>
                      ) : (
                        <Link href={`${t.category === "wip" ? "/wip" : "/templates"}/${t.id}`}>
                          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5">
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
            {visible.length === 0 && pieces.length > 0 && (
              <p className="text-sm text-muted-foreground md:col-span-2">Nothing matches this filter.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
