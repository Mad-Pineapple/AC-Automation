import { useEffect } from "react";
import { useGetBrief, useUpdateBrief, useListBrands, useListCampaigns, useListTemplates, getGetBriefQueryKey, getListBriefsQueryKey } from "@workspace/api-client-react";
import { useParams, useLocation, Link } from "wouter";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Upload, X } from "lucide-react";
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

export default function EditBrief() {
  const { id } = useParams<{ id: string }>();
  const briefId = Number(id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { uploadFile, isUploading } = useUpload();
  const updateBrief = useUpdateBrief();
  const { data: brands, isLoading: brandsLoading } = useListBrands();
  const { data: campaigns } = useListCampaigns();
  const { data: customTemplates } = useListTemplates();
  // Templates (custom formats and learned creatives) are reusable layouts that
  // aren't tied to a brand's supported sizes, so they stay selectable in any brief.
  const customKeys = new Set((customTemplates ?? []).map(t => t.key));
  const sizeOptions = [
    ...ALL_TEMPLATE_SIZES.map(k => ({ key: k, label: TEMPLATE_SIZE_LABELS[k] })),
    ...(customTemplates ?? []).map(t => ({ key: t.key, label: `${t.name} (${t.dims})` })),
  ];
  const { data: brief, isLoading } = useGetBrief(briefId, {
    query: { enabled: !!briefId, queryKey: getGetBriefQueryKey(briefId) },
  });

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

  useEffect(() => {
    // Wait for the brands list too: if the form is filled while the brand
    // Select has no options mounted yet, the Select clears the unknown value
    // and the brief loads with no brand (which also hides the library picker).
    if (brief && brands) {
      form.reset({
        campaignName: brief.campaignName,
        brandId: String(brief.brandId),
        campaignId: brief.campaignId != null ? String(brief.campaignId) : NO_CAMPAIGN,
        useAiCopy: brief.useAiCopy,
        headline: brief.headline ?? "",
        bodyText: brief.bodyText ?? "",
        callToAction: brief.callToAction ?? "",
        notes: brief.notes ?? "",
        productImageUrl: brief.productImageUrl ?? "",
        templateSizes: brief.templateSizes.length > 0 ? brief.templateSizes : ["social_square"],
      });
    }
  }, [brief, brands, form]);

  const useAiCopy = form.watch("useAiCopy");
  const selectedBrandId = form.watch("brandId");
  const selectedSizes = form.watch("templateSizes");

  const selectedBrand = brands?.find(b => String(b.id) === selectedBrandId);
  const availableSizeOptions = selectedBrand
    ? sizeOptions.filter(o => selectedBrand.supportedTemplateSizes.includes(o.key) || customKeys.has(o.key))
    : sizeOptions;

  useEffect(() => {
    // Wait for templates so customKeys is populated; otherwise a selected
    // learned creative (never in supportedTemplateSizes) gets silently pruned.
    if (!selectedBrand || !customTemplates) return;
    const supported = selectedBrand.supportedTemplateSizes;
    const filtered = selectedSizes.filter(s => supported.includes(s) || customKeys.has(s));
    if (filtered.length !== selectedSizes.length) {
      form.setValue("templateSizes", filtered, { shouldValidate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBrandId, customTemplates]);

  const onSubmit = (values: BriefFormValues) => {
    updateBrief.mutate({
      id: briefId,
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
      onSuccess: () => {
        toast({ title: "Brief updated successfully" });
        queryClient.invalidateQueries({ queryKey: getGetBriefQueryKey(briefId) });
        queryClient.invalidateQueries({ queryKey: getListBriefsQueryKey() });
        setLocation(`/briefs/${briefId}`);
      },
      onError: () => {
        toast({ title: "Failed to update brief", variant: "destructive" });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!brief) return <div className="text-muted-foreground p-8">Brief not found.</div>;

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href={`/briefs/${briefId}`} className="p-2 hover:bg-muted rounded-full transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edit Brief</h1>
          <span data-testid="debug-brandid" className="hidden">{JSON.stringify({ selectedBrandId, briefBrandId: brief?.brandId, briefLoaded: !!brief, brandsLoaded: !!brands })}</span>
          <p className="text-muted-foreground text-sm font-mono mt-1 uppercase tracking-widest">Update Your Campaign</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                      placeholder="Objective, audience, key messages, mandatories. The AI grounds all copy and artwork in this."
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
                    <div className="flex items-center gap-2">
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
              {useAiCopy ? (
                <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3 border border-border/50">
                  AI will generate brand-appropriate copy for each selected template size based on your campaign name and brand tone of voice.
                </p>
              ) : (
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
            <CardHeader><CardTitle className="text-base">Template Sizes</CardTitle></CardHeader>
            <CardContent>
              <FormField control={form.control} name="templateSizes" render={({ field }) => (
                <FormItem>
                  {!selectedBrandId && (
                    <p className="text-sm text-muted-foreground mb-2">Select a brand to see its supported template sizes.</p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {availableSizeOptions.map(({ key: size, label }) => (
                      <label key={size} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                        ${field.value.includes(size) ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"}`}>
                        <Checkbox
                          checked={field.value.includes(size)}
                          onCheckedChange={(checked) => {
                            if (checked) field.onChange([...field.value, size]);
                            else field.onChange(field.value.filter((s: string) => s !== size));
                          }}
                          data-testid={`checkbox-${size}`}
                        />
                        <span className="text-sm">{label}</span>
                      </label>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-end">
            <Link href={`/briefs/${briefId}`}>
              <Button type="button" variant="outline">Cancel</Button>
            </Link>
            <Button type="submit" disabled={updateBrief.isPending || isUploading} data-testid="button-submit-brief">
              {updateBrief.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
