import { useEffect } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { BrandInput, GuidelineSuggestions } from "@workspace/api-client-react";
import { Upload, Image as ImageIcon } from "lucide-react";
import { useUpload } from "@workspace/object-storage-web";
import { useToast } from "@/hooks/use-toast";

const KNOWN_FONTS: { value: string; label: string; css: string }[] = [
  { value: "National 2", label: "National 2 (Auckland Council)", css: "'National 2', 'Helvetica Neue', sans-serif" },
  { value: "Inter", label: "Inter (Sans)", css: "Inter, sans-serif" },
  { value: "Plus Jakarta Sans", label: "Plus Jakarta Sans", css: "'Plus Jakarta Sans', sans-serif" },
  { value: "Space Grotesk", label: "Space Grotesk (Mono)", css: "'Space Grotesk', monospace" },
  { value: "Georgia", label: "Georgia (Serif)", css: "Georgia, serif" },
  { value: "Playfair Display", label: "Playfair Display (Serif)", css: "'Playfair Display', serif" },
];

function fontCss(font: string | undefined): string {
  const known = KNOWN_FONTS.find((f) => f.value === font);
  if (known) return known.css;
  return font ? `'${font}', sans-serif` : "Inter, sans-serif";
}

const brandSchema = z.object({
  name: z.string().min(1, "Brand name is required"),
  logoUrl: z
    .string()
    .refine((v) => !v || v.startsWith("/") || /^https?:\/\//i.test(v), "Enter a valid URL")
    .optional()
    .or(z.literal("")),
  primaryColor: z.string().min(1, "Required"),
  secondaryColor: z.string().min(1, "Required"),
  accentColor: z.string().min(1, "Required"),
  backgroundColor: z.string().min(1, "Required"),
  textColor: z.string().min(1, "Required"),
  fontFamily: z.string().min(1, "Required"),
  toneOfVoice: z.string().min(1, "Required"),
  guidelines: z.string().optional().or(z.literal("")),
  industry: z.string().optional().or(z.literal("")),
});

interface AppliedValue {
  value: string;
  nonce: number;
}

interface BrandFormProps {
  initialData?: Partial<BrandInput>;
  appliedSuggestions?: GuidelineSuggestions | null;
  appliedGuidelines?: string | null;
  appliedLogoUrl?: AppliedValue | null;
  appliedFontFamily?: AppliedValue | null;
  onSubmit: (data: BrandInput) => void;
  isSubmitting?: boolean;
}

export function BrandForm({ initialData, appliedSuggestions, appliedGuidelines, appliedLogoUrl, appliedFontFamily, onSubmit, isSubmitting }: BrandFormProps) {
  const form = useForm<z.infer<typeof brandSchema>>({
    resolver: zodResolver(brandSchema),
    defaultValues: {
      name: initialData?.name || "",
      logoUrl: initialData?.logoUrl || "",
      primaryColor: initialData?.primaryColor || "#000000",
      secondaryColor: initialData?.secondaryColor || "#333333",
      accentColor: initialData?.accentColor || "#ff0000",
      backgroundColor: initialData?.backgroundColor || "#ffffff",
      textColor: initialData?.textColor || "#000000",
      fontFamily: initialData?.fontFamily || "Inter",
      toneOfVoice: initialData?.toneOfVoice || "Professional",
      guidelines: initialData?.guidelines || "",
      industry: initialData?.industry || "",
    },
  });

  useEffect(() => {
    if (appliedSuggestions) {
      form.reset({ ...form.getValues(), ...appliedSuggestions });
    }
  }, [appliedSuggestions]);

  useEffect(() => {
    if (appliedGuidelines != null) {
      form.reset({ ...form.getValues(), guidelines: appliedGuidelines });
    }
  }, [appliedGuidelines]);

  useEffect(() => {
    if (appliedLogoUrl) {
      form.setValue("logoUrl", appliedLogoUrl.value, { shouldDirty: true, shouldValidate: true });
    }
  }, [appliedLogoUrl?.nonce]);

  useEffect(() => {
    if (appliedFontFamily) {
      form.setValue("fontFamily", appliedFontFamily.value, { shouldDirty: true, shouldValidate: true });
    }
  }, [appliedFontFamily?.nonce]);

  const { uploadFile, isUploading } = useUpload();
  const { toast } = useToast();

  // Upload a logo image straight to object storage and write the servable URL
  // into the logoUrl field. Saved with the rest of the form on "Save Brand".
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please choose an image file", description: "Upload a PNG, JPG, or SVG logo.", variant: "destructive" });
      return;
    }
    const uploaded = await uploadFile(file);
    if (!uploaded) {
      toast({ title: "Upload failed", description: "Could not upload the logo. Please try again.", variant: "destructive" });
      return;
    }
    form.setValue("logoUrl", `/api/storage${uploaded.objectPath}`, { shouldDirty: true, shouldValidate: true });
    toast({ title: "Logo uploaded", description: "Click Save Brand to keep it." });
  };

  const handleFormSubmit = (values: z.infer<typeof brandSchema>) => {
    onSubmit({
      ...values,
      guidelines: values.guidelines && values.guidelines.trim() ? values.guidelines : null,
    } as BrandInput);
  };

  const previewValues = form.watch();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6">
            <div className="space-y-4 bg-card p-6 border border-border rounded-xl">
              <h3 className="font-semibold text-lg tracking-tight">Basic Info</h3>
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Brand Name</FormLabel>
                  <FormControl><Input {...field} data-testid="input-brand-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              
              <FormField control={form.control} name="logoUrl" render={({ field }) => (
                <FormItem>
                  <FormLabel>Logo</FormLabel>
                  <div className="flex items-center gap-3">
                    {field.value ? (
                      <img src={field.value} alt="Brand logo" className="h-11 w-11 rounded-md border border-border object-contain bg-muted/40 p-1 shrink-0" />
                    ) : (
                      <div className="h-11 w-11 rounded-md border border-dashed border-border flex items-center justify-center text-muted-foreground shrink-0">
                        <ImageIcon className="h-4 w-4" />
                      </div>
                    )}
                    <FormControl>
                      <Input {...field} placeholder="https://... or upload a file" data-testid="input-brand-logo" />
                    </FormControl>
                    <label className={`shrink-0 ${isUploading ? "opacity-60 pointer-events-none" : "cursor-pointer"}`}>
                      <input type="file" accept="image/*" className="hidden" disabled={isUploading} onChange={handleLogoUpload} data-testid="input-brand-logo-upload" />
                      <Button type="button" variant="outline" size="sm" asChild>
                        <span><Upload className="w-3.5 h-3.5 mr-2" />{isUploading ? "Uploading…" : "Upload"}</span>
                      </Button>
                    </label>
                  </div>
                  {field.value && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-destructive mt-1"
                      onClick={() => field.onChange("")}
                      data-testid="button-remove-logo"
                    >
                      Remove logo
                    </button>
                  )}
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="industry" render={({ field }) => (
                <FormItem>
                  <FormLabel>Industry</FormLabel>
                  <FormControl><Input {...field} data-testid="input-brand-industry" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="space-y-4 bg-card p-6 border border-border rounded-xl">
              <h3 className="font-semibold text-lg tracking-tight">Design System</h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="primaryColor" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Primary Color</FormLabel>
                    <FormControl><Input type="color" {...field} className="h-10 p-1 w-full" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="secondaryColor" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Secondary Color</FormLabel>
                    <FormControl><Input type="color" {...field} className="h-10 p-1 w-full" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="accentColor" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Accent Color</FormLabel>
                    <FormControl><Input type="color" {...field} className="h-10 p-1 w-full" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="backgroundColor" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Background Color</FormLabel>
                    <FormControl><Input type="color" {...field} className="h-10 p-1 w-full" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="textColor" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Text Color</FormLabel>
                    <FormControl><Input type="color" {...field} className="h-10 p-1 w-full" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="fontFamily" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Font Family</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select font" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {field.value && !KNOWN_FONTS.some((f) => f.value === field.value) && (
                          <SelectItem value={field.value}>{field.value}</SelectItem>
                        )}
                        {KNOWN_FONTS.map((f) => (
                          <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </div>
            
            <div className="space-y-4 bg-card p-6 border border-border rounded-xl">
              <h3 className="font-semibold text-lg tracking-tight">AI Generation Context</h3>
              <FormField control={form.control} name="toneOfVoice" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tone of Voice</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. Bold and authoritative" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="guidelines" render={({ field }) => (
                <FormItem>
                  <FormLabel>Brand Guidelines</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={6}
                      placeholder="Voice, key messaging, and do's & don'ts the AI should follow when writing copy and designing creative. Auto-filled when you ingest a guideline PDF in Knowledge."
                      data-testid="input-brand-guidelines"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <Button type="submit" disabled={isSubmitting} className="w-full" data-testid="button-save-brand">
              {isSubmitting ? "Saving..." : "Save Brand"}
            </Button>
          </form>
        </Form>
      </div>

      <div className="relative">
        <div className="sticky top-8 space-y-4">
          <h3 className="text-sm font-mono tracking-widest text-muted-foreground uppercase">Live Preview</h3>
          <div 
            className="w-full aspect-square rounded-xl overflow-hidden border shadow-xl flex flex-col transition-all duration-300 relative"
            style={{ 
              backgroundColor: previewValues.backgroundColor,
              color: previewValues.textColor,
              fontFamily: fontCss(previewValues.fontFamily)
            }}
          >
            <div className="absolute inset-0 opacity-10 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPjxyZWN0IHdpZHRoPSI0IiBoZWlnaHQ9IjQiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')]" />
            <div className="p-8 flex-1 flex flex-col z-10">
              <div className="flex justify-between items-start mb-auto">
                {previewValues.logoUrl ? (
                  <img src={previewValues.logoUrl} alt="Logo" className="h-12 object-contain" />
                ) : (
                  <div className="text-2xl font-bold tracking-tighter" style={{ color: previewValues.primaryColor }}>
                    {previewValues.name || "Brand Name"}
                  </div>
                )}
                <div className="px-3 py-1 rounded-full text-xs font-medium uppercase tracking-wider" style={{ backgroundColor: previewValues.accentColor, color: '#fff' }}>
                  New
                </div>
              </div>
              
              <div className="space-y-4 mt-auto">
                <h2 className="text-4xl font-bold leading-tight" style={{ color: previewValues.primaryColor }}>
                  The Future of Creative.
                </h2>
                <p className="text-lg opacity-80" style={{ color: previewValues.secondaryColor }}>
                  {previewValues.toneOfVoice || "A bold, authoritative approach to creative automation."}
                </p>
                <div className="pt-4">
                  <div 
                    className="inline-flex h-12 px-8 items-center justify-center rounded-lg font-medium transition-transform hover:scale-105"
                    style={{ backgroundColor: previewValues.primaryColor, color: previewValues.backgroundColor }}
                  >
                    Get Started
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
