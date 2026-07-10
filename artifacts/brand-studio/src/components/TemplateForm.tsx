import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useListBrands, Brand } from "@workspace/api-client-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { TemplateRenderer } from "@/components/TemplateRenderer";

export const templateFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  category: z.string().min(1),
  width: z.coerce.number().int().min(16, "Min 16px").max(8000, "Max 8000px"),
  height: z.coerce.number().int().min(16, "Min 16px").max(8000, "Max 8000px"),
  contentAlignment: z.enum(["top", "center", "bottom"]),
  textAlign: z.enum(["left", "center", "right"]),
  showAccentBar: z.boolean(),
  showLogoBar: z.boolean(),
  imageStyle: z.enum(["side", "background"]),
});

export type TemplateFormValues = z.infer<typeof templateFormSchema>;

export const TEMPLATE_FORM_DEFAULTS: TemplateFormValues = {
  name: "",
  description: "",
  category: "custom",
  width: 1080,
  height: 1080,
  contentAlignment: "center",
  textAlign: "left",
  showAccentBar: true,
  showLogoBar: true,
  imageStyle: "side",
};

const CATEGORIES = ["social", "display", "print", "email", "custom"];

const SAMPLE_IMAGE =
  "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=800&q=60";

export function TemplateForm({
  defaultValues,
  onSubmit,
  submitting,
  submitLabel,
}: {
  defaultValues: TemplateFormValues;
  onSubmit: (values: TemplateFormValues) => void;
  submitting: boolean;
  submitLabel: string;
}) {
  const { data: brands } = useListBrands();
  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues,
  });

  const values = form.watch();
  const previewBrand: Brand | undefined = brands?.[0];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <Card className="border-border/50">
            <CardHeader><CardTitle className="text-base">Format</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Template Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. LinkedIn Feed Ad" data-testid="input-template-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="What is this format used for?" rows={2} data-testid="input-template-description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="category" render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-template-category"><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CATEGORIES.map(c => (
                        <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="width" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Width (px)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} data-testid="input-template-width" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="height" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Height (px)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} data-testid="input-template-height" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader><CardTitle className="text-base">Layout</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="contentAlignment" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Content Position</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-content-alignment"><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="top">Top</SelectItem>
                        <SelectItem value="center">Center</SelectItem>
                        <SelectItem value="bottom">Bottom</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="textAlign" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Text Align</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-text-align"><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="left">Left</SelectItem>
                        <SelectItem value="center">Center</SelectItem>
                        <SelectItem value="right">Right</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="imageStyle" render={({ field }) => (
                <FormItem>
                  <FormLabel>Image Style</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-image-style"><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="side">Side (image beside copy)</SelectItem>
                      <SelectItem value="background">Background (full-bleed)</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />

              <FormField control={form.control} name="showAccentBar" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                  <Label className="text-sm">Accent Bar</Label>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-accent-bar" />
                  </FormControl>
                </FormItem>
              )} />

              <FormField control={form.control} name="showLogoBar" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                  <Label className="text-sm">Logo Bar</Label>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-logo-bar" />
                  </FormControl>
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-end">
            <Link href="/templates">
              <Button type="button" variant="outline">Cancel</Button>
            </Link>
            <Button type="submit" disabled={submitting} data-testid="button-submit-template">
              {submitting ? "Saving..." : submitLabel}
            </Button>
          </div>
        </div>

        <div className="lg:col-span-2">
          <Card className="border-border/50 lg:sticky lg:top-6">
            <CardHeader><CardTitle className="text-base">Live Preview</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center justify-center bg-muted/30 rounded-lg p-4 min-h-[320px] overflow-hidden">
                {previewBrand ? (
                  <TemplateRenderer
                    templateSize="__preview__"
                    overrideConfig={{
                      width: values.width || 1080,
                      height: values.height || 1080,
                      layout: {
                        contentAlignment: values.contentAlignment,
                        textAlign: values.textAlign,
                        showAccentBar: values.showAccentBar,
                        showLogoBar: values.showLogoBar,
                        imageStyle: values.imageStyle,
                      },
                    }}
                    brand={previewBrand}
                    headline="Your Headline Here"
                    bodyText="Supporting copy gives your campaign context and a clear value proposition."
                    callToAction="Learn More"
                    imageUrl={SAMPLE_IMAGE}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Create a brand to see a live preview.</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-3 font-mono text-center">
                {values.width || 0}×{values.height || 0}px
              </p>
            </CardContent>
          </Card>
        </div>
      </form>
    </Form>
  );
}
