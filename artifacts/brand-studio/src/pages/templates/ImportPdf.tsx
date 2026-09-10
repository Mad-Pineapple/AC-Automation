import { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTemplate,
  useAdaptTemplate,
  useDissectPdf,
  useImportBrandPackage,
  useImportExampleArtwork,
  useListBrands,
  getListTemplatesQueryKey,
  getListBrandAssetsQueryKey,
  Brand,
  DissectPdfResult,
  FreeformElement,
} from "@workspace/api-client-react";
import { ADAPT_PRESETS } from "@/lib/adaptPresets";
import { SizePicker } from "@/components/SizePicker";
import { useUpload } from "@workspace/object-storage-web";
import { useToast } from "@/hooks/use-toast";
import { useMe } from "@/hooks/use-me";
import { ChevronLeft, FileUp, Loader2, AlertTriangle, RotateCcw, Undo2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FreeformEditor } from "@/components/FreeformEditor";


export default function ImportPdf() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: meData, isLoading: isLoadingMe } = useMe();
  const isAdmin = meData?.role === "admin";

  const { data: brands } = useListBrands();
  const previewBrand: Brand | undefined = brands?.[0];

  const createTemplate = useCreateTemplate();
  const dissect = useDissectPdf();
  const { uploadFile, isUploading } = useUpload();

  const [mode, setMode] = useState<"elements" | "keyVisual">("elements");
  const [result, setResult] = useState<DissectPdfResult | null>(null);
  // Output sizes generated alongside the master on save (digital set on by
  // default; print off since the master usually IS the print artwork).
  const [outputSizes, setOutputSizes] = useState<Set<string>>(
    new Set(["social_square", "story", "mrec", "banner"]),
  );
  const adaptTemplate = useAdaptTemplate();
  const importPackage = useImportBrandPackage();
  const importExample = useImportExampleArtwork();
  const [editedElements, setEditedElements] = useState<FreeformElement[]>([]);
  const [editorKey, setEditorKey] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Imports default to Work-in-progress; promote from the Templates page
  // once the artwork is finished and a reusable template is wanted.
  // Everything imported lands in Work-in-progress; "Make template" is the
  // only way into Templates.
  const category = "wip";

  useEffect(() => {
    if (!isLoadingMe && !isAdmin) {
      toast({ title: "You don't have permission to import artwork", variant: "destructive" });
      setLocation("/wip");
    }
  }, [isLoadingMe, isAdmin, setLocation, toast]);

  const elements = editedElements;
  const counts = useMemo(() => {
    const c = { text: 0, image: 0, rect: 0 };
    for (const el of elements) {
      if (el.type === "text") c.text++;
      else if (el.type === "image") c.image++;
      else if (el.type === "rect") c.rect++;
    }
    return c;
  }, [elements]);

  if (isLoadingMe || !isAdmin) return null;

  const busy = isUploading || dissect.isPending || importPackage.isPending || importExample.isPending;

  const runDissect = (objectPath: string, friendlyName: string) => {
    dissect.mutate(
      { data: { objectPath, mode } },
      {
        onSuccess: (res) => {
          setResult(res);
          setEditedElements(res.config.elements ?? []);
          setEditorKey((k) => k + 1);
          setName(friendlyName || res.name);
          setDescription("");
        },
        onError: () =>
          toast({
            title: "Could not read that PDF",
            description: "The file may be encrypted or unsupported. Try another.",
            variant: "destructive",
          }),
      },
    );
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const lower = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || lower.endsWith(".pdf");
    const isArtwork = /\.(zip|idml|psd|png|jpe?g|webp|tiff?)$/i.test(lower);
    if (!isPdf && !isArtwork) {
      toast({ title: "Unsupported file", description: "Use PDF, ZIP, IDML, PSD or a flat image (PNG/JPG/WebP/TIFF).", variant: "destructive" });
      return;
    }
    const friendlyName = file.name.replace(/\.[^.]+$/i, "").trim();
    const uploaded = await uploadFile(file);
    if (!uploaded) {
      toast({ title: "Upload failed", description: "Could not upload the file.", variant: "destructive" });
      return;
    }

    if (isArtwork) {
      // Everything except plain PDFs goes through the artwork importer: it
      // reconstructs GWD banner zips, InDesign packages, PSDs and flat art
      // as complete WIP pieces (no library flooding — that's a sign-off
      // choice on promote).
      importExample.mutate(
        { data: { objectPath: uploaded.objectPath, fileName: file.name, brandId: previewBrand?.id } },
        {
          onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
            const n = res.templates?.length ?? 0;
            toast({
              title: n > 0 ? `${n} artwork piece${n === 1 ? "" : "s"} added to WIP` : "Nothing importable found",
              description: (res.warnings ?? []).slice(0, 2).join(" "),
            });
            setLocation("/wip");
          },
          onError: (err: unknown) =>
            toast({
              title: "Could not import that file",
              description: err instanceof Error ? err.message.slice(0, 140) : "Try a different file.",
              variant: "destructive",
            }),
        },
      );
      return;
    }

    dissect.mutate(
      { data: { objectPath: uploaded.objectPath, mode } },
      {
        onSuccess: (res) => {
          setResult(res);
          setEditedElements(res.config.elements ?? []);
          setEditorKey((k) => k + 1);
          setName(friendlyName || res.name);
          setDescription("");
        },
        onError: () =>
          toast({
            title: "Could not read that PDF",
            description: "The file may be encrypted or unsupported. Try another.",
            variant: "destructive",
          }),
      },
    );
  };

  const handleSave = () => {
    if (!result) return;
    if (elements.length === 0) {
      toast({
        title: "No elements detected",
        description: "This PDF didn't yield any editable elements. Try another file.",
        variant: "destructive",
      });
      return;
    }
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const targets = ADAPT_PRESETS.filter((p) => outputSizes.has(p.key)).map((p) => ({
      width: p.width,
      height: p.height,
      name: `${name.trim()} — ${p.label}`,
    }));
    createTemplate.mutate(
      {
        data: {
          name: name.trim(),
          description: description.trim() || null,
          category,
          width: result.width,
          height: result.height,
          config: { kind: "freeform", elements: editedElements },
        },
      },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
          if (targets.length === 0) {
            toast({ title: category === "wip" ? "Artwork imported to Work in progress" : "Template created from PDF" });
            setLocation(category === "wip" ? "/wip" : "/templates");
            return;
          }
          adaptTemplate.mutate(
            { id: created.id, data: { targets } },
            {
              onSuccess: (adapted) => {
                queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
                toast({
                  title: `Master + ${adapted.length} size${adapted.length === 1 ? "" : "s"} created`,
                  description: category === "wip" ? "All in Work in progress — review them, then Make template on the ones you keep." : "Each size is a normal template — fine-tune any of them in the editor.",
                });
                setLocation(category === "wip" ? "/wip" : "/templates");
              },
              onError: () => {
                toast({
                  title: "Master saved, but size adaptation failed",
                  description: "Open the template and use Adapt to other sizes.",
                  variant: "destructive",
                });
                setLocation(category === "wip" ? "/wip" : "/templates");
              },
            },
          );
        },
        onError: () => toast({ title: "Failed to save template", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-8 w-full">
      <div className="flex items-center gap-4">
        <Link href="/wip" className="p-2 hover:bg-muted rounded-full transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Import From PDF</h1>
          <p className="text-muted-foreground mt-1.5">
            Dissect A Design Into An Editable Template
          </p>
        </div>
      </div>

      {!result ? (
        <Card className="border-border/50">
          <CardContent className="py-12 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
              <button
                type="button"
                onClick={() => setMode("elements")}
                className={`rounded-xl border-2 p-4 text-left transition-colors ${
                  mode === "elements" ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/40"
                }`}
                data-testid="mode-elements"
              >
                <p className="font-semibold text-sm">Editable elements</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Extracts text, images and colour blocks as separate editable pieces. Best for
                  text-led layouts you want to rewrite per campaign.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setMode("keyVisual")}
                className={`rounded-xl border-2 p-4 text-left transition-colors ${
                  mode === "keyVisual" ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/40"
                }`}
                data-testid="mode-key-visual"
              >
                <p className="font-semibold text-sm">Recreate artwork</p>
                <p className="text-xs text-muted-foreground mt-1">
                  A pixel-faithful copy of the page — the artwork is never modified. Layered PDFs
                  get their type lifted off as live text; flat PDFs import exactly as designed.
                </p>
              </button>
            </div>
            <label
              className={`flex flex-col items-center justify-center text-center gap-4 rounded-xl border-2 border-dashed border-border/60 p-12 transition-colors ${
                busy ? "opacity-60 pointer-events-none" : "cursor-pointer hover:border-primary/50 hover:bg-muted/30"
              }`}
              data-testid="dropzone-pdf"
            >
              <input
                type="file"
                accept="application/pdf,.pdf,application/zip,.zip,.idml,.psd,image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp,image/tiff,.tif,.tiff"
                className="hidden"
                onChange={handleFile}
                disabled={busy}
              />
              {busy ? (
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <FileUp className="w-7 h-7 text-primary" />
                </div>
              )}
              <div>
                <p className="font-semibold">
                  {isUploading
                    ? "Uploading…"
                    : importPackage.isPending
                      ? "Unpacking your InDesign package…"
                      : dissect.isPending
                        ? "Reading your PDF…"
                        : "Upload a PDF or InDesign package (.zip)"}
                </p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  A zipped InDesign package imports every linked asset into the Library, then opens
                  the document PDF here. A plain PDF imports directly.
                </p>
              </div>
            </label>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {result.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-2">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium text-sm">
                <AlertTriangle className="w-4 h-4" />
                Review before saving
              </div>
              <ul className="text-xs text-amber-800/90 dark:text-amber-300/80 list-disc pl-5 space-y-1">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Template Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tpl-name">Template Name</Label>
                  <Input
                    id="tpl-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Summer Sale Flyer"
                    data-testid="input-import-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Where it goes</Label>
                  <p className="text-sm text-muted-foreground h-10 flex items-center">Work in progress — promote it with Make template when finished.</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-desc">Description (optional)</Label>
                <Textarea
                  id="tpl-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this format used for?"
                  rows={2}
                  data-testid="input-import-description"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="font-mono">
                  {result.width}×{result.height}px
                </Badge>
                <Badge variant="secondary">{counts.text} text</Badge>
                <Badge variant="secondary">{counts.image} image</Badge>
                <Badge variant="secondary">{counts.rect} shape</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Output sizes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Saving creates the master plus an adapted template for every ticked size — artwork
                re-crops, text re-anchors. Untick everything to save just the master.
              </p>
              <SizePicker
                selected={outputSizes}
                onToggle={(key) =>
                  setOutputSizes((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                onSetMany={(keys, on) =>
                  setOutputSizes((prev) => {
                    const next = new Set(prev);
                    for (const k of keys) on ? next.add(k) : next.delete(k);
                    return next;
                  })
                }
                testPrefix="output-size"
                columns="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              />
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Edit Layout</CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditedElements(result.config.elements ?? []);
                  setEditorKey((k) => k + 1);
                }}
                disabled={createTemplate.isPending}
                data-testid="button-import-revert"
              >
                <Undo2 className="w-4 h-4 mr-2" />
                Revert Edits
              </Button>
            </CardHeader>
            <CardContent>
              {previewBrand ? (
                <FreeformEditor
                  key={editorKey}
                  width={result.width}
                  height={result.height}
                  brand={previewBrand}
                  initialElements={result.config.elements ?? []}
                  onChange={setEditedElements}
                />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-12">
                  Create a brand first to edit and preview this layout.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setResult(null)}
              disabled={createTemplate.isPending}
              data-testid="button-import-reset"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Choose Another
            </Button>
            <Button onClick={handleSave} disabled={createTemplate.isPending || elements.length === 0} data-testid="button-import-save">
              {createTemplate.isPending ? "Saving…" : "Save Template"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
