import { useState, useEffect, useCallback, useRef } from "react";
import { X, ArrowLeftRight, Check, Ban, MessageSquare, Send } from "lucide-react";
import { toPng } from "html-to-image";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { TemplateRenderer, getTemplateConfig, getTemplateLabel } from "@/components/TemplateRenderer";
import {
  Brand,
  useApproveAsset,
  useRejectAsset,
  useListComparisonNotes,
  useCreateComparisonNote,
  getListComparisonNotesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { LightboxAsset, captureHtmlBannerAsPng } from "@/components/AssetLightbox";
import { useToast } from "@/hooks/use-toast";
import DOMPurify from "dompurify";

interface AssetCompareProps {
  assets: LightboxAsset[];
  initialIndexA: number;
  initialIndexB: number;
  brand: Brand;
  onClose: () => void;
  onActioned?: (assetId: number, action: "approve" | "reject") => void;
  // When true, the comparison was opened from a shared ?compare=A,B link to
  // discuss that exact pair. An action by anyone must not silently advance the
  // panels off the pinned pair.
  pinned?: boolean;
}

function getAssetDimensions(asset: LightboxAsset) {
  if (asset.templateSize === "html_banner") {
    return { width: 728, height: 90 };
  }
  const cfg = getTemplateConfig(asset.templateSize);
  return { width: cfg.width, height: cfg.height };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Measure the byte size of a rendered PNG data URL via its blob.
async function measurePngBytes(dataUrl: string): Promise<number> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return blob.size;
}

const PLATFORM_FIT: Record<string, string[]> = {
  social_square: ["Instagram", "Facebook", "LinkedIn"],
  story: ["Instagram Stories", "TikTok", "Snapchat"],
  banner: ["Google Display", "Web Leaderboard"],
  html_banner: ["Google Display", "Web Leaderboard"],
  print_a4: ["Print (A4)"],
  animated_social: ["Instagram", "Facebook"],
};

// Known template sizes map directly to platforms; custom templates fall back to
// an aspect-ratio heuristic so they still get a sensible "fits" hint.
function getPlatformFit(asset: LightboxAsset): string[] {
  const known = PLATFORM_FIT[asset.templateSize];
  if (known) return known;
  const { width, height } = getAssetDimensions(asset);
  const ar = width / height;
  if (Math.abs(ar - 1) < 0.1) return ["Instagram", "Facebook", "LinkedIn"];
  if (ar < 0.8) return ["Instagram Stories", "Pinterest"];
  if (ar > 3) return ["Google Display", "Web Leaderboard"];
  if (ar > 1.2) return ["YouTube", "X / Twitter"];
  return ["Facebook", "LinkedIn"];
}

function AssetPanel({
  asset,
  brand,
  label,
  onApprove,
  onReject,
  isPending,
}: {
  asset: LightboxAsset;
  brand: Brand;
  label: string;
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
}) {
  const { width: nativeW, height: nativeH } = getAssetDimensions(asset);
  const isHtml = !!asset.htmlContent || asset.templateSize === "html_banner";
  const platforms = getPlatformFit(asset);

  // Real exported PNG size, measured lazily from the rendered blob so the
  // comparison UI never blocks on it. null = still measuring, -1 = failed.
  const renderRef = useRef<HTMLDivElement>(null);
  const [pngBytes, setPngBytes] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPngBytes(null);
    const measure = async () => {
      try {
        let dataUrl: string;
        if (isHtml) {
          if (!asset.htmlContent) {
            if (!cancelled) setPngBytes(-1);
            return;
          }
          dataUrl = await captureHtmlBannerAsPng(asset.htmlContent, nativeW, nativeH);
        } else {
          const el = renderRef.current?.querySelector(
            "[data-template='canvas']",
          ) as HTMLElement | null;
          if (!el) {
            if (!cancelled) setPngBytes(-1);
            return;
          }
          dataUrl = await toPng(el, { width: nativeW, height: nativeH, pixelRatio: 1 });
        }
        const bytes = await measurePngBytes(dataUrl);
        if (!cancelled) setPngBytes(bytes);
      } catch {
        if (!cancelled) setPngBytes(-1);
      }
    };
    // Defer to the next frame so the canvas/iframe has painted first.
    const raf = requestAnimationFrame(() => {
      void measure();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [asset.id, isHtml, nativeW, nativeH, asset.htmlContent]);

  const sizeLabel =
    pngBytes === null ? "measuring PNG…" : pngBytes < 0 ? "PNG size unavailable" : `${formatBytes(pngBytes)} PNG`;

  const panelMaxW = typeof window !== "undefined" ? window.innerWidth * 0.42 : 560;
  const panelMaxH = typeof window !== "undefined" ? window.innerHeight * 0.55 : 420;
  const scale = Math.min(panelMaxW / nativeW, panelMaxH / nativeH, 1);
  const displayW = Math.round(nativeW * scale);
  const displayH = Math.round(nativeH * scale);

  const sanitized = isHtml && asset.htmlContent
    ? DOMPurify.sanitize(asset.htmlContent, { USE_PROFILES: { html: true } })
    : "";

  return (
    <div className="flex flex-col items-center gap-3 flex-1 min-w-0">
      <div className="text-center">
        <span className="text-xs font-semibold uppercase tracking-widest text-white/40">{label}</span>
        <p className="text-white font-semibold text-sm mt-0.5">
          {getTemplateLabel(asset.templateSize)}
        </p>
        <p
          className="text-white/40 text-xs font-mono"
          data-testid={`compare-dims-${label.toLowerCase()}`}
        >
          {nativeW}×{nativeH}px · {sizeLabel}
        </p>
        <p
          className="text-white/30 text-[11px] mt-0.5 max-w-[220px] mx-auto"
          data-testid={`compare-platforms-${label.toLowerCase()}`}
        >
          Fits {platforms.join(", ")}
        </p>
      </div>

      <div
        ref={renderRef}
        style={{ width: displayW, height: displayH, overflow: "hidden", flexShrink: 0, position: "relative" }}
        className="rounded-lg shadow-2xl ring-1 ring-white/10 bg-white"
        data-testid={`compare-panel-${label.toLowerCase()}`}
      >
        {isHtml ? (
          <iframe
            srcDoc={sanitized}
            sandbox="allow-scripts"
            style={{
              border: "none",
              width: nativeW,
              height: nativeH,
              transformOrigin: "top left",
              transform: `scale(${scale})`,
              pointerEvents: "none",
            }}
            title={`${label} HTML Banner`}
          />
        ) : (
          <TemplateRenderer
            templateSize={asset.templateSize}
            brand={brand}
            headline={asset.headline}
            bodyText={asset.bodyText}
            callToAction={asset.callToAction}
            imageUrl={asset.imageUrl}
            isAnimated={asset.isAnimated ?? asset.templateSize === "animated_social"}
            scale={scale}
          />
        )}
      </div>

      <div className="text-center space-y-0.5 max-w-[240px]">
        {asset.headline && (
          <p className="text-white/80 text-xs truncate">
            <span className="text-white/40 font-medium">H:</span> {asset.headline}
          </p>
        )}
        {asset.bodyText && (
          <p className="text-white/60 text-xs line-clamp-2">
            <span className="text-white/40 font-medium">B:</span> {asset.bodyText}
          </p>
        )}
        {asset.callToAction && (
          <p className="text-white/80 text-xs truncate">
            <span className="text-white/40 font-medium">CTA:</span> {asset.callToAction}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 mt-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={onReject}
          disabled={isPending}
          data-testid={`compare-reject-${label.toLowerCase()}`}
          className="h-8 gap-1.5 bg-white/10 text-white hover:bg-red-500/80 hover:text-white border border-white/10"
        >
          <Ban className="w-3.5 h-3.5" />
          Reject
        </Button>
        <Button
          size="sm"
          onClick={onApprove}
          disabled={isPending}
          data-testid={`compare-approve-${label.toLowerCase()}`}
          className="h-8 gap-1.5 bg-green-600 text-white hover:bg-green-500"
        >
          <Check className="w-3.5 h-3.5" />
          Approve
        </Button>
      </div>
    </div>
  );
}

function formatNoteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ComparisonNotes({ assetIdA, assetIdB }: { assetIdA: number; assetIdB: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const params = { assetA: assetIdA, assetB: assetIdB };
  const queryKey = getListComparisonNotesQueryKey(params);
  const { data: notes, isLoading } = useListComparisonNotes(params, {
    query: { queryKey },
  });
  const createNote = useCreateComparisonNote();

  const handleSubmit = () => {
    const body = draft.trim();
    if (!body) return;
    createNote.mutate(
      { data: { assetA: assetIdA, assetB: assetIdB, body } },
      {
        onSuccess: () => {
          setDraft("");
          queryClient.invalidateQueries({ queryKey });
        },
        onError: () => {
          toast({ title: "Couldn't add note", variant: "destructive" });
        },
      },
    );
  };

  return (
    <div
      className="w-full max-w-lg mx-auto mt-6 flex flex-col gap-2"
      data-testid="compare-notes"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 text-white/50 text-xs font-semibold uppercase tracking-widest">
        <MessageSquare className="w-3.5 h-3.5" />
        Notes
        {notes && notes.length > 0 && (
          <span className="text-white/30 font-normal normal-case tracking-normal">
            ({notes.length})
          </span>
        )}
      </div>

      <div
        className="max-h-40 overflow-y-auto flex flex-col gap-2 pr-1"
        data-testid="compare-notes-list"
      >
        {isLoading ? (
          <p className="text-white/30 text-xs">Loading notes…</p>
        ) : notes && notes.length > 0 ? (
          notes.map(note => (
            <div
              key={note.id}
              className="rounded-lg bg-white/5 border border-white/10 px-3 py-2"
              data-testid={`compare-note-${note.id}`}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-white/70 text-xs font-medium truncate">
                  {note.authorName || "Teammate"}
                </span>
                <span className="text-white/30 text-[11px] font-mono flex-shrink-0">
                  {formatNoteTime(note.createdAt)}
                </span>
              </div>
              <p className="text-white/80 text-xs whitespace-pre-wrap break-words">{note.body}</p>
            </div>
          ))
        ) : (
          <p className="text-white/30 text-xs" data-testid="compare-notes-empty">
            No notes yet. Leave a comment for your teammates.
          </p>
        )}
      </div>

      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Add a note about this comparison…"
          rows={2}
          maxLength={1000}
          data-testid="compare-note-input"
          className="resize-none bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm focus-visible:ring-white/20"
        />
        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={!draft.trim() || createNote.isPending}
          data-testid="compare-note-submit"
          className="h-9 w-9 flex-shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

export default function AssetCompare({
  assets,
  initialIndexA,
  initialIndexB,
  brand,
  onClose,
  onActioned,
  pinned = false,
}: AssetCompareProps) {
  const [indexA, setIndexA] = useState(initialIndexA);
  const [indexB, setIndexB] = useState(initialIndexB);
  const [swapped, setSwapped] = useState(false);
  const [actedIds, setActedIds] = useState<Set<number>>(new Set());
  const [rejectTarget, setRejectTarget] = useState<{ asset: LightboxAsset; panel: "A" | "B" } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const { toast } = useToast();

  const approveAsset = useApproveAsset();
  const rejectAsset = useRejectAsset();
  const isPending = approveAsset.isPending || rejectAsset.isPending;

  const assetA = assets[indexA];
  const assetB = assets[indexB];

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!assetA || !assetB) return null;

  const left = swapped ? assetB : assetA;
  const right = swapped ? assetA : assetB;

  // Advance the panel that just acted to the next asset that isn't already
  // shown in the other panel and hasn't been acted on yet. Falls back to
  // closing the comparison if no candidate remains.
  const advanceAfterAction = (actedAssetId: number, panel: "A" | "B") => {
    const nextActed = new Set(actedIds);
    nextActed.add(actedAssetId);
    setActedIds(nextActed);

    // When pinned to a shared compare pair, never move off the pinned A,B pair.
    // The acted asset's status updates in place, but the panels stay put so a
    // shared reviewer keeps discussing the exact pair the link points to.
    if (pinned) return;

    const otherIndex = panel === "A" ? indexB : indexA;
    const otherAssetId = assets[otherIndex]?.id;

    const nextIndex = assets.findIndex(
      (a, i) => i !== otherIndex && a.id !== otherAssetId && !nextActed.has(a.id),
    );

    if (nextIndex === -1) {
      onClose();
      return;
    }
    if (panel === "A") setIndexA(nextIndex);
    else setIndexB(nextIndex);
  };

  const act = (
    asset: LightboxAsset,
    panel: "A" | "B",
    action: "approve",
  ) => {
    const sizeLabel = getTemplateLabel(asset.templateSize);
    approveAsset.mutate(
      { id: asset.id },
      {
        onSuccess: () => {
          toast({ title: "Asset approved", description: sizeLabel });
          onActioned?.(asset.id, action);
          advanceAfterAction(asset.id, panel);
        },
        onError: () => {
          toast({ title: "Couldn't approve asset", variant: "destructive" });
        },
      },
    );
  };

  const openRejectDialog = (asset: LightboxAsset, panel: "A" | "B") => {
    setRejectReason("");
    setRejectTarget({ asset, panel });
  };

  const confirmReject = () => {
    if (!rejectTarget) return;
    const { asset, panel } = rejectTarget;
    const reason = rejectReason.trim();
    const sizeLabel = getTemplateLabel(asset.templateSize);
    rejectAsset.mutate(
      { id: asset.id, data: { reason: reason || null } },
      {
        onSuccess: () => {
          toast({ title: "Asset rejected", description: sizeLabel });
          onActioned?.(asset.id, "reject");
          setRejectTarget(null);
          setRejectReason("");
          advanceAfterAction(asset.id, panel);
        },
        onError: () => {
          toast({ title: "Couldn't reject asset", variant: "destructive" });
        },
      },
    );
  };

  // `left`/`right` map back to logical panels A/B accounting for swap.
  const leftPanel: "A" | "B" = swapped ? "B" : "A";
  const rightPanel: "A" | "B" = swapped ? "A" : "B";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="compare-overlay"
    >
      <div className="flex items-center justify-between w-full max-w-6xl px-6 pb-4">
        <p className="text-white/60 text-sm font-medium">Side-by-side comparison</p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSwapped(s => !s)}
            data-testid="compare-swap"
            className="h-8 gap-1.5"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Swap
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            data-testid="compare-close"
            className="h-8 w-8 text-white hover:text-white hover:bg-white/20"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-start justify-center gap-6 w-full max-w-6xl px-6">
        <AssetPanel
          asset={left}
          brand={brand}
          label={leftPanel}
          isPending={isPending}
          onApprove={() => act(left, leftPanel, "approve")}
          onReject={() => openRejectDialog(left, leftPanel)}
        />

        <div className="flex flex-col items-center justify-center self-stretch gap-2 flex-shrink-0">
          <div className="w-px bg-white/10 flex-1" />
          <span className="text-white/20 text-xs font-mono">vs</span>
          <div className="w-px bg-white/10 flex-1" />
        </div>

        <AssetPanel
          asset={right}
          brand={brand}
          label={rightPanel}
          isPending={isPending}
          onApprove={() => act(right, rightPanel, "approve")}
          onReject={() => openRejectDialog(right, rightPanel)}
        />
      </div>

      <ComparisonNotes assetIdA={assetA.id} assetIdB={assetB.id} />

      <p className="text-white/25 text-xs mt-6">Press Esc to close</p>

      <Dialog
        open={!!rejectTarget}
        onOpenChange={open => {
          if (!open) {
            setRejectTarget(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent onClick={e => e.stopPropagation()} data-testid="reject-reason-dialog">
          <DialogHeader>
            <DialogTitle>Reject asset</DialogTitle>
            <DialogDescription>
              {rejectTarget ? getTemplateLabel(rejectTarget.asset.templateSize) : ""}
              {" — add an optional note so the brief owner knows what to fix."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason" className="text-sm">
              Reason <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="e.g. Headline is off-brand, image is too dark…"
              rows={3}
              maxLength={1000}
              autoFocus
              data-testid="reject-reason-input"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectTarget(null);
                setRejectReason("");
              }}
              disabled={rejectAsset.isPending}
              data-testid="reject-reason-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmReject}
              disabled={rejectAsset.isPending}
              data-testid="reject-reason-confirm"
            >
              <Ban className="w-3.5 h-3.5 mr-1.5" />
              {rejectAsset.isPending ? "Rejecting…" : "Reject asset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
