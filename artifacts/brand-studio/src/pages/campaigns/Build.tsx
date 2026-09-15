import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useParseCollateralPlan,
  usePlanCampaignBuild,
  useAdaptTemplate,
  useCreateBrief,
  useListBrands,
  useListTemplates,
  getListTemplatesQueryKey,
  getListBriefsQueryKey,
  type CollateralPlan,
  type CampaignBuildPlan,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { PartRulesEditor } from "@/components/PartRulesEditor";
import { ChevronLeft, FileSpreadsheet, Loader2, Check, Wand2, AlertTriangle, X, FileUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

/** Examples imported so far: one entry per master template (a package with
 * several message variants contributes one entry per variant). */
interface ExampleMaster {
  id: number;
  name: string;
  width: number;
  height: number;
  /** What the file gave us — decides how faithfully other sizes reflow. */
  kind: string;
}

const ADAPT_BATCH = 8;

/** What each source kind can carry through to the produced sizes. */
const KIND_LABEL: Record<string, string> = {
  package: "InDesign package",
  idml: "IDML",
  pdf: "PDF",
  psd: "Photoshop",
  image: "Flat art",
  freeform: "Artwork",
  artwork: "Artwork",
};

/**
 * Campaign builder: examples + brief in, every brief size out.
 *
 * The two things a production job always starts with are the designed
 * examples (InDesign packages or PDFs of the key visuals) and the collateral
 * brief listing the sizes. This screen takes both, matches every size in the
 * brief to the closest-shaped example, and produces the whole set — for
 * every message variant the examples carry.
 */
export default function CampaignBuild() {
  const [examples, setExamples] = useState<ExampleMaster[]>([]);
  const [plan, setPlan] = useState<CollateralPlan | null>(null);
  const [build, setBuild] = useState<CampaignBuildPlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [aiGuard, setAiGuard] = useState(true);
  const [aiGuardProvider, setAiGuardProvider] = useState<"auto" | "openai" | "claude">("auto");
  // Which planned pieces to produce (indexes into build.jobs); null = all.
  const [pickedJobs, setPickedJobs] = useState<Set<number> | null>(null);

  const { data: brands } = useListBrands();
  const { data: allTemplates } = useListTemplates();
  const { uploadFile } = useUpload();
  const parsePlan = useParseCollateralPlan();
  const planBuild = usePlanCampaignBuild();
  const adaptTemplate = useAdaptTemplate();
  const createBrief = useCreateBrief();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const brand = brands?.[0];
  const wipArtwork = (allTemplates ?? []).filter((t) => t.category === "wip");

  // Step 1 selects masters from the central artwork workspace. Artwork is
  // uploaded once in WIP, then reused here without making duplicate imports.
  const toggleExample = (template: (typeof wipArtwork)[number]) => {
    setExamples((prev) => {
      if (prev.some((item) => item.id === template.id)) {
        return prev.filter((item) => item.id !== template.id);
      }
      const config = template.config as { sourceKind?: string; kind?: string } | undefined;
      return [...prev, {
        id: template.id,
        name: template.name,
        width: template.width,
        height: template.height,
        kind: config?.sourceKind ?? config?.kind ?? "artwork",
      }];
    });
    setBuild(null);
  };

  // --- Step 2: the brief --------------------------------------------------
  const addBrief = async (file: File | undefined) => {
    if (!file) return;
    setBusy("Reading the brief…");
    try {
      const uploaded = await uploadFile(file);
      if (!uploaded) throw new Error("upload failed");
      const parsed = await new Promise<CollateralPlan>((resolve, reject) =>
        parsePlan.mutate({ data: { objectPath: uploaded.objectPath } }, { onSuccess: resolve, onError: reject }),
      );
      setPlan(parsed);
      setBuild(null);
    } catch (err) {
      toast({
        title: "Could not read that workbook",
        description: err instanceof Error ? err.message.slice(0, 160) : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  // --- Step 3: match sizes to examples ------------------------------------
  const matchUp = async () => {
    if (!plan || examples.length === 0) return;
    setBusy("Matching sizes to your examples…");
    try {
      const result = await new Promise<CampaignBuildPlan>((resolve, reject) =>
        planBuild.mutate(
          {
            data: {
              masterTemplateIds: examples.map((e) => e.id),
              sizes: plan.uniqueSizes.map((s) => ({ width: s.width, height: s.height, unit: s.unit, names: s.names, channel: s.channels?.[0] ?? null, messageType: s.messageType ?? null })),
              campaignName: plan.campaignName,
            },
          },
          { onSuccess: resolve, onError: reject },
        ),
      );
      setBuild(result);
      setPickedJobs(null);
    } catch {
      toast({ title: "Could not plan the build", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  // --- Step 4: produce everything ----------------------------------------
  const runBuild = async () => {
    if (!build || !plan || !brand) return;
    const jobs = build.jobs.filter((_, i) => !pickedJobs || pickedJobs.has(i));
    if (jobs.length === 0) { toast({ title: "Tick at least one piece to produce" }); return; }
    try {
      setBusy("Creating the brief…");
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
              brandId: brand.id,
            },
          },
          { onSuccess: () => resolve(), onError: reject },
        ),
      );

      // Adapt in batches, grouped by master so each call hits one example.
      const byMaster = new Map<number, typeof jobs>();
      for (const job of jobs) {
        const list = byMaster.get(job.masterId) ?? [];
        list.push(job);
        byMaster.set(job.masterId, list);
      }
      let done = 0;
      let rejected = 0;
      const adaptBatch = aiGuard ? 1 : ADAPT_BATCH;
      for (const [masterId, masterJobs] of byMaster) {
        for (let i = 0; i < masterJobs.length; i += adaptBatch) {
          const slice = masterJobs.slice(i, i + adaptBatch);
          setBusy(`Producing artwork ${done + 1}–${done + slice.length} of ${jobs.length}…`);
          await new Promise<void>((resolve, reject) =>
            adaptTemplate.mutate(
              { id: masterId, data: { targets: slice.map((j) => ({ width: j.width, height: j.height, name: j.name, formatName: j.formatLabel, channel: j.channel ?? undefined })), ...(build.profile ? { profileId: build.profile.id } : {}), aiGuard, aiGuardProvider } },
              {
                onSuccess: (made) => {
                  for (const t of made ?? []) if (((t.config as { rejected?: string[] } | undefined)?.rejected?.length ?? 0) > 0) rejected++;
                  resolve();
                },
                onError: reject,
              },
            ),
          );
          done += slice.length;
        }
      }

      queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListBriefsQueryKey() });
      const variantCount = Math.max(1, build.variants.length);
      toast({
        title: `${done} piece${done === 1 ? "" : "s"} of artwork produced in Work in progress${rejected > 0 ? ` · ${rejected} rejected` : ""}`,
        description:
          (variantCount > 1
            ? `${plan.campaignName}: every size in the brief, across ${variantCount} variants. Review, then Make template on the ones you keep.`
            : `${plan.campaignName}: every size in the brief. Review, then Make template on the ones you keep.`) +
          (rejected > 0 ? ` ${rejected} automated layout${rejected === 1 ? "" : "s"} failed the mandatory-element check and carry a red Rejected badge with the reasons.` : ""),
      });
      setLocation("/wip");
    } catch (err) {
      toast({
        title: "Build stopped partway",
        description: err instanceof Error ? err.message.slice(0, 160) : "Some sizes may already have been produced.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const variantsFound = [...new Set(examples.map((e) => variantOf(e.name)).filter(Boolean))] as string[];
  const canMatch = examples.length > 0 && !!plan;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/briefs" className="p-2 hover:bg-muted rounded-full transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Build A Campaign</h1>
          <p className="text-muted-foreground mt-1.5">
            WIP masters + brief, every required size
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Step 1 — examples */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold grid place-items-center">1</span>
              Choose master artwork
              {examples.length > 0 && <Check className="w-4 h-4 text-emerald-600" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Select the approved landscape and portrait masters already stored in Artwork WIP.
              The same artwork is reused here, so it is never uploaded twice.
            </p>
            {wipArtwork.length > 0 ? (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/40" data-testid="wip-master-picker">
                {wipArtwork.map((artwork) => {
                  const selected = examples.some((item) => item.id === artwork.id);
                  return (
                    <label key={artwork.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleExample(artwork)}
                        disabled={!!busy}
                        data-testid={`select-wip-master-${artwork.id}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium truncate">{artwork.name}</span>
                        <span className="block text-xs text-muted-foreground font-mono">{artwork.width}×{artwork.height}</span>
                      </span>
                      <Badge variant={artwork.sourceTemplateId ? "outline" : "secondary"} className="text-[10px] shrink-0">
                        {artwork.sourceTemplateId ? "Generated" : "Master"}
                      </Badge>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/60 p-5 text-center">
                <p className="text-sm font-medium">No artwork in WIP yet</p>
                <p className="text-xs text-muted-foreground mt-1">Upload your master artwork once, then return here to select it.</p>
              </div>
            )}
            <Link href="/wip/import">
              <Button type="button" variant="outline" className="w-full" data-testid="button-upload-master-in-wip">
                <FileUp className="w-4 h-4 mr-2" />Upload artwork in WIP
              </Button>
            </Link>
            {examples.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {examples.map((ex) => (
                    <Badge key={ex.id} variant="secondary" className="gap-1.5 font-normal">
                      <span className="text-[9px] uppercase tracking-wider opacity-60">
                        {KIND_LABEL[ex.kind] ?? ex.kind}
                      </span>
                      {ex.name}
                      <span className="font-mono opacity-60">{ex.width}×{ex.height}</span>
                      <button
                        type="button"
                        onClick={() => { setExamples((p) => p.filter((e) => e.id !== ex.id)); setBuild(null); }}
                        className="opacity-50 hover:opacity-100"
                        aria-label={`Remove ${ex.name}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {examples.length} example{examples.length === 1 ? "" : "s"}
                  {variantsFound.length > 0 && ` · variants: ${variantsFound.join(", ")}`}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 2 — brief */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold grid place-items-center">2</span>
              The brief
              {plan && <Check className="w-4 h-4 text-emerald-600" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label
              className={`flex flex-col items-center justify-center text-center gap-3 rounded-xl border-2 border-dashed border-border/60 p-8 transition-colors ${
                busy ? "opacity-60 pointer-events-none" : "cursor-pointer hover:border-primary/50 hover:bg-muted/30"
              }`}
              data-testid="dropzone-brief"
            >
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  void addBrief(e.target.files?.[0]);
                  e.target.value = "";
                }}
                disabled={!!busy}
              />
              <FileSpreadsheet className="w-7 h-7 text-primary" />
              <p className="font-semibold text-sm">Upload the collateral brief (.xlsx)</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                The standard production workbook. Every deliverable, size, channel, headline, click
                URL and dispatch date is read straight off it.
              </p>
            </label>
            {plan && (
              <div className="text-xs space-y-1">
                <p className="font-semibold text-sm">{plan.campaignName}</p>
                <p className="text-muted-foreground">
                  {plan.projectNumbers.join(", ")} · {plan.deliverables.reduce((n, d) => n + d.count, 0)} deliverables ·{" "}
                  {plan.uniqueSizes.length} unique sizes
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Step 3 — review */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold grid place-items-center">3</span>
            Review and build
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!build ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-muted-foreground max-w-md">
                {canMatch
                  ? "Every size in the brief is matched to an example of the same shape class where one exists, otherwise rebuilt from the closest example with the format's recipe, for each variant."
                  : "Add at least one example and the brief to continue."}
              </p>
              <Button type="button" onClick={matchUp} disabled={!canMatch || !!busy} data-testid="button-match">
                {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Wand2 className="w-4 h-4 mr-2" />}
                {busy ?? "Match sizes to examples"}
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2" data-testid="ai-artwork-guard">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={aiGuard} onChange={(e) => setAiGuard(e.target.checked)} />
                  <span>
                    <span className="block text-sm font-semibold">AI Artwork Guard</span>
                    <span className="block text-xs text-muted-foreground">Check and safely correct every layout during creation, before it reaches Work in progress.</span>
                  </span>
                </label>
                {aiGuard && (
                  <label className="flex items-center gap-2 text-xs">
                    <span className="font-medium">Reviewer</span>
                    <select className="h-8 rounded-md border border-input bg-background px-2" value={aiGuardProvider} onChange={(e) => setAiGuardProvider(e.target.value as "auto" | "openai" | "claude")}>
                      <option value="auto">Automatic, OpenAI then Claude fallback</option>
                      <option value="openai">OpenAI only</option>
                      <option value="claude">Claude only</option>
                    </select>
                  </label>
                )}
              </div>
              {build.profile ? (
                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs space-y-0.5" data-testid="build-profile">
                  <p><span className="font-semibold">Master-relative geometry:</span> {build.profile.name}, measured from your examples.</p>
                  <p className="text-muted-foreground">
                    Measured shapes: {build.profile.measuredClasses.join(", ") || "none"}
                    {build.profile.interpolatedClasses.length > 0 ? ` · interpolated: ${build.profile.interpolatedClasses.join(", ")}` : ""}
                  </p>
                  {build.profile.notes.slice(1).map((n, i) => <p key={i} className="text-muted-foreground">{n}</p>)}
                </div>
              ) : null}
              {build.profile ? (
                <PartRulesEditor profileId={build.profile.id} />
              ) : (
                <p className="text-xs text-muted-foreground">No layout profile could be measured from these examples; sizes use the family defaults.</p>
              )}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge className="font-normal">{(pickedJobs ? pickedJobs.size : build.jobs.length)} of {build.jobs.length} pieces ticked</Badge>
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setPickedJobs(null)}>All</button>
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setPickedJobs(new Set())}>None</button>
                {build.variants.map((v) => (
                  <Badge key={v} variant="secondary" className="font-normal">{v}</Badge>
                ))}
              </div>
              {build.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-700 bg-amber-50 rounded-lg p-3 flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {w}
                </p>
              ))}
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/40">
                {build.jobs.map((job, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <input
                      type="checkbox"
                      checked={!pickedJobs || pickedJobs.has(i)}
                      onChange={(e) => setPickedJobs((prev) => { const n = new Set(prev ?? build.jobs.map((_, k) => k)); if (e.target.checked) n.add(i); else n.delete(i); return n; })}
                      data-testid={`build-job-${i}`}
                    />
                    <span className="font-mono shrink-0 w-28">{job.width}×{job.height}</span>
                    <span className="shrink-0 w-40 truncate" title={job.formatLabel}>
                      {job.formatLabel}
                      {job.formatClass ? <span className="text-muted-foreground"> · {job.formatClass}</span> : null}
                    </span>
                    <span className="text-muted-foreground truncate flex-1">from {job.masterName}</span>
                    {job.needsReview ? (
                      <Badge variant="outline" className="text-[10px] font-normal shrink-0 border-amber-500 text-amber-700">
                        rebuilt from recipe · sign-off
                      </Badge>
                    ) : job.recomposed ? (
                      <Badge variant="outline" className="text-[10px] font-normal shrink-0">layout rebuilt</Badge>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setBuild(null)} disabled={!!busy}>
                  Back
                </Button>
                <Button type="button" onClick={runBuild} disabled={!!busy || (pickedJobs !== null && pickedJobs.size === 0)} data-testid="button-build">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  {busy ?? `Build ${pickedJobs ? pickedJobs.size : build.jobs.length} piece${(pickedJobs ? pickedJobs.size : build.jobs.length) === 1 ? "" : "s"} of artwork`}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Variant suffix convention from multi-page package import. */
function variantOf(name: string): string | null {
  const idx = name.lastIndexOf(" — ");
  if (idx < 0) return null;
  const tail = name.slice(idx + 3).trim();
  return tail.length > 0 && tail.length <= 40 ? tail : null;
}
