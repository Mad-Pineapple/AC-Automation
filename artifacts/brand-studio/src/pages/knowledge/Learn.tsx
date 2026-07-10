import { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTemplate,
  useDissectImage,
  useDissectPdf,
  useListBrands,
  getListTemplatesQueryKey,
  Brand,
  DissectPdfResult,
  FreeformElement,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { useToast } from "@/hooks/use-toast";
import { useMe } from "@/hooks/use-me";
import {
  ChevronLeft,
  ImagePlus,
  Loader2,
  AlertTriangle,
  Undo2,
  Check,
  X,
  Plus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FreeformEditor } from "@/components/FreeformEditor";

type LearnStatus = "uploading" | "learning" | "ready" | "error" | "saved";

type LearnItem = {
  id: string;
  fileName: string;
  status: LearnStatus;
  error?: string;
  sourceImageUrl: string | null;
  result: DissectPdfResult | null;
  name: string;
  description: string;
  editedElements: FreeformElement[];
  editorKey: number;
};

export default function LearnArtwork() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: meData, isLoading: isLoadingMe } = useMe();
  const isAdmin = meData?.role === "admin";

  const { data: brands } = useListBrands();
  const previewBrand: Brand | undefined = brands?.[0];

  const createTemplate = useCreateTemplate();
  const dissectImage = useDissectImage();
  const dissectPdf = useDissectPdf();
  const { uploadFile } = useUpload();

  const [items, setItems] = useState<LearnItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [savingAll, setSavingAll] = useState(false);

  useEffect(() => {
    if (!isLoadingMe && !isAdmin) {
      toast({ title: "You don't have permission to teach new artwork", variant: "destructive" });
      setLocation("/knowledge");
    }
  }, [isLoadingMe, isAdmin, setLocation, toast]);

  const activeItem = items.find((it) => it.id === activeId) ?? null;
  const readyCount = items.filter((it) => it.status === "ready").length;
  const savedCount = items.filter((it) => it.status === "saved").length;

  const counts = useMemo(() => {
    const c = { text: 0, image: 0, rect: 0 };
    for (const el of activeItem?.editedElements ?? []) {
      if (el.type === "text") c.text++;
      else if (el.type === "image") c.image++;
      else if (el.type === "rect") c.rect++;
    }
    return c;
  }, [activeItem]);

  if (isLoadingMe || !isAdmin) return null;

  const updateItem = (id: string, patch: Partial<LearnItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const isPdfFile = (f: File) =>
    f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");

  const processFiles = async (files: File[]) => {
    const accepted = files.filter((f) => f.type.startsWith("image/") || isPdfFile(f));
    if (accepted.length === 0) {
      toast({ title: "Please choose image or PDF files", variant: "destructive" });
      return;
    }
    if (accepted.length < files.length) {
      toast({ title: `Skipped ${files.length - accepted.length} unsupported file(s)` });
    }

    const queued: LearnItem[] = accepted.map((f) => ({
      id: crypto.randomUUID(),
      fileName: f.name,
      status: "uploading",
      sourceImageUrl: null,
      result: null,
      name: "",
      description: "",
      editedElements: [],
      editorKey: 0,
    }));
    setItems((prev) => [...prev, ...queued]);

    setProcessing(true);
    for (let i = 0; i < accepted.length; i++) {
      const file = accepted[i];
      const item = queued[i];
      const pdf = isPdfFile(file);
      const friendlyName = file.name.replace(/\.[^.]+$/, "").trim();

      const uploaded = await uploadFile(file);
      if (!uploaded) {
        updateItem(item.id, { status: "error", error: "Upload failed" });
        continue;
      }
      // PDFs have no directly displayable source image; images keep a preview URL.
      const storedUrl = pdf ? null : `/api/storage${uploaded.objectPath}`;
      updateItem(item.id, { status: "learning", sourceImageUrl: storedUrl });

      try {
        const res = pdf
          ? await dissectPdf.mutateAsync({ data: { objectPath: uploaded.objectPath } })
          : await dissectImage.mutateAsync({ data: { objectPath: uploaded.objectPath } });
        updateItem(item.id, {
          status: "ready",
          result: res,
          editedElements: res.config.elements ?? [],
          name: friendlyName || res.name,
        });
        setActiveId((cur) => cur ?? item.id);
      } catch {
        updateItem(item.id, {
          status: "error",
          error: pdf ? "Couldn't read that PDF" : "Couldn't read that image",
        });
      }
    }
    setProcessing(false);
  };

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    await processFiles(files);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    if (activeId === id) {
      const next = items.find((it) => it.id !== id && it.status === "ready");
      setActiveId(next ? next.id : null);
    }
  };

  const saveItem = async (item: LearnItem) => {
    if (!item.result) return;
    await createTemplate.mutateAsync({
      data: {
        name: item.name.trim(),
        description: item.description.trim() || null,
        category: "knowledge",
        width: item.result.width,
        height: item.result.height,
        sourceImageUrl: item.sourceImageUrl,
        config: { kind: "freeform", elements: item.editedElements },
      },
    });
  };

  const handleSaveActive = async () => {
    const item = activeItem;
    if (!item || !item.result) return;
    if (item.editedElements.length === 0) {
      toast({
        title: "No elements detected",
        description: "This file didn't yield any editable elements. Skip it and try another.",
        variant: "destructive",
      });
      return;
    }
    if (!item.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    try {
      await saveItem(item);
      updateItem(item.id, { status: "saved" });
      queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
      const remaining = items.filter((it) => it.id !== item.id && it.status === "ready");
      if (remaining.length > 0) {
        setActiveId(remaining[0].id);
        toast({ title: "Creative learned", description: `${remaining.length} left to review.` });
      } else {
        toast({ title: "Creative learned" });
        setLocation("/knowledge");
      }
    } catch {
      toast({ title: "Failed to save creative", variant: "destructive" });
    }
  };

  const handleSaveAll = async () => {
    const ready = items.filter((it) => it.status === "ready");
    if (ready.length === 0) return;
    const unnamed = ready.find((it) => !it.name.trim());
    if (unnamed) {
      setActiveId(unnamed.id);
      toast({ title: "Name every creative first", description: `"${unnamed.fileName}" needs a name.`, variant: "destructive" });
      return;
    }
    setSavingAll(true);
    let ok = 0;
    let failed = 0;
    for (const it of ready) {
      try {
        await saveItem(it);
        updateItem(it.id, { status: "saved" });
        ok++;
      } catch {
        updateItem(it.id, { status: "error", error: "Save failed" });
        failed++;
      }
    }
    queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
    setSavingAll(false);
    if (failed > 0) {
      // Keep the page open so failed items stay visible and retryable.
      toast({
        title: `Saved ${ok}, ${failed} failed`,
        description: "The failed creatives are still listed — try saving them again.",
        variant: "destructive",
      });
    } else if (ok > 0) {
      toast({ title: `Saved ${ok} creative${ok === 1 ? "" : "s"}` });
      setLocation("/knowledge");
    } else {
      toast({ title: "Nothing saved", variant: "destructive" });
    }
  };

  const busy = processing || savingAll || createTemplate.isPending;

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/knowledge" className="p-2 hover:bg-muted rounded-full transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Learn New Artwork</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1 uppercase tracking-widest">
            Teach The Studio One Or More Finished Creatives
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="py-12">
            <label
              className={`flex flex-col items-center justify-center text-center gap-4 rounded-xl border-2 border-dashed border-border/60 p-12 transition-colors ${
                busy ? "opacity-60 pointer-events-none" : "cursor-pointer hover:border-primary/50 hover:bg-muted/30"
              }`}
              data-testid="dropzone-artwork"
            >
              <input
                type="file"
                accept="image/*,application/pdf,.pdf"
                multiple
                className="hidden"
                onChange={handleFiles}
                disabled={busy}
              />
              {busy ? (
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <ImagePlus className="w-7 h-7 text-primary" />
                </div>
              )}
              <div>
                <p className="font-semibold">{busy ? "Learning your artwork…" : "Upload finished creatives"}</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Choose one or several images or PDFs at once. We'll study each layout — headline, body, call to
                  action, and imagery placement — into reusable templates you can apply to future briefs.
                </p>
              </div>
            </label>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Queue toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" data-testid="text-queue-status">
              {processing ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Learning artwork…
                </span>
              ) : (
                <>
                  {readyCount} ready to review · {savedCount} saved
                </>
              )}
            </p>
            <div className="flex gap-2">
              <label
                className={`${buttonVariants({ variant: "outline", size: "sm" })} ${
                  busy ? "opacity-50 pointer-events-none" : "cursor-pointer"
                }`}
                data-testid="button-add-more"
              >
                <input
                  type="file"
                  accept="image/*,application/pdf,.pdf"
                  multiple
                  className="hidden"
                  onChange={handleFiles}
                  disabled={busy}
                />
                <Plus className="w-4 h-4 mr-2" />
                Add more
              </label>
              <Button
                type="button"
                size="sm"
                onClick={handleSaveAll}
                disabled={busy || readyCount === 0}
                data-testid="button-save-all"
              >
                {savingAll ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save all ({readyCount})
              </Button>
            </div>
          </div>

          {/* Queue strip */}
          <div className="flex flex-wrap gap-3">
            {items.map((it) => {
              const selectable = it.status === "ready";
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => selectable && setActiveId(it.id)}
                  disabled={!selectable}
                  className={`group relative w-28 rounded-lg border overflow-hidden text-left transition-colors ${
                    it.id === activeId ? "border-primary ring-2 ring-primary/30" : "border-border/60"
                  } ${selectable ? "cursor-pointer hover:border-primary/50" : "cursor-default"}`}
                  data-testid={`queue-item-${it.id}`}
                >
                  <div className="aspect-square bg-muted/40 flex items-center justify-center">
                    {it.sourceImageUrl ? (
                      <img src={it.sourceImageUrl} alt={it.fileName} className="w-full h-full object-cover" />
                    ) : (
                      <ImagePlus className="w-6 h-6 text-muted-foreground/50" />
                    )}
                    {(it.status === "uploading" || it.status === "learning") && (
                      <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      </div>
                    )}
                    {it.status === "saved" && (
                      <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                        <Check className="w-6 h-6 text-primary" />
                      </div>
                    )}
                    {it.status === "error" && (
                      <div className="absolute inset-0 bg-destructive/10 flex items-center justify-center">
                        <AlertTriangle className="w-6 h-6 text-destructive" />
                      </div>
                    )}
                  </div>
                  <div className="px-2 py-1.5">
                    <p className="text-xs font-medium truncate">{it.name || it.fileName}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{it.status}</p>
                  </div>
                  {it.status !== "saved" && (
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeItem(it.id);
                      }}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-background/80 hover:bg-destructive hover:text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      data-testid={`queue-remove-${it.id}`}
                    >
                      <X className="w-3 h-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Active item review */}
          {activeItem && activeItem.result ? (
            <div className="space-y-6">
              {activeItem.result.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    Review before saving
                  </div>
                  <ul className="text-xs text-amber-800/90 dark:text-amber-300/80 list-disc pl-5 space-y-1">
                    {activeItem.result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-start">
                {activeItem.sourceImageUrl && (
                  <Card className="border-border/50 overflow-hidden">
                    <CardHeader>
                      <CardTitle className="text-base">Original</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-lg overflow-hidden bg-muted/30 flex items-center justify-center">
                        <img
                          src={activeItem.sourceImageUrl}
                          alt="Uploaded artwork"
                          className="max-h-72 w-full object-contain"
                          data-testid="img-source-artwork"
                        />
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card className="border-border/50">
                  <CardHeader>
                    <CardTitle className="text-base">Creative Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="kn-name">Creative Name</Label>
                      <Input
                        id="kn-name"
                        value={activeItem.name}
                        onChange={(e) => updateItem(activeItem.id, { name: e.target.value })}
                        placeholder="e.g. Food Scraps"
                        disabled={busy}
                        data-testid="input-learn-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="kn-desc">Description (optional)</Label>
                      <Textarea
                        id="kn-desc"
                        value={activeItem.description}
                        onChange={(e) => updateItem(activeItem.id, { description: e.target.value })}
                        placeholder="When should this layout be reused?"
                        rows={2}
                        disabled={busy}
                        data-testid="input-learn-description"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className="font-mono">
                        {activeItem.result.width}×{activeItem.result.height}px
                      </Badge>
                      <Badge variant="secondary">{counts.text} text</Badge>
                      <Badge variant="secondary">{counts.image} image</Badge>
                      <Badge variant="secondary">{counts.rect} shape</Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="border-border/50">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Review Layout</CardTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      updateItem(activeItem.id, {
                        editedElements: activeItem.result?.config.elements ?? [],
                        editorKey: activeItem.editorKey + 1,
                      })
                    }
                    disabled={busy || createTemplate.isPending}
                    data-testid="button-learn-revert"
                  >
                    <Undo2 className="w-4 h-4 mr-2" />
                    Revert Edits
                  </Button>
                </CardHeader>
                <CardContent>
                  {previewBrand ? (
                    <FreeformEditor
                      key={`${activeItem.id}:${activeItem.editorKey}`}
                      width={activeItem.result.width}
                      height={activeItem.result.height}
                      brand={previewBrand}
                      initialElements={activeItem.editedElements}
                      onChange={(els) => updateItem(activeItem.id, { editedElements: els })}
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
                  onClick={() => removeItem(activeItem.id)}
                  disabled={busy || createTemplate.isPending}
                  data-testid="button-learn-skip"
                >
                  <X className="w-4 h-4 mr-2" />
                  Skip
                </Button>
                <Button
                  onClick={handleSaveActive}
                  disabled={busy || createTemplate.isPending || activeItem.editedElements.length === 0}
                  data-testid="button-learn-save"
                >
                  {createTemplate.isPending && !savingAll ? "Saving…" : "Save Creative"}
                </Button>
              </div>
            </div>
          ) : processing ? (
            <p className="text-sm text-muted-foreground text-center py-8">Learning your artwork…</p>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              {savedCount > 0 ? "All creatives reviewed." : "No creatives left to review."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
