import { useRef, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, Download, Loader2, FileCode, Tag, Copy, Check } from "lucide-react";
import { useState } from "react";
import { toPng } from "html-to-image";
import DOMPurify from "dompurify";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TemplateRenderer, getTemplateConfig, getTemplateLabel } from "@/components/TemplateRenderer";
import {
  Brand,
  useGetAdTag,
  useCreateAdTag,
  getGetAdTagQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export interface LightboxAsset {
  id: number;
  templateSize: string;
  headline?: string | null;
  bodyText?: string | null;
  callToAction?: string | null;
  imageUrl?: string | null;
  isAnimated?: boolean | null;
  htmlContent?: string | null;
}

interface AssetLightboxProps {
  assets: LightboxAsset[];
  initialIndex: number;
  brand: Brand;
  onClose: () => void;
  onViewed?: (assetId: number) => void;
}

const HTML_BANNER_WIDTH = 728;
const HTML_BANNER_HEIGHT = 90;

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

export async function captureHtmlBannerAsPng(html: string, width: number, height: number): Promise<string> {
  const sanitized = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-9999px;top:-9999px;width:${width}px;height:${height}px;overflow:hidden;pointer-events:none;`;
  container.innerHTML = sanitized;
  document.body.appendChild(container);
  try {
    return await toPng(container, { width, height, pixelRatio: 1 });
  } finally {
    document.body.removeChild(container);
  }
}

export default function AssetLightbox({ assets, initialIndex, brand, onClose, onViewed }: AssetLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [downloading, setDownloading] = useState(false);
  // Real exported PNG size, measured lazily from the rendered blob so the
  // lightbox never blocks on it. null = still measuring, -1 = failed.
  const [pngBytes, setPngBytes] = useState<number | null>(null);
  const [adTagOpen, setAdTagOpen] = useState(false);
  const [clickUrl, setClickUrl] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const asset = assets[index];
  const isHtml = !!asset.htmlContent || asset.templateSize === "html_banner";

  const { data: adTag, isLoading: adTagLoading } = useGetAdTag(asset.id, {
    query: { enabled: adTagOpen, queryKey: getGetAdTagQueryKey(asset.id), retry: false },
  });
  const createAdTag = useCreateAdTag();

  useEffect(() => {
    if (adTag?.clickUrl) setClickUrl(adTag.clickUrl);
  }, [adTag?.clickUrl]);

  useEffect(() => {
    onViewed?.(asset.id);
  }, [asset.id]);

  const handleGenerateTag = () => {
    createAdTag.mutate(
      { id: asset.id, data: { clickUrl: clickUrl.trim() || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAdTagQueryKey(asset.id) });
          toast({ title: "Ad tag ready", description: "Copy the snippet to embed this ad." });
        },
        onError: () => toast({ title: "Could not generate ad tag", variant: "destructive" }),
      }
    );
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1800);
    });
  };

  const nativeW = asset.templateSize === "html_banner"
    ? HTML_BANNER_WIDTH
    : getTemplateConfig(asset.templateSize).width;
  const nativeH = asset.templateSize === "html_banner"
    ? HTML_BANNER_HEIGHT
    : getTemplateConfig(asset.templateSize).height;

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
          const el = canvasRef.current?.querySelector(
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
    pngBytes === null
      ? "measuring PNG…"
      : pngBytes < 0
        ? "PNG size unavailable"
        : `${formatBytes(pngBytes)} PNG`;

  const hasPrev = index > 0;
  const hasNext = index < assets.length - 1;

  const handlePrev = () => hasPrev && setIndex(i => i - 1);
  const handleNext = () => hasNext && setIndex(i => i + 1);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowLeft") setIndex(i => Math.max(0, i - 1));
    if (e.key === "ArrowRight") setIndex(i => Math.min(assets.length - 1, i + 1));
  }, [assets.length, onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      let dataUrl: string;
      if (isHtml) {
        dataUrl = await captureHtmlBannerAsPng(asset.htmlContent ?? "", nativeW, nativeH);
      } else {
        const el = canvasRef.current?.querySelector("[data-template='canvas']") as HTMLElement | null;
        if (!el) return;
        dataUrl = await toPng(el, { width: nativeW, height: nativeH, pixelRatio: 1 });
      }
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${asset.templateSize}-${asset.id}.png`;
      a.click();
    } finally {
      setDownloading(false);
    }
  };

  const handleExportHtml = () => {
    const html = asset.htmlContent ?? "";
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${asset.templateSize}-${asset.id}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const viewportW = typeof window !== "undefined" ? window.innerWidth * 0.9 : 900;
  const viewportH = typeof window !== "undefined" ? window.innerHeight * 0.82 : 700;
  const scale = Math.min(viewportW / nativeW, viewportH / nativeH, 1);
  const displayW = Math.round(nativeW * scale);
  const displayH = Math.round(nativeH * scale);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="lightbox-overlay"
    >
      <div className="flex items-center justify-between w-full max-w-5xl px-4 pb-3">
        <div className="flex items-center gap-3">
          <span className="text-white font-semibold text-sm">
            {getTemplateLabel(asset.templateSize)}
          </span>
          <span className="text-white/50 text-xs font-mono" data-testid="lightbox-dims">{nativeW}×{nativeH}px · {sizeLabel}</span>
          <span className="text-white/40 text-xs">{index + 1} / {assets.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleDownload}
            disabled={downloading}
            data-testid="lightbox-download"
            className="h-8 gap-1.5"
          >
            {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Download PNG
          </Button>
          {isHtml && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleExportHtml}
              data-testid="lightbox-export-html"
              className="h-8 gap-1.5"
            >
              <FileCode className="w-3.5 h-3.5" />
              Export HTML
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setAdTagOpen(true)}
            data-testid="lightbox-get-ad-tag"
            className="h-8 gap-1.5"
          >
            <Tag className="w-3.5 h-3.5" />
            Get Ad Tag
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            data-testid="lightbox-close"
            className="h-8 w-8 text-white hover:text-white hover:bg-white/20"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 w-full justify-center">
        <Button
          size="icon"
          variant="ghost"
          onClick={handlePrev}
          disabled={!hasPrev}
          data-testid="lightbox-prev"
          className="h-10 w-10 text-white hover:text-white hover:bg-white/20 flex-shrink-0 disabled:opacity-20"
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>

        {isHtml ? (
          <div
            style={{ width: displayW, height: displayH, overflow: "hidden", flexShrink: 0, position: "relative" }}
            className="rounded shadow-2xl ring-1 ring-white/10 bg-white"
            data-testid="lightbox-canvas"
          >
            <iframe
              srcDoc={asset.htmlContent ?? ""}
              sandbox="allow-scripts"
              style={{
                border: "none",
                width: nativeW,
                height: nativeH,
                transformOrigin: "top left",
                transform: `scale(${scale})`,
                pointerEvents: "none",
              }}
              title="HTML Banner Preview"
              data-testid="lightbox-html-banner"
            />
          </div>
        ) : (
          <div
            ref={canvasRef}
            style={{ width: displayW, height: displayH, overflow: "hidden", flexShrink: 0, position: "relative" }}
            className="rounded shadow-2xl ring-1 ring-white/10"
            data-testid="lightbox-canvas"
          >
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
          </div>
        )}

        <Button
          size="icon"
          variant="ghost"
          onClick={handleNext}
          disabled={!hasNext}
          data-testid="lightbox-next"
          className="h-10 w-10 text-white hover:text-white hover:bg-white/20 flex-shrink-0 disabled:opacity-20"
        >
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      <p className="text-white/30 text-xs mt-4">Press ← → to navigate · Esc to close</p>

      <Dialog open={adTagOpen} onOpenChange={setAdTagOpen}>
        <DialogContent className="max-w-lg" onClick={e => e.stopPropagation()} data-testid="dialog-ad-tag">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-4 h-4" /> Ad Tag
            </DialogTitle>
            <DialogDescription>
              Generate an embeddable snippet that serves this creative and tracks impressions and clicks.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ad-click-url" className="text-xs">Click-through URL (optional)</Label>
              <Input
                id="ad-click-url"
                type="url"
                placeholder="https://example.com/landing"
                value={clickUrl}
                onChange={e => setClickUrl(e.target.value)}
                data-testid="input-click-url"
              />
              <p className="text-[11px] text-muted-foreground">Where users land when they click the ad. Leave blank for an impression-only tag.</p>
            </div>

            <Button
              onClick={handleGenerateTag}
              disabled={createAdTag.isPending}
              className="w-full"
              data-testid="button-generate-ad-tag"
            >
              {createAdTag.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>
                : adTag ? "Update Ad Tag" : "Generate Ad Tag"}
            </Button>

            {adTagLoading && (
              <div className="flex items-center justify-center py-4 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading...
              </div>
            )}

            {adTag && (
              <div className="space-y-3 pt-1 max-h-[50vh] overflow-y-auto pr-1">
                <Label className="text-xs">Tag executions — every standard online trafficking format</Label>
                {(adTag.executions ?? []).map((ex) => (
                  <div key={ex.key} className="space-y-1.5 rounded-lg border border-border/60 p-3" data-testid={`execution-${ex.key}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs font-semibold">{ex.label}</span>
                        {ex.adServer && (
                          <span className="ml-2 text-[10px] font-mono uppercase tracking-wide rounded-full bg-primary/10 text-primary px-2 py-0.5">
                            {ex.adServer}
                          </span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1.5 text-xs shrink-0"
                        onClick={() => handleCopy(ex.snippet, ex.key)}
                        data-testid={`button-copy-${ex.key}`}
                      >
                        {copied === ex.key ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied === ex.key ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <pre className="text-[10px] bg-muted rounded-md p-2.5 overflow-x-auto whitespace-pre-wrap break-all font-mono max-h-28 overflow-y-auto">
                      {ex.snippet}
                    </pre>
                    {ex.notes && <p className="text-[11px] text-muted-foreground">{ex.notes}</p>}
                  </div>
                ))}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Serve URL</Label>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => handleCopy(adTag.serveUrl, "serveUrl")}
                      data-testid="button-copy-serve-url"
                    >
                      {copied === "serveUrl" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied === "serveUrl" ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <Input readOnly value={adTag.serveUrl} className="text-xs font-mono" data-testid="text-serve-url" />
                </div>

                <div className="flex gap-4 text-xs text-muted-foreground pt-1">
                  <span>Impressions: <span className="font-semibold text-foreground tabular-nums">{(adTag.impressions ?? 0).toLocaleString()}</span></span>
                  <span>Clicks: <span className="font-semibold text-foreground tabular-nums">{(adTag.clicks ?? 0).toLocaleString()}</span></span>
                </div>
                <p className="text-[11px] text-muted-foreground border-t border-border/50 pt-2">
                  Note: external tracking only works once this app is published. The snippet points to your deployed serve URL.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
