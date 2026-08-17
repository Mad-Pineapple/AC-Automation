import { useEffect, useRef, useState } from "react";
import {
  useGetBrand, useUpdateBrand, getListBrandsQueryKey, getGetBrandQueryKey,
  useListBrandStyles, useDeleteBrandStyle, useCreateBrandStyle, getListBrandStylesQueryKey,
  useAnalyzeBrandGuideline,
  useCreateBrandAsset, getListBrandAssetsQueryKey,
  type Brand, type BrandInput, type AnalyzeGuidelineResponse, type GuidelineSuggestions, type ExtractedImage,
} from "@workspace/api-client-react";
import { BrandForm } from "@/components/BrandForm";
import { BrandLibrary } from "@/components/BrandLibrary";
import { BrandHeader } from "@/components/BrandHeader";
import { useListBrandAssets } from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { isTemplateFolder } from "@/lib/templateFolders";
import { useLocation, useParams, useSearch } from "wouter";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Trash2, Palette, Settings, Image as ImageIcon, Upload, Loader2, Sparkles, Check, X } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMe } from "@/hooks/use-me";

function StylesTab({ brandId, brand, isAdmin }: { brandId: number; brand: Brand; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: styles, isLoading } = useListBrandStyles(brandId);
  const deleteStyle = useDeleteBrandStyle();
  const createStyle = useCreateBrandStyle();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDelete = (styleId: number) => {
    deleteStyle.mutate({ brandId, styleId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBrandStylesQueryKey(brandId) });
        toast({ title: "Style deleted" });
      },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    });
  };

  const handleStyleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    let saved = 0;
    for (const file of Array.from(files)) {
      const lower = file.name.toLowerCase();
      const isCss = lower.endsWith(".css") || file.type === "text/css";
      const isHtml = lower.endsWith(".html") || lower.endsWith(".htm") || file.type === "text/html";
      if (!isCss && !isHtml) {
        toast({ title: `Unsupported file: ${file.name}`, description: "Upload an .html or .css file.", variant: "destructive" });
        continue;
      }
      setPendingName(file.name);
      let content = "";
      try {
        content = await file.text();
      } catch {
        toast({ title: `Could not read ${file.name}`, variant: "destructive" });
        continue;
      }
      const baseName = file.name.replace(/\.[^.]+$/, "") || file.name;
      let cssSnippet = "";
      let html: string | null = null;
      if (isCss) {
        cssSnippet = content;
      } else {
        html = content;
        const matches = [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
        cssSnippet = matches.map(m => m[1].trim()).filter(Boolean).join("\n\n");
      }
      await new Promise<void>((resolve) => {
        createStyle.mutate(
          { brandId, data: { name: baseName, cssSnippet, html } },
          {
            onSuccess: () => {
              saved += 1;
              queryClient.invalidateQueries({ queryKey: getListBrandStylesQueryKey(brandId) });
              resolve();
            },
            onError: () => {
              toast({ title: `Failed to save ${file.name}`, variant: "destructive" });
              resolve();
            },
          },
        );
      });
    }
    setPendingName(null);
    if (saved > 0) toast({ title: `${saved} style${saved !== 1 ? "s" : ""} uploaded` });
  };

  const isSaving = createStyle.isPending;

  const toolbar = (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <p className="text-sm text-muted-foreground">
        Saved styles are automatically applied to future AI HTML banner generation for this brand.
      </p>
      {isAdmin && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".html,.htm,.css,text/html,text/css"
            multiple
            className="hidden"
            onChange={(e) => {
              handleStyleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            className="gap-1.5"
            disabled={isSaving}
            onClick={() => fileInputRef.current?.click()}
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {isSaving ? (pendingName ? `Uploading ${pendingName}...` : "Uploading...") : "Upload style"}
          </Button>
        </div>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <BrandHeader brand={brand} />
        <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
      </div>
    );
  }

  if (!styles?.length) {
    return (
      <div className="space-y-4">
        <BrandHeader brand={brand} />
        {toolbar}
        <Card className="border-dashed p-10 text-center">
          <Palette className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium text-sm">No saved styles yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
            {isAdmin
              ? "Upload an HTML or CSS file above, or generate a banner from a brief and click \"Save Style\" on the Approve screen."
              : "Generate an HTML banner from a brief, edit it in the Approve screen, then click \"Save Style\" to store the design pattern here."}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BrandHeader brand={brand} />
      {toolbar}
      {styles.map(style => (
        <Card key={style.id} className="border-border/50">
          <CardHeader className="pb-2 flex-row items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm">{style.name}</CardTitle>
              {style.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{style.description}</p>
              )}
              <p className="text-xs text-muted-foreground/60 mt-1 font-mono">
                {new Date(style.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              <Button
                variant="ghost" size="sm" className="h-7 text-xs px-2"
                onClick={() => setExpandedId(expandedId === style.id ? null : style.id)}
              >
                {expandedId === style.id ? "Hide CSS" : "View CSS"}
              </Button>
              {isAdmin && (
                <Button
                  variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(style.id)}
                  disabled={deleteStyle.isPending}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </CardHeader>
          {expandedId === style.id && (
            <CardContent className="pt-0 space-y-3">
              <pre className="text-xs bg-muted/60 rounded-md p-3 overflow-x-auto whitespace-pre-wrap font-mono">
                {style.cssSnippet}
              </pre>
              {style.sampleHtml && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Sample Preview</p>
                  <div className="border border-border rounded-md overflow-hidden bg-white" style={{ height: 220 }}>
                    <iframe
                      srcDoc={style.sampleHtml}
                      sandbox="allow-scripts"
                      className="w-full h-full"
                      style={{ border: "none" }}
                      title={`Style preview: ${style.name}`}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}

function BrandReadOnly({ brand }: { brand: Brand }) {
  const swatches = [
    { label: "Primary", color: brand.primaryColor },
    { label: "Secondary", color: brand.secondaryColor },
    { label: "Accent", color: brand.accentColor },
    { label: "Background", color: brand.backgroundColor },
    { label: "Text", color: brand.textColor },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="space-y-6">
        <Card className="border-border">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-semibold">Basic Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {brand.logoUrl && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wider font-mono">Logo</p>
                <img src={brand.logoUrl} alt={brand.name} className="h-12 object-contain" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              {brand.industry && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-mono">Industry</p>
                  <p className="text-sm font-medium">{brand.industry}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-mono">Font</p>
                <p className="text-sm font-medium">{brand.fontFamily}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-mono">Tone of Voice</p>
                <p className="text-sm font-medium">{brand.toneOfVoice}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-semibold">Color Palette</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {swatches.map(({ label, color }) => color && (
                <div key={label} className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-md border border-border flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-mono">{label}</p>
                    <p className="text-xs font-mono">{color}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <div
          className="rounded-xl h-48 flex items-center justify-center border border-border overflow-hidden"
          style={{ backgroundColor: brand.backgroundColor || "#f0f0f0" }}
        >
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.name} className="h-16 object-contain" />
          ) : (
            <span className="text-3xl font-bold" style={{ color: brand.textColor || "#000" }}>
              {brand.name}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const GUIDELINE_FIELD_LABELS: Record<keyof GuidelineSuggestions, string> = {
  primaryColor: "Primary Color",
  secondaryColor: "Secondary Color",
  accentColor: "Accent Color",
  backgroundColor: "Background Color",
  textColor: "Text Color",
  fontFamily: "Font Family",
  toneOfVoice: "Tone of Voice",
  strapline: "Strapline",
  industry: "Industry",
};

const GUIDELINE_COLOR_KEYS = new Set<string>([
  "primaryColor",
  "secondaryColor",
  "accentColor",
  "backgroundColor",
  "textColor",
]);

const CHECKER_STYLE = {
  backgroundImage:
    "linear-gradient(45deg, #e6e6e6 25%, transparent 25%), linear-gradient(-45deg, #e6e6e6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e6e6e6 75%), linear-gradient(-45deg, transparent 75%, #e6e6e6 75%)",
  backgroundSize: "14px 14px",
  backgroundPosition: "0 0, 0 7px, 7px -7px, -7px 0",
};

function BrandDetailsTab({
  brand,
  brandId,
  onSubmit,
  isSubmitting,
}: {
  brand: Brand;
  brandId: number;
  onSubmit: (data: BrandInput) => void;
  isSubmitting: boolean;
}) {
  const { toast } = useToast();
  const { uploadFile, isUploading } = useUpload();
  const analyzeGuideline = useAnalyzeBrandGuideline();
  const [result, setResult] = useState<AnalyzeGuidelineResponse | null>(null);
  const [appliedSuggestions, setAppliedSuggestions] = useState<GuidelineSuggestions | null>(null);
  const [appliedGuidelines, setAppliedGuidelines] = useState<string | null>(null);
  const [appliedLogoUrl, setAppliedLogoUrl] = useState<{ value: string; nonce: number } | null>(null);
  const [appliedFontFamily, setAppliedFontFamily] = useState<{ value: string; nonce: number } | null>(null);
  const nonceRef = useRef(0);
  const queryClient = useQueryClient();
  const createAsset = useCreateBrandAsset();

  const busy = isUploading || analyzeGuideline.isPending;
  const suggestionEntries = result
    ? (Object.entries(result.suggestions) as [keyof GuidelineSuggestions, string][])
    : [];
  const extractedImages = result?.images ?? [];
  const extractedFonts = result?.fonts ?? [];

  const handlePdf = async (file: File | null | undefined) => {
    if (!file) return;
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
      const found = Object.keys(res.suggestions).length;
      const imgCount = res.images?.length ?? 0;
      const fontCount = res.fonts?.length ?? 0;
      const parts: string[] = [];
      if (found > 0) parts.push(`${found} field${found !== 1 ? "s" : ""}`);
      if (fontCount > 0) parts.push(`${fontCount} font${fontCount !== 1 ? "s" : ""}`);
      if (imgCount > 0) parts.push(`${imgCount} image${imgCount !== 1 ? "s" : ""}`);
      toast(
        parts.length > 0
          ? {
              title: `Found ${parts.join(", ")}`,
              description: "Review below, then apply what you want to keep.",
            }
          : {
              title: "Nothing detected",
              description: "We couldn't extract anything from this PDF.",
            },
      );
    } catch (err) {
      const data = (err as { data?: { error?: string } } | null)?.data;
      const description =
        data?.error ??
        (err instanceof Error ? err.message : "Could not analyze the PDF.");
      toast({ title: "Analysis failed", description, variant: "destructive" });
    }
  };

  const applySuggestions = () => {
    if (!result) return;
    setAppliedSuggestions(result.suggestions);
    if (result.guidelines) setAppliedGuidelines(result.guidelines);
    // Keep the card open if there are still extracted logos/fonts to act on;
    // only clear the applied suggestions/guidelines so the gallery survives.
    const hasAssets = (result.images?.length ?? 0) > 0 || (result.fonts?.length ?? 0) > 0;
    setResult(hasAssets ? { ...result, suggestions: {}, guidelines: "", notes: [] } : null);
    toast({
      title: "Suggestions applied",
      description: "Review the fields, then click Save Brand to keep them.",
    });
  };

  const handleSetLogo = (url: string) => {
    setAppliedLogoUrl({ value: url, nonce: ++nonceRef.current });
    toast({ title: "Logo applied", description: "Click Save Brand to keep it." });
  };

  const handleUseFont = (font: string) => {
    setAppliedFontFamily({ value: font, nonce: ++nonceRef.current });
    toast({ title: `Font set to ${font}`, description: "Click Save Brand to keep it." });
  };

  const handleSaveAsset = (img: ExtractedImage, index: number) => {
    createAsset.mutate(
      {
        brandId,
        data: {
          name: `Guideline image ${index + 1}`,
          kind: "image",
          objectPath: img.objectPath,
          contentType: "image/png",
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBrandAssetsQueryKey(brandId) });
          toast({ title: "Saved to brand library" });
        },
        onError: () => toast({ title: "Failed to save asset", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <Card className="border-dashed">
        <CardContent className="p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-sm">Auto-fill from a brand guideline PDF</p>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-md">
                Upload a brand guideline PDF to get suggested colors, font, tone, and
                industry. Nothing is saved until you review and click Save Brand.
              </p>
            </div>
          </div>
          <label
            className={`${buttonVariants()} gap-1.5 flex-shrink-0 ${
              busy ? "opacity-50 pointer-events-none" : "cursor-pointer"
            }`}
            data-testid="button-upload-guideline"
          >
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                handlePdf(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
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
          <CardHeader className="pb-3 flex-row items-center justify-between gap-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Suggestions from guideline
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setResult(null)}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {suggestionEntries.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {suggestionEntries.map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 min-w-0">
                    {GUIDELINE_COLOR_KEYS.has(key) && (
                      <span
                        className="w-7 h-7 rounded-md border border-border flex-shrink-0"
                        style={{ backgroundColor: value }}
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-mono truncate">
                        {GUIDELINE_FIELD_LABELS[key]}
                      </p>
                      <p className="text-sm font-medium truncate" data-testid={`suggestion-${key}`}>
                        {value}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {extractedFonts.length > 0 && (
              <div className="border-t border-border/60 pt-3">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-mono mb-2">
                  Fonts found ({extractedFonts.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {extractedFonts.map((font) => (
                    <button
                      key={font}
                      type="button"
                      onClick={() => handleUseFont(font)}
                      className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium hover:border-primary hover:bg-primary/5 transition-colors"
                      data-testid={`font-chip-${font}`}
                    >
                      <span style={{ fontFamily: `'${font}', sans-serif` }}>{font}</span>
                      <span className="text-[10px] text-muted-foreground group-hover:text-primary">Use</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {extractedImages.length > 0 && (
              <div className="border-t border-border/60 pt-3">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-mono mb-2">
                  Logos &amp; imagery ({extractedImages.length})
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {extractedImages.map((img, i) => (
                    <div
                      key={img.objectPath}
                      className="group relative rounded-lg border border-border overflow-hidden"
                      style={CHECKER_STYLE}
                    >
                      <div className="aspect-square flex items-center justify-center p-2">
                        <img
                          src={img.url}
                          alt={`Extracted graphic ${i + 1}`}
                          className="h-full w-full object-contain"
                          loading={i < 12 ? "eager" : "lazy"}
                        />
                      </div>
                      <div className="absolute inset-x-0 bottom-0 flex divide-x divide-border/60 border-t border-border/60 bg-background/95 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => handleSetLogo(img.url)}
                          className="flex-1 py-1.5 text-[11px] font-medium hover:bg-primary/10"
                          data-testid={`set-logo-${i}`}
                        >
                          Set as logo
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveAsset(img, i)}
                          disabled={createAsset.isPending}
                          className="flex-1 py-1.5 text-[11px] font-medium hover:bg-primary/10 disabled:opacity-50"
                          data-testid={`save-asset-${i}`}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.guidelines && (
              <div className="border-t border-border/60 pt-3">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-mono mb-1.5">
                  Brand guidelines summary
                </p>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap" data-testid="suggestion-guidelines">
                  {result.guidelines}
                </p>
              </div>
            )}
            {suggestionEntries.length > 0 || result.guidelines ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={applySuggestions}
                  data-testid="button-apply-suggestions"
                >
                  <Check className="w-3.5 h-3.5" />
                  Apply to form
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
                  Dismiss
                </Button>
              </div>
            ) : extractedImages.length === 0 && extractedFonts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No brand fields, fonts, or imagery could be extracted from this PDF.
              </p>
            ) : null}
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
          </CardContent>
        </Card>
      )}

      <BrandForm
        initialData={brand}
        appliedSuggestions={appliedSuggestions}
        appliedGuidelines={appliedGuidelines}
        appliedLogoUrl={appliedLogoUrl}
        appliedFontFamily={appliedFontFamily}
        onSubmit={onSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}

export default function EditBrand() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const brandId = Number(id);
  const search = useSearch();
  const tabParam = new URLSearchParams(search).get("tab");
  const [activeTab, setActiveTab] = useState<"details" | "library" | "styles">(
    tabParam === "library" ? "library" : tabParam === "styles" ? "styles" : "details",
  );

  useEffect(() => {
    if (tabParam === "library" || tabParam === "styles") {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const { data: brand, isLoading } = useGetBrand(brandId, {
    query: { enabled: !!brandId, queryKey: getGetBrandQueryKey(brandId) },
  });
  const updateBrand = useUpdateBrand();
  const { data: meData } = useMe();
  const isAdmin = meData?.role === "admin";
  const { isSignedIn } = useUser();
  const canUpload = !!isSignedIn;

  const handleSubmit = (data: any) => {
    updateBrand.mutate({ id: brandId, data }, {
      onSuccess: () => {
        toast({ title: "Brand updated successfully" });
        queryClient.invalidateQueries({ queryKey: getListBrandsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBrandQueryKey(brandId) });
        setLocation("/brands");
      },
      onError: () => {
        toast({ title: "Failed to update brand", variant: "destructive" });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/brands" className="p-2 hover:bg-muted rounded-full transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {isAdmin ? "Edit Brand Profile" : "Brand Profile"}
          </h1>
          <p className="text-muted-foreground text-sm font-mono mt-1">{brand?.name}</p>
        </div>
      </div>

      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        <Button
          variant={activeTab === "details" ? "secondary" : "ghost"}
          size="sm"
          className="gap-1.5"
          onClick={() => setActiveTab("details")}
        >
          <Settings className="w-3.5 h-3.5" />
          Brand Details
        </Button>
        <Button
          variant={activeTab === "library" ? "secondary" : "ghost"}
          size="sm"
          className="gap-1.5"
          onClick={() => setActiveTab("library")}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          Library
          {brand && <LibraryBadge brandId={brandId} />}
        </Button>
        <Button
          variant={activeTab === "styles" ? "secondary" : "ghost"}
          size="sm"
          className="gap-1.5"
          onClick={() => setActiveTab("styles")}
        >
          <Palette className="w-3.5 h-3.5" />
          Saved Styles
          {brand && <StylesBadge brandId={brandId} />}
        </Button>
      </div>

      {activeTab === "details" && brand && (
        isAdmin ? (
          <BrandDetailsTab
            brand={brand}
            brandId={brandId}
            onSubmit={handleSubmit}
            isSubmitting={updateBrand.isPending}
          />
        ) : (
          <BrandReadOnly brand={brand} />
        )
      )}
      {activeTab === "library" && brand && (
        <BrandLibrary brandId={brandId} brand={brand} isAdmin={isAdmin} canUpload={canUpload} />
      )}
      {activeTab === "styles" && brand && (
        <StylesTab brandId={brandId} brand={brand} isAdmin={isAdmin} />
      )}
    </div>
  );
}

function StylesBadge({ brandId }: { brandId: number }) {
  const { data: styles } = useListBrandStyles(brandId);
  if (!styles?.length) return null;
  return <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-0.5">{styles.length}</Badge>;
}

function LibraryBadge({ brandId }: { brandId: number }) {
  const { data: assets } = useListBrandAssets(brandId);
  const count = assets?.filter((a) => !isTemplateFolder(a.folder)).length ?? 0;
  if (!count) return null;
  return <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-0.5">{count}</Badge>;
}
