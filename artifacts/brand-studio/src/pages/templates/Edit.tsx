import { useEffect, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTemplate,
  useUpdateTemplate,
  useAdaptTemplate,
  useListBrands,
  getListTemplatesQueryKey,
  getGetTemplateQueryKey,
  Brand,
  FreeformElement,
  Template,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useMe } from "@/hooks/use-me";
import { Link as WLink } from "wouter";
import { ChevronLeft, Undo2, Layers } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TemplateForm, TemplateFormValues, TEMPLATE_FORM_DEFAULTS } from "@/components/TemplateForm";
import { FreeformEditor } from "@/components/FreeformEditor";
import { LayoutOptions } from "@/components/TemplateRenderer";

const CATEGORIES = ["social", "display", "print", "email", "custom"];

export default function EditTemplate() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: meData, isLoading: isLoadingMe } = useMe();
  const isAdmin = meData?.role === "admin";
  const { data: template, isLoading } = useGetTemplate(id, {
    query: { queryKey: getGetTemplateQueryKey(id), refetchOnMount: "always" },
  });
  const { data: brands } = useListBrands();
  const previewBrand: Brand | undefined = brands?.[0];
  const updateTemplate = useUpdateTemplate();

  useEffect(() => {
    if (!isLoadingMe && !isAdmin) {
      toast({ title: "You don't have permission to edit templates", variant: "destructive" });
      setLocation("/templates");
    }
  }, [isLoadingMe, isAdmin, setLocation, toast]);

  if (isLoadingMe || !isAdmin) {
    return null;
  }

  const onUpdated = () => {
    toast({ title: "Template updated" });
    queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTemplateQueryKey(id) });
    setLocation("/templates");
  };

  const onSubmit = (values: TemplateFormValues) => {
    updateTemplate.mutate(
      {
        id,
        data: {
          name: values.name,
          description: values.description || null,
          category: values.category,
          width: values.width,
          height: values.height,
          config: {
            contentAlignment: values.contentAlignment,
            textAlign: values.textAlign,
            showAccentBar: values.showAccentBar,
            showLogoBar: values.showLogoBar,
            imageStyle: values.imageStyle,
          },
        },
      },
      {
        onSuccess: onUpdated,
        onError: () => toast({ title: "Failed to update template", variant: "destructive" }),
      },
    );
  };

  if (isLoading) {
    return <div className="max-w-5xl mx-auto"><Skeleton className="h-96 rounded-lg" /></div>;
  }

  if (!template) {
    return (
      <div className="max-w-5xl mx-auto text-center py-16">
        <p className="text-muted-foreground">Template not found.</p>
        <WLink href="/templates" className="text-primary text-sm mt-3 inline-block">Back to templates</WLink>
      </div>
    );
  }

  const config = (template.config ?? {}) as LayoutOptions & { kind?: string; elements?: FreeformElement[] };
  const isFreeform = config.kind === "freeform";

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/templates" className="p-2 hover:bg-muted rounded-full transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Edit Template</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1 uppercase tracking-widest">{template.dims}</p>
        </div>
        {isFreeform && <AdaptDialog templateId={id} templateName={template.name} />}
      </div>

      {isFreeform ? (
        <FreeformEditSection
          key={template.updatedAt}
          template={template}
          brand={previewBrand}
          submitting={updateTemplate.isPending}
          onSave={(data) =>
            updateTemplate.mutate(
              { id, data },
              { onSuccess: onUpdated, onError: () => toast({ title: "Failed to update template", variant: "destructive" }) },
            )
          }
        />
      ) : (
        <TemplateForm
          defaultValues={presetDefaults(template, config)}
          onSubmit={onSubmit}
          submitting={updateTemplate.isPending}
          submitLabel="Save Changes"
        />
      )}
    </div>
  );
}

// Formats a master template can be adapted into (Storyteq's Adaptation
// Studio pattern): one designed master → per-format layouts to fine-tune.
const ADAPT_PRESETS = [
  { key: "social_square", label: "Social Square", width: 1080, height: 1080 },
  { key: "story", label: "Story", width: 1080, height: 1920 },
  { key: "mrec", label: "MREC Display", width: 300, height: 250 },
  { key: "banner", label: "Leaderboard", width: 728, height: 90 },
  { key: "print_a4", label: "Print A4", width: 2480, height: 3508 },
] as const;

