import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { useAuth } from "@clerk/react";
import { useListTemplates, type Template } from "@workspace/api-client-react";
import { ArrowLeft, Loader2, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tokenOrNull } from "@/lib/authToken";
import { OrientationTag } from "@/components/SizePicker";
import { ADAPT_PRESETS } from "@/lib/adaptPresets";

/** Sizes produced as HTML5 banners (the HTML group of the size catalogue,
 *  plus the common IAB sizes a family may also hold). */
const HTML_SIZES = new Set<string>([
  ...ADAPT_PRESETS.filter((p) => p.group === "HTML").map((p) => `${p.width}x${p.height}`),
  "336x280", "160x600", "970x90", "320x100", "300x50", "468x60", "250x250", "300x1050",
]);

/**
 * HTML banner preview: every size of a family playing together as the real
 * HTML5 banner (the same document the export packages), so a rollout is
 * judged as a set — motion included — before anything is downloaded.
 *
 * WIP only: it reads WIP pieces and links back into WIP. Nothing here
 * registers a creative or touches Templates.
 */

type Animation = "entrance" | "kenburns" | "frames" | "reveal" | "none";
const ANIMATIONS: { value: Animation; label: string }[] = [
  { value: "entrance", label: "Entrance" },
  { value: "kenburns", label: "Ken Burns" },
  { value: "frames", label: "Story frames" },
  { value: "reveal", label: "Reveal" },
  { value: "none", label: "No motion" },
];

/** Widest a banner is drawn; larger ones are scaled down to fit. */
const MAX_W = 970;
const MAX_H = 620;

interface Loaded { html: string | null; error: string | null }

