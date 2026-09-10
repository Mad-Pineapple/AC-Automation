import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useParseCollateralPlan,
  useCreateBrief,
  useAdaptTemplate,
  useListBrands,
  useListTemplates,
  getListTemplatesQueryKey,
  getListBriefsQueryKey,
  CollateralPlan,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const PRINT_DPI = 300;
const mmToPx = (mm: number) => Math.round((mm / 25.4) * PRINT_DPI);

/**
 * Import a Design Studio collateral workbook (.xlsx): the standard marketer
 * brief. The plan is parsed server-side (deliverables, channels, sizes from
 * the glossary, content directions, dates); creating turns it into a brief
 * (full plan kept in notes for the generators) and — when a master template
 * is chosen — one adapted template per unique size, print sizes at 300dpi.
 */
export function ImportCollateralDialog() {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<CollateralPlan | null>(null);
  const [masterId, setMasterId] = useState<string>("none");
  // Which unique sizes to build (keys `${w}x${h}${unit}`); everything ticked by default.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const sizeKey = (s: { width: number; height: number; unit: string }) => `${s.width}x${s.height}${s.unit}`;
  const [busy, setBusy] = useState<string | null>(null);
  const parsePlan = useParseCollateralPlan();
  const createBrief = useCreateBrief();
  const adaptTemplate = useAdaptTemplate();
  const { data: brands } = useListBrands();
  const { data: templates } = useListTemplates();
  const { uploadFile, isUploading } = useUpload();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const masters = (templates ?? []).filter((t) => (t.config as { kind?: string })?.kind === "freeform");

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("Reading workbook…");
    const uploaded = await uploadFile(file);
    if (!uploaded) {
      setBusy(null);
      toast({ title: "Upload failed", variant: "destructive" });
      return;
    }
    parsePlan.mutate(
      { data: { objectPath: uploaded.objectPath } },
      {
        onSuccess: (p) => { setPlan(p); setPicked(new Set(p.uniqueSizes.map(sizeKey))); setBusy(null); },
        onError: (err) => {
          setBusy(null);
          toast({ title: "Could not read that workbook", description: err instanceof Error ? err.message.slice(0, 160) : undefined, variant: "destructive" });
        },
      },
    );
  };

  const channels = plan
    ? [...new Set(plan.deliverables.map((d) => d.channel))].map((c) => ({
        channel: c,
        count: plan.deliverables.filter((d) => d.channel === c).reduce((n, d) => n + d.count, 0),
      }))
    : [];

  const create = async () => {
    if (!plan || !brands?.[0]) return;
    setBusy("Creating brief…");
    try {
      const firstContent = plan.deliverables.find((d) => d.content?.headline || d.content?.cta)?.content;
      await new Promise<void>((resolve, reject) =>
        createBrief.mutate(
          {
            data: {
              campaignName: plan.campaignName,
              headline: firstContent?.headline ?? null,
              callToAction: firstContent?.cta ?? null,
              notes: `Imported Design Studio collateral brief (${plan.projectNumbers.join(", ")}).\n\n${JSON.stringify(plan, null, 1).slice(0, 8000)}`,
              templateSizes: [],
              useAiCopy: false,
              brandId: brands[0].id,
            },
          },
          { onSuccess: () => resolve(), onError: (e) => reject(e) },
        ),
      );

      let created = 0;
      if (masterId !== "none") {
        const targets = plan.uniqueSizes.filter((s) => picked.has(sizeKey(s))).map((s) => ({
          width: s.unit === "mm" ? mmToPx(s.width) : s.width,
          height: s.unit === "mm" ? mmToPx(s.height) : s.height,
          name: `${plan.projectNumbers[0] ?? plan.campaignName} — ${s.names[0]} ${s.width}x${s.height}${s.unit === "mm" ? "mm" : ""}`,
        }));
        for (let i = 0; i < targets.length; i += 8) {
          setBusy(`Creating size templates ${Math.min(i + 8, targets.length)}/${targets.length}…`);
          await new Promise<void>((resolve, reject) =>
            adaptTemplate.mutate(
              { id: Number(masterId), data: { targets: targets.slice(i, i + 8) } },
              { onSuccess: (r) => { created += r.length; resolve(); }, onError: (e) => reject(e) },
            ),
          );
        }
      }
      queryClient.invalidateQueries({ queryKey: getListBriefsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
      toast({
        title: `Brief created${created ? ` + ${created} size templates` : ""}`,
        description: `${plan.campaignName}: ${plan.deliverables.reduce((n, d) => n + d.count, 0)} deliverables interpreted across ${channels.length} channels.`,
      });
      setOpen(false);
      setPlan(null);
      setLocation(created ? "/templates" : "/briefs");
    } catch (err) {
      toast({ title: "Import failed partway", description: err instanceof Error ? err.message.slice(0, 160) : undefined, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setPlan(null); setBusy(null); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2" data-testid="button-import-collateral">
          <FileSpreadsheet className="w-4 h-4" />
          Import collateral brief
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import a collateral brief (.xlsx)</DialogTitle>
        </DialogHeader>
        {!plan ? (
          <label className="border-2 border-dashed border-border rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/50 transition-colors">
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={handleFile} disabled={!!busy || isUploading} />
            {busy || isUploading ? <Loader2 className="w-8 h-8 text-primary animate-spin" /> : <FileSpreadsheet className="w-8 h-8 text-primary" />}
            <p className="font-semibold text-sm">{busy ?? "Upload the Design Studio collateral workbook"}</p>
            <p className="text-xs text-muted-foreground max-w-sm text-center">
              The standard marketer template (Project Number / Deliverables / Sizes / Content). Sizes resolve
              against the built-in glossary; every deliverable, CTA, click URL and dispatch date is read.
            </p>
          </label>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="font-semibold">{plan.campaignName}</p>
              <p className="text-xs text-muted-foreground">
                {plan.projectNumbers.join(", ")} · {plan.deliverables.reduce((n, d) => n + d.count, 0)} deliverables ·{" "}
                {plan.uniqueSizes.length} unique sizes
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {channels.map((c) => (
                <Badge key={c.channel} variant="secondary">{c.channel} · {c.count}</Badge>
              ))}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{picked.size} of {plan.uniqueSizes.length} sizes ticked</span>
              <span className="flex gap-3">
                <button type="button" className="text-primary hover:underline" onClick={() => setPicked(new Set(plan.uniqueSizes.map(sizeKey)))}>All</button>
                <button type="button" className="text-primary hover:underline" onClick={() => setPicked(new Set())}>None</button>
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border/60 p-3 text-xs space-y-1">
              {plan.uniqueSizes.map((s) => {
                const k = sizeKey(s);
                return (
                  <label key={k} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={picked.has(k)} onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(k); else n.delete(k); return n; })} data-testid={`collateral-size-${k}`} />
                    <span className="font-mono w-28 shrink-0">{s.width}×{s.height}{s.unit === "mm" ? "mm" : ""}</span>
                    <span className="text-muted-foreground truncate">{s.names.join(", ")}{s.count > 1 ? ` ×${s.count}` : ""}</span>
                  </label>
                );
              })}
            </div>
            {plan.warnings.length > 0 && (
              <div className="text-xs text-amber-700 bg-amber-50 rounded-lg p-3 space-y-1">
                {plan.warnings.map((w, i) => (<p key={i}>{w}</p>))}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Create size templates from a master (optional)</Label>
              <Select value={masterId} onValueChange={setMasterId}>
                <SelectTrigger data-testid="select-collateral-master"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Brief only — no templates yet</SelectItem>
                  {masters.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name} ({t.width}×{t.height})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Each ticked size becomes a piece in Work in progress, built from the master (print sizes at 300dpi). Press Make template on the ones you keep, then tick those templates on the campaign to generate copy for them.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setPlan(null)} disabled={!!busy}>Back</Button>
              <Button type="button" onClick={create} disabled={!!busy || (masterId !== "none" && picked.size === 0)} data-testid="button-collateral-create">
                {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {busy ?? (masterId === "none" ? "Create brief" : `Create brief + ${picked.size} piece${picked.size === 1 ? "" : "s"}`)}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