function AdaptDialog({ templateId, templateName }: { templateId: number; templateName: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const adaptTemplate = useAdaptTemplate();

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const submit = () => {
    const targets = ADAPT_PRESETS.filter((p) => selected.has(p.key)).map((p) => ({
      width: p.width,
      height: p.height,
      name: `${templateName} — ${p.label}`,
    }));
    adaptTemplate.mutate(
      { id: templateId, data: { targets } },
      {
        onSuccess: (created) => {
          setOpen(false);
          toast({
            title: `Created ${created.length} adapted template${created.length === 1 ? "" : "s"}`,
            description: "Each adaptation is a normal template — fine-tune it in the editor.",
          });
          queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
          setLocation("/templates");
        },
        onError: () => toast({ title: "Adaptation failed", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2" data-testid="button-adapt-template">
          <Layers className="w-4 h-4" />
          Adapt to other sizes
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adapt “{templateName}”</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Creates a new template per format from this master: backgrounds re-stretch,
          everything else keeps its size ratio and edge anchoring (a bottom-right logo
          stays bottom-right). Locked elements stay locked.
        </p>
        <div className="flex flex-wrap gap-2">
          {ADAPT_PRESETS.map((p) => (
            <Button
              key={p.key}
              type="button"
              size="sm"
              variant={selected.has(p.key) ? "default" : "outline"}
              onClick={() => toggle(p.key)}
              data-testid={`adapt-target-${p.key}`}
            >
              {p.label} · {p.width}×{p.height}
            </Button>
          ))}
        </div>
        <Button
          onClick={submit}
          disabled={selected.size === 0 || adaptTemplate.isPending}
          data-testid="button-adapt-submit"
        >
          {adaptTemplate.isPending ? "Adapting…" : `Create ${selected.size || ""} adaptation${selected.size === 1 ? "" : "s"}`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function presetDefaults(template: Template, config: LayoutOptions): TemplateFormValues {
  return {
    name: template.name,
    description: template.description ?? "",
    category: template.category,
    width: template.width,
    height: template.height,
    contentAlignment: (config.contentAlignment as TemplateFormValues["contentAlignment"]) ?? TEMPLATE_FORM_DEFAULTS.contentAlignment,
    textAlign: (config.textAlign as TemplateFormValues["textAlign"]) ?? TEMPLATE_FORM_DEFAULTS.textAlign,
    showAccentBar: config.showAccentBar ?? TEMPLATE_FORM_DEFAULTS.showAccentBar,
    showLogoBar: config.showLogoBar ?? TEMPLATE_FORM_DEFAULTS.showLogoBar,
    imageStyle: (config.imageStyle as TemplateFormValues["imageStyle"]) ?? TEMPLATE_FORM_DEFAULTS.imageStyle,
  };
}

interface FreeformSavePayload {
  name: string;
  description: string | null;
  category: string;
  width: number;
  height: number;
  config: { kind: "freeform"; elements: FreeformElement[] };
}

function FreeformEditSection({
  template,
  brand,
  submitting,
  onSave,
}: {
  template: Template;
  brand: Brand | undefined;
  submitting: boolean;
  onSave: (data: FreeformSavePayload) => void;
}) {
  const original = ((template.config as { elements?: FreeformElement[] })?.elements ?? []) as FreeformElement[];
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [category, setCategory] = useState(template.category);
  const [width, setWidth] = useState(template.width);
  const [height, setHeight] = useState(template.height);
  const [elements, setElements] = useState<FreeformElement[]>(original);
  const [editorKey, setEditorKey] = useState(0);
  const { toast } = useToast();

  const handleSave = () => {
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (elements.length === 0) {
      toast({ title: "Add at least one element", variant: "destructive" });
      return;
    }
    onSave({
      name: name.trim(),
      description: description.trim() || null,
      category,
      width,
      height,
      config: { kind: "freeform", elements },
    });
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Template Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ff-name">Template Name</Label>
              <Input id="ff-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-edit-name" />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="select-edit-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ff-width">Width (px)</Label>
              <Input
                id="ff-width"
                type="number"
                value={width}
                onChange={(e) => setWidth(Math.max(1, Number(e.target.value)))}
                data-testid="input-edit-width"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ff-height">Height (px)</Label>
              <Input
                id="ff-height"
                type="number"
                value={height}
                onChange={(e) => setHeight(Math.max(1, Number(e.target.value)))}
                data-testid="input-edit-height"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ff-desc">Description (optional)</Label>
            <Textarea
              id="ff-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              data-testid="input-edit-description"
            />
          </div>
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
              setElements(original);
              setEditorKey((k) => k + 1);
            }}
            disabled={submitting}
            data-testid="button-edit-revert"
          >
            <Undo2 className="w-4 h-4 mr-2" />
            Revert Edits
          </Button>
        </CardHeader>
        <CardContent>
          {brand ? (
            <FreeformEditor
              key={editorKey}
              width={width}
              height={height}
              brand={brand}
              initialElements={original}
              onChange={setElements}
            />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">
              Create a brand first to edit and preview this layout.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <WLink href="/templates">
          <Button type="button" variant="outline" disabled={submitting}>
            Cancel
          </Button>
        </WLink>
        <Button type="button" onClick={handleSave} disabled={submitting} data-testid="button-edit-save">
          {submitting ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
