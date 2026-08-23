import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/react";
import { Code2, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

/**
 * Export a freeform template as a tagged, tracked HTML5 ad package (zip):
 * clickTag + ad.size for ad servers, creative ID + campaign/format/variant
 * tags (UTM on click-through), analytics beacons, dynamic copy via URL
 * params, optional fluid scaling and entrance animation.
 */
export function ExportHtmlDialog({ templateId, templateName }: { templateId: number; templateName: string }) {
  const [open, setOpen] = useState(false);
  const [campaign, setCampaign] = useState("");
  const [variant, setVariant] = useState("");
  const [clickUrl, setClickUrl] = useState("https://www.aucklandcouncil.govt.nz/");
  const [fluid, setFluid] = useState(false);
  const [animate, setAnimate] = useState(true);
  const [animation, setAnimation] = useState<"entrance" | "kenburns" | "frames" | "reveal">("entrance");
  const [durationSec, setDurationSec] = useState(8);
  const [loops, setLoops] = useState(1);
  const [busy, setBusy] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [previewScale, setPreviewScale] = useState(1);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const { getToken } = useAuth();
  const { toast } = useToast();

  const loadPreview = async () => {
    setPreviewBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/templates/${templateId}/preview-html`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ clickUrl, fluid: false, animate, animation: animate ? animation : "none", durationSec, loops }),
      });
      if (!res.ok) throw new Error(await res.text());
      const html = await res.text();
      const m = /name="ad\.size" content="width=(\d+),height=(\d+)"/.exec(html);
      if (m) setDims({ w: Number(m[1]), h: Number(m[2]) });
      setPreviewHtml(html);
      setReplayKey((k) => k + 1);
    } catch (err) {
      toast({ title: "Preview failed", description: err instanceof Error ? err.message.slice(0, 160) : undefined, variant: "destructive" });
    } finally {
      setPreviewBusy(false);
    }
  };

  // Fit the ad inside the preview box (never crop it).
  useEffect(() => {
    const node = previewBoxRef.current;
    if (!node || !dims) return;
    const measure = () => setPreviewScale(Math.min(1, (node.clientWidth - 16) / dims.w, 420 / dims.h));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [dims, previewHtml]);

  const run = async () => {
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/templates/${templateId}/export-html`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ campaign, variant, clickUrl, fluid, animate, animation: animate ? animation : "none", durationSec, loops }),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `${templateName}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "HTML5 package downloaded",
        description: `Creative ${res.headers.get("x-creative-token") ?? ""} is registered — events will show on Performance.`,
      });
      setOpen(false);
    } catch (err) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message.slice(0, 160) : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2" data-testid="button-export-html">
          <Code2 className="w-4 h-4" />
          Export HTML5
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Export “{templateName}” as HTML5</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          A self-contained ad package: clickTag + ad.size for CM360/DV360, National 2 embedded, a unique
          creative ID with campaign/format/variant tags on every click-through, and analytics beacons
          (impression, viewable, interaction, click). Copy can be overridden at serve time with URL
          parameters (?headline=…&amp;body=…&amp;cta=…&amp;image=…).
        </p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Campaign tag</Label>
            <Input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="e.g. food-scraps-fy26" data-testid="input-export-campaign" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Variant tag (optional)</Label>
            <Input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="e.g. toast-v1" data-testid="input-export-variant" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Click-through URL</Label>
            <Input value={clickUrl} onChange={(e) => setClickUrl(e.target.value)} placeholder="https://…" data-testid="input-export-click" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Motion</Label>
            <div className="flex flex-wrap gap-1.5">
              {([
                ["none", "None"],
                ["entrance", "Entrance"],
                ["kenburns", "Ken Burns"],
                ["frames", "Story frames"],
                ["reveal", "Reveal"],
              ] as const).map(([key, label]) => {
                const active = animate ? animation === key : key === "none";
                return (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => {
                      if (key === "none") setAnimate(false);
                      else { setAnimate(true); setAnimation(key); }
                    }}
                    data-testid={`button-anim-${key}`}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground leading-tight">
              Ken Burns drifts the artwork toward the hero area. Story frames run hook → support → end-frame.
              Spec-checked: ends within 15s, max 3 loops, reduced-motion respected.
            </p>
            {animate && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px]">Duration (s, max 15)</Label>
                  <Input type="number" min={2} max={15} value={durationSec} onChange={(e) => setDurationSec(Math.min(15, Math.max(2, Number(e.target.value))))} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Loops (max 3)</Label>
                  <Input type="number" min={1} max={3} value={loops} onChange={(e) => setLoops(Math.min(3, Math.max(1, Number(e.target.value))))} className="h-8 text-xs" />
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={fluid} onChange={(e) => setFluid(e.target.checked)} /> Fluid (scale to container)
            </label>
          </div>
        </div>
        <div ref={previewBoxRef} className="rounded-lg border border-border/60 bg-muted/30 p-2 overflow-hidden" data-testid="html-preview">
          {previewHtml && dims ? (
            <div style={{ width: dims.w * previewScale, height: dims.h * previewScale, margin: "0 auto", position: "relative" }}>
              <iframe
                key={replayKey}
                title="Creative preview"
                srcDoc={previewHtml}
                sandbox="allow-scripts"
                style={{ width: dims.w, height: dims.h, border: 0, transform: `scale(${previewScale})`, transformOrigin: "top left", position: "absolute", left: 0, top: 0, background: "#fff" }}
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-8">
              Click “Preview motion” to play the exact package — same HTML, same animation — before downloading.
            </p>
          )}
        </div>
        <div className="flex justify-between gap-2 pt-2">
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={loadPreview} disabled={previewBusy || busy} data-testid="button-export-preview">
              {previewBusy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {previewHtml ? "Update preview" : "Preview motion"}
            </Button>
            {previewHtml && (
              <Button type="button" variant="ghost" onClick={() => setReplayKey((k) => k + 1)} data-testid="button-export-replay">
                Replay
              </Button>
            )}
          </div>
          <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={run} disabled={busy} data-testid="button-export-html-run">
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Download package
          </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
