import { useState, useEffect, useRef } from "react";
import { useCreateBrief, useCreateBriefsBulk, useParseBriefDocument, useSuggestBriefSizes, useListBrands, useListCampaigns, useListTemplates, useListBrandAssets, getListBrandAssetsQueryKey, getListBriefsQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Upload, FileText, X, Download, ImageIcon, Sparkles, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { TEMPLATE_SIZE_LABELS, ALL_TEMPLATE_SIZES } from "@/components/TemplateRenderer";
import { BrandIdentityPreview } from "@/components/BrandIdentityPreview";
import { LibraryImagePicker } from "@/components/LibraryImagePicker";
import { useUpload } from "@workspace/object-storage-web";

const NO_CAMPAIGN = "__none__";

const briefSchema = z.object({
  campaignName: z.string().min(1, "Campaign name is required"),
  brandId: z.string().min(1, "Please select a brand"),
  campaignId: z.string().optional(),
  useAiCopy: z.boolean(),
  headline: z.string().optional(),
  bodyText: z.string().optional(),
  callToAction: z.string().optional(),
  notes: z.string().optional(),
  productImageUrl: z.string().optional(),
  templateSizes: z.array(z.string()).min(1, "Select at least one template size"),
});

type BriefFormValues = z.infer<typeof briefSchema>;

interface CsvRow {
  campaignName: string;
  headline?: string;
  bodyText?: string;
  callToAction?: string;
  productImageUrl?: string;
  useAiCopy: boolean;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const headers = headerLine.split(",").map(h => h.trim().toLowerCase().replace(/[\s_-]+/g, "_"));

  const col = (row: string[], key: string): string => {
    const idx = headers.indexOf(key);
    return idx >= 0 ? (row[idx] ?? "").trim().replace(/^["']|["']$/g, "") : "";
  };

  return lines.slice(1).map(line => {
    const row = line.split(",");
    const aiFlag = col(row, "use_ai_copy").toLowerCase();
    return {
      campaignName: col(row, "campaign_name") || col(row, "name") || col(row, "campaign"),
      headline: col(row, "headline") || undefined,
      bodyText: col(row, "body_text") || col(row, "body") || undefined,
      callToAction: col(row, "call_to_action") || col(row, "cta") || undefined,
      productImageUrl: col(row, "product_image_url") || col(row, "image_url") || undefined,
      useAiCopy: aiFlag === "" || aiFlag === "true" || aiFlag === "yes" || aiFlag === "1",
    };
  }).filter(r => r.campaignName);
}

export default function NewBrief() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createBrief = useCreateBrief();
  const createBulk = useCreateBriefsBulk();
  const parseBriefDoc = useParseBriefDocument();
  const { uploadFile, isUploading } = useUpload();
  const { data: brands, isLoading: brandsLoading } = useListBrands();
  const { data: campaigns } = useListCampaigns();
  const { data: customTemplates } = useListTemplates();
  const builtinOptions = ALL_TEMPLATE_SIZES.map(k => ({ key: k, label: TEMPLATE_SIZE_LABELS[k] }));
  // Templates (custom formats and learned creatives) are reusable layouts that
  // aren't tied to a brand's supported sizes, so they stay selectable in any brief.
  const templateOptions = (customTemplates ?? []).map(t => ({
    key: t.key,
    label: `${t.name} (${t.dims})`,
    category: t.category,
  }));
  const customKeys = new Set(templateOptions.map(o => o.key));
  const sizeOptions = [...builtinOptions, ...templateOptions];
  const [presetApplied, setPresetApplied] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[] | null>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [briefDocName, setBriefDocName] = useState<string | null>(null);
  const docBusy = isUploading || parseBriefDoc.isPending;

  const form = useForm<BriefFormValues>({
    resolver: zodResolver(briefSchema),
    defaultValues: {
      campaignName: "",
      brandId: "",
      campaignId: NO_CAMPAIGN,
      useAiCopy: true,
      headline: "",
      bodyText: "",
      callToAction: "",
      notes: "",
      productImageUrl: "",
      templateSizes: ["social_square"],
    },
  });

  const useAiCopy = form.watch("useAiCopy");
  const selectedBrandId = form.watch("brandId");
  const selectedSizes = form.watch("templateSizes");

  // Auto-suggest sizes from whatever the user has typed (or imported from a
  // brief document). Debounced; stops the moment the user picks sizes by hand.
  const suggestSizes = useSuggestBriefSizes();
  const [sizesTouched, setSizesTouched] = useState(false);
  const [suggestReason, setSuggestReason] = useState<string | null>(null);
  const lastSuggestedFor = useRef<string>("");
  const watchedCampaignName = form.watch("campaignName");
  const watchedHeadline = form.watch("headline");
  const watchedBodyText = form.watch("bodyText");
  const watchedNotes = form.watch("notes");

  useEffect(() => {
    if (sizesTouched) return;
    const text = [watchedCampaignName, watchedHeadline, watchedBodyText, watchedNotes]
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text.length < 25 || text === lastSuggestedFor.current) return;
    const timer = setTimeout(() => {
      lastSuggestedFor.current = text;
      suggestSizes.mutate(
        { data: { text } },
        {
          onSuccess: (result) => {
            if (sizesTouched) return;
            const valid = result.sizes.filter((s) =>
              availableSizeOptions.some((o) => o.key === s),
            );
            if (valid.length > 0) {
              form.setValue("templateSizes", valid, { shouldValidate: true });
              setSuggestReason(result.reason || "Suggested from your brief text.");
            }
          },
        },
      );
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedCampaignName, watchedHeadline, watchedBodyText, watchedNotes, sizesTouched]);

  const selectedBrand = brands?.find(b => String(b.id) === selectedBrandId);
  const availableBuiltinOptions = selectedBrand
    ? builtinOptions.filter(o => selectedBrand.supportedTemplateSizes.includes(o.key))
    : builtinOptions;
  const availableSizeOptions = [...availableBuiltinOptions, ...templateOptions];

  useEffect(() => {
    // Wait for templates so customKeys is populated; otherwise a selected
    // template (never in supportedTemplateSizes) gets silently pruned.
    if (!selectedBrand || !customTemplates) return;
    const supported = selectedBrand.supportedTemplateSizes;
    const filtered = selectedSizes.filter(s => supported.includes(s) || customKeys.has(s));
    if (filtered.length !== selectedSizes.length) {
      form.setValue("templateSizes", filtered, { shouldValidate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBrandId, customTemplates]);

  // Preselect a learned creative when arriving from the Knowledge tab
  // ("Use this creative" → /briefs/new?template=tpl_<id>).
  useEffect(() => {
    if (presetApplied || !customTemplates) return;
    const param = new URLSearchParams(window.location.search).get("template");
    if (param && customTemplates.some(t => t.key === param)) {
      form.setValue("templateSizes", [param], { shouldValidate: true });
    }
    setPresetApplied(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customTemplates, presetApplied]);

  const onSubmit = (values: BriefFormValues) => {
    createBrief.mutate({
      data: {
        campaignName: values.campaignName,
        brandId: Number(values.brandId),
        campaignId: values.campaignId && values.campaignId !== NO_CAMPAIGN ? Number(values.campaignId) : null,
        useAiCopy: values.useAiCopy,
        headline: values.headline || null,
        bodyText: values.bodyText || null,
        callToAction: values.callToAction || null,
        notes: values.notes || null,
        productImageUrl: values.productImageUrl || null,
        templateSizes: values.templateSizes,
      }
    }, {
      onSuccess: (brief) => {
        toast({ title: "Brief created successfully" });
        queryClient.invalidateQueries({ queryKey: getListBriefsQueryKey() });
        setLocation(`/briefs/${brief.id}`);
      },
      onError: () => {
        toast({ title: "Failed to create brief", variant: "destructive" });
      }
    });
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCsv(text);
      if (rows.length === 0) {
        toast({ title: "No valid rows found in CSV", variant: "destructive" });
        return;
      }
      setCsvRows(rows);
      toast({ title: `${rows.length} campaign${rows.length !== 1 ? "s" : ""} loaded`, description: "Select a brand and sizes, then click Import." });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Upload a Word/PDF brief, extract its text server-side, and pre-fill the form
  // for the user to review. Leaves fields untouched on failure.
  const handleBriefDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
      toast({ title: "Unsupported file", description: "Upload a Word (.docx) or PDF document.", variant: "destructive" });
      return;
    }
    setBriefDocName(file.name);
    const uploaded = await uploadFile(file);
    if (!uploaded) {
      toast({ title: "Upload failed", description: "Could not upload the document. Please try again.", variant: "destructive" });
      setBriefDocName(null);
      return;
    }
    try {
      const fields = await parseBriefDoc.mutateAsync({ data: { objectPath: uploaded.objectPath, fileName: file.name } });
      if (fields.campaignName) form.setValue("campaignName", fields.campaignName, { shouldValidate: true });
      // Keep AI copy ON: extracted copy fields act as creative direction for
      // the generators (and AI image generation stays enabled), while the
      // notes summary grounds every prompt in the actual brief.
      if (fields.headline) form.setValue("headline", fields.headline);
      if (fields.bodyText) form.setValue("bodyText", fields.bodyText);
      if (fields.callToAction) form.setValue("callToAction", fields.callToAction);
      if (fields.notes) form.setValue("notes", fields.notes);
      const warn = fields.warnings?.length ? ` Note: ${fields.warnings.join(" ")}` : "";
      toast({ title: "Brief imported", description: `Fields pre-filled from ${file.name}. Review before creating.${warn}` });
    } catch {
      toast({
        title: "Couldn't read the document",
        description: "We couldn't extract a brief from that file. Try another document or fill the form manually.",
        variant: "destructive",
      });
      setBriefDocName(null);
    }
  };

  const handleDownloadTemplate = () => {
    const csv = [
      "campaign_name,headline,body_text,call_to_action,product_image_url,use_ai_copy",
      "Summer Clearance Sale,,,,,true",
      "Winter Warmers Collection,,,,,true",
      "Back to School Essentials,Gear Up For Term One,Everything your kids need to start the year right,Shop School,,false",
      "Kitchen Appliance Blowout,Up To 40% Off Top Brands,Refresh your kitchen with premium appliances at unbeatable prices,Browse Deals,,false",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "campaign-briefs-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBulkImport = () => {
    if (!csvRows?.length || !selectedBrandId || !selectedSizes.length) return;
    setBulkSubmitting(true);
    const brandIdNum = Number(selectedBrandId);
    createBulk.mutate({
      data: {
        brandId: brandIdNum,
        rows: csvRows.map(row => ({
          campaignName: row.campaignName,
          headline: row.headline ?? null,
          bodyText: row.bodyText ?? null,
          callToAction: row.callToAction ?? null,
          productImageUrl: row.productImageUrl ?? null,
          useAiCopy: row.useAiCopy,
          templateSizes: selectedSizes,
          brandId: brandIdNum,
        })),
      }
    }, {
      onSuccess: (created) => {
        toast({ title: `${created.length} brief${created.length !== 1 ? "s" : ""} created`, description: "Opening the campaigns list." });
        queryClient.invalidateQueries({ queryKey: getListBriefsQueryKey() });
        setBulkSubmitting(false);
        setCsvRows(null);
        setCsvFileName(null);
        setLocation("/briefs");
      },
      onError: () => {
        toast({ title: "Bulk import failed", variant: "destructive" });
        setBulkSubmitting(false);
      }
    });
  };

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/briefs" className="p-2 hover:bg-muted rounded-full transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New Campaign Brief</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1 uppercase tracking-widest">Configure Your Campaign</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card className={briefDocName ? "border-primary/50 bg-primary/5" : "border-dashed border-border/60"}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary shrink-0">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Start from a brief document</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Upload a Word (.docx) or PDF brief and we'll read it and pre-fill the fields below for you to review.
                    </p>
                    {briefDocName && (
                      <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                        <FileText className="h-3.5 w-3.5" />{briefDocName}
                      </span>
                    )}
                  </div>
                </div>
                <label className={`shrink-0 ${docBusy ? "opacity-60 pointer-events-none" : "cursor-pointer"}`}>
                  <input type="file" accept=".pdf,.docx" className="hidden" disabled={docBusy} onChange={handleBriefDocUpload} data-testid="input-brief-document" />
                  <Button type="button" variant="outline" size="sm" asChild>
                    <span><Upload className="w-3.5 h-3.5 mr-2" />{docBusy ? "Reading…" : "Upload brief"}</span>
                  </Button>
                </label>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader><CardTitle className="text-base">Campaign Details</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <FormField control={form.control} name="campaignName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Campaign Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. Summer Sale 2025" data-testid="input-campaign-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Campaign notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Objective, audience, key messages, mandatories — auto-filled when you import a brief document. The AI grounds all copy and artwork in this."
                      rows={4}
                      data-testid="input-notes"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="brandId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Brand</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-brand">
                        <SelectValue placeholder={brandsLoading ? "Loading brands..." : "Select a brand"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {brands?.map(b => (
                        <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedBrand && (
                    <div className="mt-2">
                      <BrandIdentityPreview brand={selectedBrand} />
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="campaignId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Campaign (optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-campaign">
                        <SelectValue placeholder="No campaign" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_CAMPAIGN}>No campaign</SelectItem>
                      {campaigns?.map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="productImageUrl" render={({ field }) => (
                <FormItem>
                  <FormLabel>Product Image (optional)</FormLabel>
                  <div className="space-y-2">
                    <FormControl>
                      <Input {...field} placeholder="https://... (paste URL)" data-testid="input-product-image-url" />
                    </FormControl>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">or</span>
                      <label className={`flex items-center gap-1.5 text-xs text-primary hover:underline ${isUploading ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}>
                        <Upload className="h-3 w-3" />
                        {isUploading ? "Uploading…" : "Upload file"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={isUploading}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const uploaded = await uploadFile(file);
                            e.target.value = "";
                            if (!uploaded) {
                              toast({
                                title: "Image upload failed",
                                description: "Could not upload the image. Please try again.",
                                variant: "destructive",
                              });
                              return;
                            }
                            field.onChange(`/api/storage${uploaded.objectPath}`);
                          }}
                        />
                      </label>
                      <LibraryImagePicker
                        brandId={selectedBrandId}
                        onSelect={(url) => field.onChange(url)}
                      />
                      {field.value && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => field.onChange("")}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    {field.value && (
                      <img src={field.value} alt="Preview" className="h-16 w-16 object-cover rounded border border-border" />
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Copy</CardTitle>
                <FormField control={form.control} name="useAiCopy" render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <Label htmlFor="ai-copy-toggle" className="text-sm text-muted-foreground">AI Generated</Label>
                    <Switch
                      id="ai-copy-toggle"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="switch-ai-copy"
                    />
                  </div>
                )} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {useAiCopy && (
                <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3 border border-border/50">
                  AI will write brand-appropriate copy for each selected size, grounded in your campaign notes. Anything you enter below is used as direction rather than verbatim.
                </p>
              )}
              {(
                <>
                  <FormField control={form.control} name="headline" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Headline</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Main headline text" data-testid="input-headline" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="bodyText" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Body Text</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder="Supporting copy..." rows={3} data-testid="input-body-text" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="callToAction" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Call to Action</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. Shop Now" data-testid="input-cta" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                Template Sizes
                {suggestSizes.isPending && (
                  <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Suggesting…
                  </span>
                )}
              </CardTitle>
              {suggestReason && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground font-normal">
                  <Sparkles className="w-3.5 h-3.5 shrink-0 text-primary" />
                  <span>{suggestReason} Tick or untick to override.</span>
                </p>
              )}
            </CardHeader>
            <CardContent>
              <FormField control={form.control} name="templateSizes" render={({ field }) => {
                const toggleSize = (size: string, checked: boolean | string) => {
                  setSizesTouched(true);
                  setSuggestReason(null);
                  if (checked) field.onChange([...field.value, size]);
                  else field.onChange(field.value.filter((s: string) => s !== size));
                };
                const sizeCheckbox = (size: string, label: string, badge?: string) => (
                  <label key={size} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                    ${field.value.includes(size) ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"}`}>
                    <Checkbox
                      checked={field.value.includes(size)}
                      onCheckedChange={(checked) => toggleSize(size, checked)}
                      data-testid={`checkbox-${size}`}
                    />
                    <span className="text-sm flex-1">{label}</span>
                    {badge && (
                      <Badge variant="secondary" className="text-[10px] h-5 px-1.5 capitalize shrink-0">
                        {badge}
                      </Badge>
                    )}
                  </label>
                );
                return (
                  <FormItem className="space-y-4">
                    {!selectedBrandId && (
                      <p className="text-sm text-muted-foreground mb-2">Select a brand to see its supported template sizes.</p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {availableBuiltinOptions.map(({ key: size, label }) => sizeCheckbox(size, label))}
                    </div>
                    {templateOptions.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Your templates</p>
                          <Link href="/templates" className="text-xs text-primary hover:underline">Manage templates</Link>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {templateOptions.map(({ key: size, label, category }) =>
                            sizeCheckbox(size, label, category === "knowledge" ? "learned" : category),
                          )}
                        </div>
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                );
              }} />
            </CardContent>
          </Card>

          <Card className={`border-border/50 ${csvRows ? "border-primary/50 bg-primary/5" : "border-dashed"}`}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Bulk Import via CSV</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Columns: <code className="bg-muted px-1 rounded text-xs">campaign_name, headline, body_text, call_to_action, product_image_url, use_ai_copy</code>
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button type="button" variant="ghost" size="sm" onClick={handleDownloadTemplate} data-testid="button-download-template">
                    <Download className="w-3.5 h-3.5 mr-2" />Template
                  </Button>
                  <label className="cursor-pointer">
                    <input type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} data-testid="input-csv-upload" />
                    <Button type="button" variant="outline" size="sm" asChild>
                      <span><Upload className="w-3.5 h-3.5 mr-2" />Upload CSV</span>
                    </Button>
                  </label>
                </div>
              </div>

              {csvRows && csvFileName && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">{csvFileName}</span>
                      <Badge variant="secondary" className="text-xs">{csvRows.length} campaigns</Badge>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setCsvRows(null); setCsvFileName(null); }} className="h-7 w-7 p-0">
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="max-h-32 overflow-y-auto rounded border border-border/50 divide-y divide-border/50">
                    {csvRows.slice(0, 10).map((row, i) => (
                      <div key={i} className="px-3 py-2 text-xs flex items-center gap-2">
                        <span className="text-muted-foreground w-4">{i + 1}</span>
                        <span className="font-medium flex-1">{row.campaignName}</span>
                        {row.useAiCopy && <Badge variant="outline" className="text-xs shrink-0">AI Copy</Badge>}
                      </div>
                    ))}
                    {csvRows.length > 10 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">+{csvRows.length - 10} more rows</div>
                    )}
                  </div>
                  <Button
                    type="button"
                    onClick={handleBulkImport}
                    disabled={bulkSubmitting || !selectedBrandId || !selectedSizes.length}
                    className="w-full"
                    data-testid="button-bulk-import"
                  >
                    {bulkSubmitting ? "Creating briefs..." : `Import ${csvRows.length} Campaign${csvRows.length !== 1 ? "s" : ""}`}
                  </Button>
                  {!selectedBrandId && <p className="text-xs text-muted-foreground text-center">Select a brand above to enable import</p>}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-end">
            <Link href="/briefs">
              <Button type="button" variant="outline">Cancel</Button>
            </Link>
            <Button type="submit" disabled={createBrief.isPending || isUploading} data-testid="button-submit-brief">
              {createBrief.isPending ? "Creating..." : "Create Brief"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
