import { useEffect, useState, type ReactNode } from "react";
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
import { ChevronLeft, Undo2, Layers, ArrowUpRight, RefreshCw } from "lucide-react";
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
import { ExportHtmlDialog } from "@/components/ExportHtmlDialog";
import { LayoutOptions } from "@/components/TemplateRenderer";
import { ExportStaticMenu } from "@/components/ExportStaticMenu";
import { HtmlPreviewDialog } from "@/components/HtmlPreviewDialog";
import { FeedbackButtons, postFeedback } from "@/components/FeedbackButtons";

const CATEGORIES = ["social", "display", "print", "email", "custom"];

export default function EditTemplate() {
  const params = useParams();
  const id = Number(params.id);
  const [location, setLocation] = useLocation();
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
      toast({ title: "You don't have permission to edit artwork", variant: "destructive" });
      setLocation(location.startsWith("/wip") ? "/wip" : "/templates");
    }
  }, [isLoadingMe, isAdmin, setLocation, toast, location]);

  // WIP work stays under /wip. Nothing in the WIP flow links into Templates
  // until Make template sends the piece there.
  const wantBase = template ? (template.category === "wip" ? "/wip" : "/templates") : null;
  useEffect(() => {
    if (!wantBase) return;
    const onWip = location.startsWith("/wip/");
    if ((wantBase === "/wip") !== onWip) setLocation(`${wantBase}/${id}`, { replace: true });
  }, [wantBase, location, id, setLocation]);

  if (isLoadingMe || !isAdmin) {
    return null;
  }

  const onUpdated = () => {
    toast({ title: "Template updated" });
    queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTemplateQueryKey(id) });
    setLocation(template?.category === "wip" ? "/wip" : "/templates");
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
    return <div className="w-full"><Skeleton className="h-96 rounded-lg" /></div>;
  }

  if (!template) {
    return (
      <div className="w-full text-center py-16">
        <p className="text-muted-foreground">Template not found.</p>
        <WLink href={location.startsWith("/wip") ? "/wip" : "/templates"} className="text-primary text-sm mt-3 inline-block">{location.startsWith("/wip") ? "Back to Work in progress" : "Back to templates"}</WLink>
      </div>
    );
  }

  const config = (template.config ?? {}) as LayoutOptions & { kind?: string; elements?: FreeformElement[] };
  const isFreeform = config.kind === "freeform";
  // WIP artwork opens the same workspace but keeps its home base on /wip.
  const isWip = template.category === "wip";
  const backHref = isWip ? "/wip" : "/templates";

  // The original HTML banner, when the piece came in as an HTML5 / GWD package.
  const previewHtml = typeof (config as { previewHtml?: unknown }).previewHtml === "string" ? (config as { previewHtml: string }).previewHtml : null;
  // Lives in the canvas toolbar next to Proportional and Guides.
  const redoButton = template.sourceTemplateId ? (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1.5"
      data-testid="button-redo-artwork"
      title="Rebuild this piece from its master with the current rules and feedback"
      onClick={async () => {
        if (!confirm("Rebuild this piece from its master with the current rules and feedback? Any manual edits on this piece will be replaced.")) return;
        const res = await fetch(`/api/templates/${id}/redo`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          const ref = body?.redo?.reference as { name: string; width: number; height: number; scaled: boolean } | null | undefined;
          const how = body?.redo?.method ? String(body.redo.method).replace(":", " ") : "rebuilt";
          const description = ref
            ? `${ref.scaled ? "Scaled from" : "Rebuilt to match"} the approved "${ref.name}" (${ref.width}×${ref.height}). Review it, then Right or Wrong as usual.`
            : `${how}. No piece in this family is marked Right yet, so the generic rules were used. Correct one size, mark it Right, and Redo will follow it.`;
          toast({ title: ref ? "Artwork redone from the approved piece" : "Artwork redone", description });
          await queryClient.invalidateQueries({ queryKey: getGetTemplateQueryKey(id) });
          await queryClient.refetchQueries({ queryKey: getGetTemplateQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
        } else {
          const err = await res.json().catch(() => ({}));
          toast({ title: `Could not redo the artwork (${res.status})`, description: err.error ?? "The server returned no reason. Refresh the page and try again.", variant: "destructive" });
        }
      }}
    >
      <RefreshCw className="w-4 h-4" />
      Redo artwork
    </Button>
  ) : null;
  const toolbarExtra = (
    <>
      {previewHtml && (
        <HtmlPreviewDialog previewHtml={previewHtml} name={template.name} width={template.width} height={template.height} testId="button-preview-html-editor" />
      )}
      {redoButton}
    </>
  );

  return (
    <div className="space-y-8 w-full">
      <div className="flex items-center gap-4">
        <Link href={backHref} className="p-2 hover:bg-muted rounded-full transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
            {isWip ? "Work on artwork" : "Edit Template"}
          </h1>
          <p className="text-muted-foreground mt-1.5">
            {template.dims}
            {isWip ? " · work in progress — promote it to Templates when it's finished" : ""}
          </p>
        </div>
        <FeedbackButtons subjectType="template" subjectId={id} />
        {isWip && (
          <Button
            className="gap-2"
            data-testid="button-promote-from-editor"
            disabled={updateTemplate.isPending}
            onClick={() =>
              updateTemplate.mutate(
                { id, data: { category: "custom" } },
                {
                  onSuccess: () => {
                    toast({ title: "Promoted to template", description: `"${template.name}" now lives under Templates and can be used in campaign briefs.` });
                    queryClient.invalidateQueries();
                    setLocation("/templates");
                  },
                  onError: () => toast({ title: "Failed to promote", variant: "destructive" }),
                },
              )
            }
          >
            <ArrowUpRight className="w-4 h-4" />
            Make template
          </Button>
        )}
        {isFreeform && (
          <div className="flex items-center gap-2">
            <WLink href={template.sourceTemplateId ? `${backHref}/${template.sourceTemplateId}/compare?focus=${id}` : `${backHref}/${id}/compare`}>
              <Button variant="outline" className="gap-2" data-testid="button-compare-sizes">
                <Layers className="w-4 h-4" />
                Review against original
              </Button>
            </WLink>
            <ExportHtmlDialog templateId={id} templateName={template.name} />
            <AdaptDialog templateId={id} templateName={template.name} base={backHref} />
            <ExportStaticMenu templateId={id} templateName={template.name} />
          </div>
        )}
      </div>

      {isFreeform ? (
        <FreeformEditSection
          key={template.updatedAt}
          template={template}
          brand={previewBrand}
          submitting={updateTemplate.isPending}
          toolbarExtra={toolbarExtra}
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

import { ADAPT_PRESETS, CHECK_SET, CHECK_SET_KEYS } from "@/lib/adaptPresets";
import { SizePicker } from "@/components/SizePicker";
import { PieceGuidelines } from "@/components/PieceGuidelines";

function AdaptDialog({ templateId, templateName, base }: { templateId: number; templateName: string; base: string }) {
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
            title: `Created ${created.length} size${created.length === 1 ? "" : "s"} in Work in progress`,
            description: "Review them against the original, then press Make template on the ones you keep.",
          });
          queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
          setLocation(`${base}/${templateId}/compare`);
        },
        onError: (err) => {
          // The server explains refusals (e.g. flat artwork can only scale to
          // the same shape, and which sizes were blocked) — show that, not a
          // bare failure.
          const detail = (err as { data?: { error?: string } })?.data?.error
            ?? (err instanceof Error && err.message ? err.message : undefined);
          toast({
            title: "Couldn't adapt to those sizes",
            description: detail ?? "Something went wrong on the server. Try again, or pick fewer sizes.",
            variant: "destructive",
            duration: 15000,
          });
        },
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Adapt “{templateName}”</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Creates a new template per format from this master: backgrounds re-stretch,
          everything else keeps its size ratio and edge anchoring (a bottom-right logo
          stays bottom-right). Locked elements stay locked.
        </p>
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 flex flex-wrap items-center gap-3" data-testid="check-set-panel">
          <div className="flex-1 min-w-[16rem]">
            <p className="text-sm font-medium">Start with the check set — 6 sizes</p>
            <p className="text-xs text-muted-foreground">
              {CHECK_SET.map((p) => `${p.width}×${p.height}`).join(" · ")}. One of each shape: tall, square, landscape,
              an HTML banner to check the animation, a thin tall and a thin wide. Fix and approve these first —
              every other size is then built from the approved pieces.
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setSelected(new Set<string>(CHECK_SET_KEYS))} data-testid="button-select-check-set">
            Select the check set
          </Button>
        </div>
        <div className="max-h-[45vh] overflow-y-auto pr-1">
          <SizePicker
            selected={selected}
            onToggle={toggle}
            onSetMany={(keys, on) =>
              setSelected((prev) => {
                const next = new Set(prev);
                for (const k of keys) on ? next.add(k) : next.delete(k);
                return next;
              })
            }
          />
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
  config: { kind: "freeform"; elements: FreeformElement[]; layoutOptions?: unknown[] };
}

function FreeformEditSection({
  template,
  brand,
  submitting,
  toolbarExtra,
  onSave,
}: {
  template: Template;
  brand: Brand | undefined;
  submitting: boolean;
  toolbarExtra?: ReactNode;
  onSave: (data: FreeformSavePayload) => void;
}) {
  const original = ((template.config as { elements?: FreeformElement[] })?.elements ?? []) as FreeformElement[];
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [category, setCategory] = useState(template.category);
  const [width, setWidth] = useState(template.width);
  const [height, setHeight] = useState(template.height);
  const [elements, setElements] = useState<FreeformElement[]>(original);
  const [draft, setDraft] = useState<FreeformElement[]>(original);
  // Element-level reviewer feedback: "this specific element is wrong".
  const { toast: toastFeedback } = useToast();
  const [flagEl, setFlagEl] = useState<FreeformElement | null>(null);
  const [flagNote, setFlagNote] = useState("");
  const [flagBusy, setFlagBusy] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  // Alternative headline placements the layout engine scored for this size.
  type LayoutOption = { label: string; x: number; y: number; w: number; h: number; fontSize: number; align: string; color: string; score: number };
  const layoutOptions = ((template.config as { layoutOptions?: LayoutOption[] })?.layoutOptions ?? []) as LayoutOption[];
  // What the adapt engine did to derive this size, and what to check.
  const adaptMethod = (template.config as { adaptMethod?: string }).adaptMethod ?? null;
  // What needs a designer's eye comes first; guideline reminders carried by
  // older pieces move to the "Guidelines for this piece" panel.
  const notePriority = (n: string) => (n.startsWith("Rejected") ? 0 : n.startsWith("Check:") ? 1 : /^(Review:|.*(dropped|left out|Left out))/.test(n) ? 2 : 3);
  const adaptNotes = (((template.config as { adaptNotes?: string[] }).adaptNotes ?? []) as string[])
    .filter((n) => !n.startsWith("Guideline ("))
    .map((n, i) => ({ n, i }))
    .sort((a, b) => notePriority(a.n) - notePriority(b.n) || a.i - b.i)
    .map((x) => x.n);
  // The headline element the options move: key-visual adapt names it
  // kv_headline, the recomposer rc_headline.
  const HEADLINE_IDS = ["kv_headline", "rc_headline"];
  const applyLayoutOption = (opt: LayoutOption) => {
    const next = elements.map((el) =>
      HEADLINE_IDS.includes(el.id ?? "")
        ? ({ ...el, x: opt.x, y: opt.y, w: opt.w, h: opt.h, fontSize: opt.fontSize, align: opt.align, color: opt.color } as FreeformElement)
        : el,
    );
    setElements(next);
    setDraft(next);
    setEditorKey((k) => k + 1);
  };
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
      config: { kind: "freeform", elements, ...(layoutOptions.length > 0 ? { layoutOptions } : {}) },
    });
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between sticky top-0 z-20 bg-card/95 backdrop-blur rounded-t-xl border-b border-border/40">
          <CardTitle className="text-base">Layout</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setElements(original);
                setDraft(original);
                setEditorKey((k) => k + 1);
              }}
              disabled={submitting}
              data-testid="button-edit-revert"
            >
              <Undo2 className="w-4 h-4 mr-2" />
              Revert
            </Button>
            <WLink href={template.category === "wip" ? "/wip" : "/templates"}>
              <Button type="button" variant="outline" size="sm" disabled={submitting}>
                Cancel
              </Button>
            </WLink>
            <Button type="button" size="sm" onClick={handleSave} disabled={submitting} data-testid="button-edit-save">
              {submitting ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {(adaptMethod || adaptNotes.length > 0) && (
            <div className="mb-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs" data-testid="adapt-notes">
              {adaptMethod && (
                <p className="font-medium">
                  {adaptMethod.startsWith("recomposed:")
                    ? `Rebuilt with the ${adaptMethod.split(":")[1]} recipe`
                    : adaptMethod === "key-visual"
                      ? "Key visual re-cropped and copy re-set"
                      : adaptMethod === "panel"
                        ? "Panel layout rebuilt"
                        : "Scaled from the master"}
                </p>
              )}
              {adaptNotes.length > 0 && (
                <ul className="mt-1 space-y-0.5 list-disc pl-4 text-muted-foreground">
                  {adaptNotes.map((n, i) => (
                    <li key={i} className={n.startsWith("Rejected") ? "text-red-700 font-medium" : n.startsWith("Check:") ? "text-amber-700" : undefined}>{n}</li>
                  ))}
                </ul>
              )}
              <PieceGuidelines templateId={template.id} />
            </div>
          )}
          {layoutOptions.length > 1 && (
            <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="layout-options">
              <span className="text-xs text-muted-foreground mr-1">Layout options:</span>
              {layoutOptions.map((opt) => {
                const current = elements.find((el) => HEADLINE_IDS.includes(el.id ?? ""));
                const active = !!current && Math.abs((current.x ?? 0) - opt.x) < 2 && Math.abs((current.y ?? 0) - opt.y) < 2;
                return (
                  <Button
                    key={opt.label}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => applyLayoutOption(opt)}
                    title={`Engine score ${opt.score}`}
                  >
                    {opt.label}
                  </Button>
                );
              })}
            </div>
          )}
          {brand ? (
            <>
            <FreeformEditor
              key={editorKey}
              width={width}
              height={height}
              brand={brand}
              initialElements={draft}
              onChange={setElements}
              toolbarExtra={toolbarExtra}
              onMarkWrong={(el) => { setFlagEl(el); setFlagNote(""); }}
              onMarkCorrect={async (el) => {
                const label = `${el.type} element ${Math.round(el.w ?? 0)}×${Math.round(el.h ?? 0)} at (${Math.round(el.x ?? 0)},${Math.round(el.y ?? 0)}) in "${template.name}" ${template.width}×${template.height}`;
                const ok = await postFeedback({ subjectType: "template", subjectId: template.id, verdict: "correct", elementId: el.id, elementLabel: label });
                toastFeedback(ok ? { title: "Element marked correct" } : { title: "Sign in to leave feedback", variant: "destructive" });
              }}
            />

            <Dialog open={!!flagEl} onOpenChange={(o) => !o && setFlagEl(null)}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>What's wrong with this element?</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground -mt-2">
                  {flagEl?.type === "image"
                    ? "Image element"
                    : flagEl?.type === "text"
                      ? `Text element${(flagEl as { text?: string })?.text ? ` — "${(flagEl as { text?: string }).text?.slice(0, 40)}"` : ""}`
                      : "Element"}{" "}
                  at {Math.round(flagEl?.x ?? 0)},{Math.round(flagEl?.y ?? 0)} ({Math.round(flagEl?.w ?? 0)}×{Math.round(flagEl?.h ?? 0)}).
                  Be specific — this becomes a rule the studio follows.
                </p>
                <Textarea
                  value={flagNote}
                  onChange={(e) => setFlagNote(e.target.value)}
                  placeholder='e.g. "This button is twice the size it should be"'
                  rows={4}
                  data-testid="element-flag-note"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setFlagEl(null)}>Cancel</Button>
                  <Button
                    variant="destructive"
                    disabled={flagBusy || flagNote.trim().length < 3}
                    title={flagNote.trim().length < 3 ? "Say what is wrong with it first" : undefined}
                    data-testid="element-flag-submit"
                    onClick={async () => {
                      if (!flagEl) return;
                      setFlagBusy(true);
                      const label = `${flagEl.type} element ${Math.round(flagEl.w ?? 0)}×${Math.round(flagEl.h ?? 0)} at (${Math.round(flagEl.x ?? 0)},${Math.round(flagEl.y ?? 0)}) in "${template.name}" ${template.width}×${template.height}`;
                      const ok = await postFeedback({
                        subjectType: "template",
                        subjectId: template.id,
                        verdict: "incorrect",
                        elementId: flagEl.id,
                        elementLabel: label,
                        note: flagNote,
                      });
                      setFlagBusy(false);
                      setFlagEl(null);
                      if (ok) {
                        toastFeedback({ title: "Element marked wrong", description: "Noted — the studio will avoid repeating this." });
                      } else {
                        toastFeedback({ title: "Sign in to leave feedback", variant: "destructive" });
                      }
                    }}
                  >
                    Mark wrong
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            </>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">
              Create a brand first to edit and preview this layout.
            </p>
          )}
        </CardContent>
      </Card>

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

    </div>
  );
}
