import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@clerk/react";
import { Archive, ArchiveRestore, ChevronLeft, Combine, Loader2, Ruler, Scale, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useMe } from "@/hooks/use-me";
import { tokenOrNull } from "@/lib/authToken";
import { OrientationTag } from "@/components/SizePicker";

/**
 * Campaign styles — the part of the knowledge base that actually sets the
 * numbers every build uses, shown the way a designer would say them ("the
 * pill is 30% of the heading"). One entry per campaign: the layout in use,
 * the masters it was measured from, what designers have said about its
 * pieces, and any layouts set aside.
 */

interface Master { id: number; name: string; width: number; height: number; axis: "stacked" | "side"; exists: boolean }
interface Layout { id: number; name: string; archived: boolean; updatedAt: string; measuredAxes: string[]; masters: Master[]; plain: string[] }
interface Wrong { part: string | null; fault: string | null; expected: string | null; note: string | null; size: string | null }
interface Campaign { key: string; name: string; layouts: Layout[]; separate: boolean; feedback: { right: number; wrong: number; wrongs: Wrong[] } }

export default function CampaignStyles() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const togglePick = (id: number) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const { getToken } = useAuth();
  const { toast } = useToast();
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";

  const call = useCallback(async (path: string, init?: RequestInit) => {
    const token = await tokenOrNull(getToken);
    return fetch(path, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } });
  }, [getToken]);

  const load = useCallback(async () => {
    try {
      const res = await call("/api/layout-profiles/campaigns");
      setCampaigns(res.ok ? await res.json() : []);
    } catch { setCampaigns([]); }
  }, [call]);
  useEffect(() => { void load(); }, [load]);

  const setArchived = async (layout: Layout, archived: boolean) => {
    setBusy(`a${layout.id}`);
    const res = await call(`/api/layout-profiles/${layout.id}/archive`, { method: "POST", body: JSON.stringify({ archived }) });
    setBusy(null);
    toast(res.ok ? { title: archived ? "Layout set aside" : "Layout restored", description: archived ? "It is no longer used for builds. Nothing was deleted." : "It can be used for builds again." } : { title: "Could not change the layout", variant: "destructive" });
    void load();
  };

  const combine = async (c: Campaign) => {
    const live = c.layouts.filter((l) => !l.archived && picked.has(l.id));
    const sizes = [...new Set(live.flatMap((l) => l.masters.filter((m) => m.exists).map((m) => `${m.width}×${m.height}`)))];
    if (!confirm(`Learn ONE layout from the ${live.length} you ticked (${sizes.join(", ")})?\n\nThey are set aside, not deleted — you can restore them. Tall sizes keep the tall masters' numbers and wide sizes the wide masters'.`)) return;
    setBusy(`c${c.key}`);
    const res = await call("/api/layout-profiles/combine", { method: "POST", body: JSON.stringify({ profileIds: live.map((l) => l.id), name: c.name }) });
    setBusy(null);
    toast(res.ok ? { title: "Combined into one layout", description: "New sizes built from those masters now read one set of measured numbers." } : { title: "Not combined", description: (await res.json().catch(() => null))?.error, variant: "destructive" });
    if (res.ok) setPicked(new Set());
    void load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/knowledge" className="rounded-full p-2 transition-colors hover:bg-muted"><ChevronLeft className="h-5 w-5" /></Link>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Campaign styles</h1>
            <Link href="/knowledge/check">
              <Button variant="outline" size="sm" data-testid="button-check-real"><Scale className="mr-2 h-4 w-4" />Check against a real file</Button>
            </Link>
          </div>
          <p className="mt-1.5 text-muted-foreground">
            The measured numbers every new size is built from, per campaign. Learned from the masters you upload; shown here in plain words.
          </p>
        </div>
      </div>

      {campaigns === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Reading the learned layouts…</p>
      ) : campaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No campaign has been measured yet. Upload an InDesign package in Artwork WIP — its layout is measured as it imports.
        </div>
      ) : (
        campaigns.map((c) => {
          const live = c.layouts.filter((l) => !l.archived);
          const aside = c.layouts.filter((l) => l.archived);
          return (
            <Card key={c.key} className="border-border/60" data-testid={`campaign-style-${c.key}`}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-xl">{c.name}</CardTitle>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5 text-[#5b9c33]" /> {c.feedback.right} marked right</span>
                      <span className="inline-flex items-center gap-1"><ThumbsDown className="h-3.5 w-3.5 text-red-600" /> {c.feedback.wrong} marked wrong</span>
                      <span>{live.length} layout{live.length === 1 ? "" : "s"} in use{aside.length ? ` · ${aside.length} set aside` : ""}</span>
                    </div>
                  </div>
                  {isAdmin && c.separate && (
                    <Button variant="outline" onClick={() => combine(c)} disabled={busy !== null || c.layouts.filter((l) => !l.archived && picked.has(l.id)).length < 2} data-testid={`button-combine-${c.key}`} title="Learn one layout from all of this campaign's masters">
                      {busy === `c${c.key}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Combine className="mr-2 h-4 w-4" />}
                      Combine ticked layouts
                    </Button>
                  )}
                </div>
                {c.separate && (
                  <p className="mt-2 rounded border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    This campaign was imported more than once, and each import learned its own layout. A size built from a tall master does not see what was measured on the wide one. Tick ONE tall layout and ONE wide layout of the same artwork and combine them; leave test imports and other channels (DV360, bridge exports) alone.
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {live.map((l) => (
                  <LayoutBlock key={l.id} layout={l} isAdmin={isAdmin} busy={busy === `a${l.id}`} onArchive={live.length > 1 ? () => setArchived(l, true) : undefined} picked={c.separate && isAdmin ? picked.has(l.id) : undefined} onPick={() => togglePick(l.id)} />
                ))}
                {c.feedback.wrongs.length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">What designers marked wrong</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
                      {c.feedback.wrongs.map((w, i) => (
                        <li key={i}>
                          {w.part && <span className="font-medium text-foreground">{w.part}: </span>}
                          {[w.fault, w.expected ? `expected ${w.expected}` : null, w.note].filter(Boolean).join(" — ")}
                          {w.size && <span className="ml-1 font-mono text-[11px]">({w.size})</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {aside.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-muted-foreground">Set aside ({aside.length})</summary>
                    <div className="mt-2 space-y-3">
                      {aside.map((l) => (
                        <LayoutBlock key={l.id} layout={l} isAdmin={isAdmin} busy={busy === `a${l.id}`} onRestore={() => setArchived(l, false)} />
                      ))}
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

function LayoutBlock({ layout, isAdmin, busy, onArchive, onRestore, picked, onPick }: { layout: Layout; isAdmin: boolean; busy: boolean; onArchive?: () => void; onRestore?: () => void; picked?: boolean; onPick?: () => void }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${layout.archived ? "border-border/50 bg-muted/20 opacity-80" : "border-border/70 bg-muted/30"}`} data-testid={`layout-${layout.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {picked !== undefined && (
            <input type="checkbox" checked={picked} onChange={onPick} className="h-4 w-4 accent-[#005b9f]" aria-label={`Tick ${layout.name} to combine`} data-testid={`pick-layout-${layout.id}`} />
          )}
          <Ruler className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{layout.name}</span>
          {layout.archived ? <Badge variant="outline" className="text-[10px]">Set aside</Badge> : <Badge className="bg-[#5b9c33] text-[10px] text-white hover:bg-[#5b9c33]">In use</Badge>}
          <span className="text-[11px] text-muted-foreground">measured {new Date(layout.updatedAt).toLocaleDateString()}</span>
        </div>
        {isAdmin && onArchive && (
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={onArchive} disabled={busy} data-testid={`button-archive-${layout.id}`}>
            <Archive className="h-3.5 w-3.5" /> Set aside
          </Button>
        )}
        {isAdmin && onRestore && (
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={onRestore} disabled={busy} data-testid={`button-restore-${layout.id}`}>
            <ArchiveRestore className="h-3.5 w-3.5" /> Restore
          </Button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {layout.masters.map((m) => (
          <span key={m.id} className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] ${m.exists ? "border-border/70 bg-background" : "border-dashed border-border/60 text-muted-foreground line-through"}`} title={m.exists ? m.name : `${m.name} — no longer in the studio`}>
            {m.exists ? <Link href={`/wip/${m.id}`} className="hover:underline">{m.name.split(" — ").pop()}</Link> : m.name.split(" — ").pop()}
            <span className="font-mono">{m.width}×{m.height}</span>
            <OrientationTag width={m.width} height={m.height} />
          </span>
        ))}
      </div>
      <ul className="mt-2.5 list-disc space-y-1 pl-4 text-sm text-foreground/90">
        {layout.plain.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
    </div>
  );
}
