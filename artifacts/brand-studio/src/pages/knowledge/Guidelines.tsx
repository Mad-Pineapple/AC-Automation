import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListBrands,
  useAnalyzeBrandGuideline,
  useUpdateBrand,
  getListBrandsQueryKey,
  getGetBrandQueryKey,
  type AnalyzeGuidelineResponse,
  type GuidelineSuggestions,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { useToast } from "@/hooks/use-toast";
import { useMe } from "@/hooks/use-me";
import { ChevronLeft, Upload, Loader2, Sparkles, Check, BookOpen, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const GUIDELINE_FIELD_LABELS: Record<keyof GuidelineSuggestions, string> = {
  primaryColor: "Primary Color",
  secondaryColor: "Secondary Color",
  accentColor: "Accent Color",
  backgroundColor: "Background Color",
  textColor: "Text Color",
  fontFamily: "Font Family",
  toneOfVoice: "Tone of Voice",
  industry: "Industry",
};

const COLOR_KEYS = new Set<string>([
  "primaryColor",
  "secondaryColor",
  "accentColor",
  "backgroundColor",
  "textColor",
]);

export default function KnowledgeGuidelines() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: meData, isLoading: isLoadingMe } = useMe();
  const isAdmin = meData?.role === "admin";

  const { data: brands, isLoading: brandsLoading } = useListBrands();
  const { uploadFile, isUploading } = useUpload();
  const analyzeGuideline = useAnalyzeBrandGuideline();
  const updateBrand = useUpdateBrand();

  const [brandId, setBrandId] = useState<number | null>(null);
  const [result, setResult] = useState<AnalyzeGuidelineResponse | null>(null);
  const [editedGuidelines, setEditedGuidelines] = useState<string>("");
  const [fileName, setFileName] = useState<string | null>(null);

  const busy = isUploading || analyzeGuideline.isPending;
  const selectedBrand = brands?.find((b) => b.id === brandId) ?? null;
  const suggestionEntries = result
    ? (Object.entries(result.suggestions) as [keyof GuidelineSuggestions, string][])
    : [];

  if (isLoadingMe) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center gap-4">
          <Link href="/knowledge" className="p-2 hover:bg-muted rounded-full transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Brand Guidelines</h1>
        </div>
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Only admins can ingest brand guidelines.
          </CardContent>
        </Card>
      </div>
    );
  }

  const handlePdf = async (file: File | null | undefined) => {
    if (!file) return;
    if (!brandId) {
      toast({ title: "Choose a brand first", variant: "destructive" });
      return;
    }
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      toast({ title: "Please choose a PDF file", variant: "destructive" });
      return;
    }
    setResult(null);
    const uploaded = await uploadFile(file);
    if (!uploaded) {
      toast({
        title: "Upload failed",
        description: "Could not upload the PDF. Please try again.",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await analyzeGuideline.mutateAsync({
        id: brandId,
        data: { objectPath: uploaded.objectPath },
      });
      setResult(res);
      setEditedGuidelines(res.guidelines || "");
      setFileName(file.name);
      const found = Object.keys(res.suggestions).length;
      toast({
        title: "Guidelines ingested",
        description: `${found} field${found !== 1 ? "s" : ""} detected${
          res.guidelines ? " plus a guideline summary" : ""
        }. Review and save below.`,
      });
    } catch (err) {
      const data = (err as { data?: { error?: string } } | null)?.data;
      const description =
        data?.error ??
        (err instanceof Error ? err.message : "Could not analyze the PDF.");
      toast({ title: "Analysis failed", description, variant: "destructive" });
    }
  };

  const handleSave = () => {
    if (!brandId || !result) return;
    const trimmed = editedGuidelines.trim();
    const data = {
      ...result.suggestions,
      guidelines: trimmed ? trimmed : null,
    };
    updateBrand.mutate(
      { id: brandId, data },
      {
        onSuccess: () => {
          toast({
            title: "Brand updated from guidelines",
            description:
              "Settings and guidelines saved. Future AI copy and creative will follow them.",
          });
          queryClient.invalidateQueries({ queryKey: getListBrandsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetBrandQueryKey(brandId) });
          setLocation("/knowledge");
        },
        onError: () =>
          toast({ title: "Failed to save brand", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/knowledge" className="p-2 hover:bg-muted rounded-full transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add Brand Guidelines</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1 uppercase tracking-widest">
            Ingest a guideline PDF into a brand
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            1. Which brand do these guidelines apply to?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5 max-w-sm">
            <Label className="text-xs text-muted-foreground">Brand</Label>
            <Select
              value={brandId != null ? String(brandId) : undefined}
              onValueChange={(v) => {
                setBrandId(Number(v));
                setResult(null);
              }}
              disabled={brandsLoading || busy}
            >
              <SelectTrigger data-testid="select-guideline-brand">
                <SelectValue placeholder={brandsLoading ? "Loading brands..." : "Select a brand"} />
              </SelectTrigger>
              <SelectContent>
                {(brands ?? []).map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.name}
                    {b.guidelines ? " (has guidelines)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedBrand?.guidelines && !result && (
            <p className="text-xs text-muted-foreground">
              This brand already has guidelines. Ingesting a new PDF will let you review and
              replace them.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className={brandId ? "" : "opacity-60 pointer-events-none"}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            2. Upload the brand guideline PDF
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-xs text-muted-foreground max-w-md">
            We read the PDF text, suggest colors / font / tone for the brand, and extract a
            guidelines summary that steers future AI copy and creative. Nothing is saved until
            you review and click Save.
          </p>
          <label
            className={`${buttonVariants()} gap-1.5 flex-shrink-0 ${
              busy || !brandId ? "opacity-50 pointer-events-none" : "cursor-pointer"
            }`}
            data-testid="button-upload-guideline"
          >
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              disabled={busy || !brandId}
              onChange={(e) => {
                handlePdf(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {isUploading
              ? "Uploading..."
              : analyzeGuideline.isPending
                ? "Analyzing..."
                : "Upload PDF"}
          </label>
        </CardContent>
      </Card>

      {result && (
        <Card className="border-primary/40 bg-primary/[0.03]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              3. Review &amp; save{fileName ? ` — ${fileName}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {suggestionEntries.length > 0 && (
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-mono mb-2">
                  Detected brand settings
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {suggestionEntries.map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2 min-w-0">
                      {COLOR_KEYS.has(key) && (
                        <span
                          className="w-7 h-7 rounded-md border border-border flex-shrink-0"
                          style={{ backgroundColor: value }}
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-mono truncate">
                          {GUIDELINE_FIELD_LABELS[key]}
                        </p>
                        <p
                          className="text-sm font-medium truncate"
                          data-testid={`suggestion-${key}`}
                        >
                          {value}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground uppercase tracking-wider font-mono">
                Guidelines summary (steers AI generation)
              </Label>
              <Textarea
                value={editedGuidelines}
                onChange={(e) => setEditedGuidelines(e.target.value)}
                rows={10}
                placeholder="No guideline summary was extracted. You can write the brand's voice, key messaging, and do's & don'ts here."
                data-testid="textarea-guidelines"
              />
            </div>

            {result.notes.length > 0 && (
              <div className="border-t border-border/60 pt-3">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-mono mb-1.5">
                  Notes
                </p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                  {result.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center gap-2 border-t border-border/60 pt-4">
              <Button
                className="gap-1.5"
                onClick={handleSave}
                disabled={updateBrand.isPending}
                data-testid="button-save-guidelines"
              >
                {updateBrand.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Save to {selectedBrand?.name ?? "brand"}
              </Button>
              <Button variant="ghost" onClick={() => setResult(null)}>
                Discard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