function BannerTile({ template, loaded, replayKey, maxW }: { template: Template; loaded: Loaded | undefined; replayKey: number; maxW: number }) {
  const [localKey, setLocalKey] = useState(0);
  const scale = Math.min(1, maxW / template.width, MAX_H / template.height);
  const w = Math.round(template.width * scale);
  const h = Math.round(template.height * scale);
  return (
    <div className="flex flex-col gap-1.5" data-testid={`banner-tile-${template.id}`}>
      <div className="flex items-center justify-between gap-3" style={{ width: Math.max(w, 150) }}>
        <div className="text-xs font-semibold tabular-nums">
          {template.width}×{template.height} <OrientationTag width={template.width} height={template.height} />
          {scale < 1 && <span className="ml-1.5 font-normal text-muted-foreground">shown at {Math.round(scale * 100)}%</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setLocalKey((k) => k + 1)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Replay this banner"
            data-testid={`button-replay-${template.id}`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <Link href={`/wip/${template.id}`} title="Open in the editor" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Pencil className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
      <div className="overflow-hidden rounded border border-border bg-muted/40 shadow-sm" style={{ width: w, height: h }}>
        {!loaded ? (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : loaded.html ? (
          <iframe
            key={`${replayKey}-${localKey}`}
            srcDoc={loaded.html}
            sandbox="allow-scripts"
            scrolling="no"
            title={`${template.name} HTML banner`}
            style={{ width: template.width, height: template.height, border: 0, transform: `scale(${scale})`, transformOrigin: "top left" }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-2 text-center text-[11px] text-muted-foreground">
            {loaded.error ?? "This piece cannot be shown as an HTML banner."}
          </div>
        )}
      </div>
      <div className="truncate text-[11px] text-muted-foreground" style={{ maxWidth: Math.max(w, 150) }} title={template.name}>
        {template.name}
      </div>
    </div>
  );
}

export default function BannerPreview() {
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const idsParam = params.get("ids");
  const familyParam = params.get("family");
  const { data: allTemplates, isLoading } = useListTemplates();
  const { getToken } = useAuth();

  const wip = useMemo(
    () => (allTemplates ?? []).filter((t) => t.category === "wip" && t.config?.kind === "freeform"),
    [allTemplates],
  );
  // A family is a master and every WIP size made from it.
  const masters = useMemo(() => {
    const childCount = new Map<number, number>();
    const newest = new Map<number, number>();
    for (const t of wip) {
      if (!t.sourceTemplateId) continue;
      childCount.set(t.sourceTemplateId, (childCount.get(t.sourceTemplateId) ?? 0) + 1);
      newest.set(t.sourceTemplateId, Math.max(newest.get(t.sourceTemplateId) ?? 0, t.id));
    }
    // Most recently worked-on artwork first: the family someone just built
    // is the one they came here to see.
    return wip
      .filter((t) => !t.sourceTemplateId || !wip.some((m) => m.id === t.sourceTemplateId))
      .map((t) => ({ master: t, sizes: childCount.get(t.id) ?? 0, latest: Math.max(t.id, newest.get(t.id) ?? 0) }))
      .sort((a, b) => b.latest - a.latest);
  }, [wip]);

  const explicitIds = useMemo(
    () => (idsParam ? idsParam.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0) : []),
    [idsParam],
  );
  const [family, setFamily] = useState<number | null>(familyParam ? Number(familyParam) : null);
  useEffect(() => {
    if (explicitIds.length || family !== null || !masters.length) return;
    setFamily(masters[0].master.id);
  }, [explicitIds.length, family, masters]);

  // OOH and social sizes are not HTML banners; they stay out unless asked for.
  const [scope, setScope] = useState<"html" | "all">("html");
  const pieces = useMemo(() => {
    const list = explicitIds.length
      ? wip.filter((t) => explicitIds.includes(t.id))
      : family !== null
        ? wip.filter((t) => t.id === family || t.sourceTemplateId === family)
        : [];
    // One of each size (the newest build wins), widest first, then tallest.
    const bySize = new Map<string, Template>();
    for (const t of [...list].sort((a, b) => a.id - b.id)) bySize.set(`${t.width}x${t.height}`, t);
    const unique = explicitIds.length ? list : [...bySize.values()];
    const banners = unique.filter((t) => HTML_SIZES.has(`${t.width}x${t.height}`));
    const shown = scope === "html" && banners.length ? banners : unique;
    return shown.sort((a, b) => b.width / b.height - a.width / a.height || b.width - a.width);
  }, [explicitIds, family, wip, scope]);

  // Banners never run wider than the page: a 970 scales to the column.
  const gridRef = useRef<HTMLDivElement>(null);
  const [colW, setColW] = useState(MAX_W);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => setColW(Math.max(280, Math.floor(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [animation, setAnimation] = useState<Animation>("entrance");
  const [replayKey, setReplayKey] = useState(0);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const runRef = useRef(0);

  const pieceKey = pieces.map((p) => p.id).join(",");
  useEffect(() => {
    if (!pieces.length) return;
    const run = ++runRef.current;
    let cancelled = false;
    (async () => {
      const token = await tokenOrNull(getToken);
      // A few at a time: each preview inlines its images and fonts.
      const queue = [...pieces];
      const worker = async () => {
        for (;;) {
          const t = queue.shift();
          if (!t || cancelled || run !== runRef.current) return;
          const key = `${t.id}:${animation}`;
          try {
            const res = await fetch(`/api/templates/${t.id}/preview-html`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify(animation === "none" ? { animate: false } : { animation }),
            });
            const body = await res.text();
            if (cancelled) return;
            setLoaded((prev) => ({ ...prev, [key]: res.ok ? { html: body, error: null } : { html: null, error: "Could not build this banner." } }));
          } catch {
            if (!cancelled) setLoaded((prev) => ({ ...prev, [key]: { html: null, error: "Could not build this banner." } }));
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceKey, animation]);

  const ready = pieces.filter((p) => loaded[`${p.id}:${animation}`]).length;

  return (
    <div className="space-y-6" ref={gridRef}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/wip" className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Artwork WIP
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">HTML banner preview</h1>
          <p className="mt-1.5 text-muted-foreground">
            Every size playing together as the real HTML5 banner, exactly as it exports. Nothing is downloaded or registered here.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!explicitIds.length && (
            <Select value={family !== null ? String(family) : undefined} onValueChange={(v) => setFamily(Number(v))}>
              <SelectTrigger className="w-[320px]" data-testid="select-banner-family">
                <SelectValue placeholder="Choose artwork" />
              </SelectTrigger>
              <SelectContent>
                {masters.map(({ master, sizes }) => (
                  <SelectItem key={master.id} value={String(master.id)}>
                    {master.name} · {sizes + 1} size{sizes === 0 ? "" : "s"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={scope} onValueChange={(v) => setScope(v as "html" | "all")}>
            <SelectTrigger className="w-[170px]" data-testid="select-banner-scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="html">HTML banner sizes</SelectItem>
              <SelectItem value="all">All sizes</SelectItem>
            </SelectContent>
          </Select>
          <Select value={animation} onValueChange={(v) => setAnimation(v as Animation)}>
            <SelectTrigger className="w-[150px]" data-testid="select-banner-animation">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANIMATIONS.map((a) => (
                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setReplayKey((k) => k + 1)} disabled={!pieces.length} data-testid="button-replay-all">
            <RotateCcw className="mr-2 h-4 w-4" /> Replay all
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading artwork…</div>
      ) : !pieces.length ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {wip.length
            ? "Choose artwork above to see its sizes as HTML banners."
            : "Nothing in WIP yet. Upload a master and create sizes, then come back to see them play together."}
        </div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground" data-testid="text-banner-count">
            {pieces.length} banner{pieces.length === 1 ? "" : "s"}
            {ready < pieces.length ? ` · building ${ready + 1} of ${pieces.length}…` : ""}
            {explicitIds.length ? " · your selection from WIP" : ""}
          </div>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-8">
            {pieces.map((t) => (
              <BannerTile key={t.id} template={t} loaded={loaded[`${t.id}:${animation}`]} replayKey={replayKey} maxW={Math.min(MAX_W, colW)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
