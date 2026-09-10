import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  useListBrands,
  useListTemplates,
  useDeleteTemplate,
  useUpdateTemplate,
  getListTemplatesQueryKey,
  Template,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Pencil, Trash2, FileUp, Hammer, ArrowUpRight, LayoutTemplate } from "lucide-react";
import { TemplateThumbnail, LayoutOptions } from "@/components/TemplateRenderer";
import { useToast } from "@/hooks/use-toast";
import { useMe } from "@/hooks/use-me";
import { FeedbackButtons } from "@/components/FeedbackButtons";
import { HtmlPreviewDialog } from "@/components/HtmlPreviewDialog";
import { Checkbox } from "@/components/ui/checkbox";

function WipCard({
  template,
  isAdmin,
  selected,
  onToggle,
  onDelete,
  onPromote,
  onApply,
}: {
  template: Template;
  isAdmin: boolean;
  selected: boolean;
  onToggle: (t: Template, on: boolean) => void;
  onDelete: (t: Template) => void;
  onPromote: (t: Template) => void;
  onApply: (t: Template) => void;
}) {
  const { data: brands } = useListBrands();
  const brand = brands?.[0];
  // Measure the preview box so the thumbnail fits inside it entirely.
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(0);
  useLayoutEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    const measure = () => setBoxW(node.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  const PREVIEW_H = 180;
  const PAD = 16;
  // Live preview of the ORIGINAL html banner (animation intact), stored at import.
  const previewHtml = (template.config as { previewHtml?: string })?.previewHtml;

  return (
    <Card className={`border-border/50 overflow-hidden relative ${selected ? "ring-2 ring-primary" : ""}`}>
      {isAdmin && (
        <label
          className="absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-md bg-background/90 px-2 py-1 shadow-sm cursor-pointer"
          title="Select for deletion"
        >
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onToggle(template, v === true)}
            data-testid={`checkbox-select-wip-${template.id}`}
            aria-label={`Select ${template.name}`}
          />
        </label>
      )}
      {/* The artwork itself is the door: clicking it opens the workspace. */}
      <Link href={`/wip/${template.id}`} title="Open and work on this artwork">
        <div
          ref={boxRef}
          className="flex items-center justify-center bg-muted/30 p-4 cursor-pointer hover:bg-muted/60 transition-colors"
          style={{ height: PREVIEW_H }}
        >
        {brand ? (
          <TemplateThumbnail
            maxWidth={Math.max(40, boxW - PAD * 2)}
            maxHeight={PREVIEW_H - PAD * 2}
            templateSize={template.key}
            overrideConfig={{
              width: template.width,
              height: template.height,
              layout: template.config as LayoutOptions,
              kind: template.config?.kind,
              elements: template.config?.elements,
            }}
            brand={brand}
            {...(template.config?.kind === "freeform"
              ? {}
              : { headline: template.name, bodyText: "Sample supporting copy for this format.", callToAction: "Shop Now" })}
          />
        ) : (
          <Hammer className="w-10 h-10 text-muted-foreground" />
        )}
        </div>
      </Link>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate">{template.name}</h3>
            <p className="text-xs text-muted-foreground font-mono">{template.dims}</p>
          </div>
          {((template.config as { rejected?: string[] } | undefined)?.rejected?.length ?? 0) > 0 ? (
            <Badge variant="destructive" className="text-xs shrink-0" title={((template.config as { rejected?: string[] }).rejected ?? []).join(" ")}>Rejected</Badge>
          ) : (
            <Badge variant="secondary" className="text-xs shrink-0">In progress</Badge>
          )}
        </div>
        {((template.config as { rejected?: string[] } | undefined)?.rejected?.length ?? 0) > 0 && (
          <ul className="text-xs text-destructive list-disc pl-4 space-y-0.5">
            {((template.config as { rejected?: string[] }).rejected ?? []).slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
        {template.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{template.description}</p>
        )}
        <div className="pt-1 flex items-center justify-between gap-2">
          <FeedbackButtons subjectType="template" subjectId={template.id} />
          {previewHtml && (
            <HtmlPreviewDialog previewHtml={previewHtml} name={template.name} width={template.width} height={template.height} testId={`button-preview-html-${template.id}`} />
          )}
        </div>
        {isAdmin && (
          <div className="flex gap-2 pt-1">
            <Link href={`/wip/${template.id}`} className="flex-1">
              <Button variant="outline" size="sm" className="w-full" data-testid={`button-edit-wip-${template.id}`}>
                <Pencil className="w-3.5 h-3.5 mr-2" />Open &amp; work on it
              </Button>
            </Link>
            <Button size="sm" onClick={() => onPromote(template)} data-testid={`button-promote-template-${template.id}`}>
              <ArrowUpRight className="w-3.5 h-3.5 mr-1.5" />Make template
            </Button>
            <Button variant="outline" size="sm" onClick={() => onApply(template)} data-testid={`button-apply-template-${template.id}`} title="Fit this artwork into an existing template's layout">
              <LayoutTemplate className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDelete(template)} data-testid={`button-delete-wip-${template.id}`}>
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function WipList() {
  const { data: allTemplates, isLoading } = useListTemplates();
  const wipTemplates = allTemplates?.filter((t) => t.category === "wip") ?? [];
  const { data: meData } = useMe();
  const isAdmin = meData?.role === "admin";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteTemplate = useDeleteTemplate();
  const updateTemplate = useUpdateTemplate();

  const handleDelete = (template: Template) => {
    if (!confirm(`Delete "${template.name}"? This can't be undone.`)) return;
    deleteTemplate.mutate({ id: template.id }, {
      onSuccess: () => {
        toast({ title: "Deleted" });
        queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
      },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    });
  };

  const handlePromote = (template: Template) => {
    updateTemplate.mutate({ id: template.id, data: { category: "custom" } }, {
      onSuccess: async () => {
        toast({ title: "Promoted to template", description: `"${template.name}" now appears under Templates and can be selected in campaign briefs.` });
        queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
        // Sign-off choice: file the imported package's source assets into the
        // brand library (they stay out of it until the user opts in here).
        const srcCount = (template.config as { sourceAssets?: unknown[] })?.sourceAssets?.length ?? 0;
        if (srcCount > 0 && confirm(`Also add its ${srcCount} source files to the brand Library?`)) {
          const res = await fetch(`/api/templates/${template.id}/add-to-library`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
          });
          const data = res.ok ? await res.json() : null;
          toast(data ? { title: `Added ${data.added} files to the Library`, description: data.folder } : { title: "Could not add to Library", variant: "destructive" });
        }
      },
      onError: () => toast({ title: "Failed to promote", variant: "destructive" }),
    });
  };

  const [clearing, setClearing] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const allSelected = wipTemplates.length > 0 && wipTemplates.every((t) => selected.has(t.id));
  const toggleOne = (t: Template, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(t.id); else next.delete(t.id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(wipTemplates.map((t) => t.id)));
  const deleteSelected = async () => {
    const ids = wipTemplates.filter((t) => selected.has(t.id)).map((t) => t.id);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected piece${ids.length === 1 ? "" : "s"}? Right/Wrong feedback you have given is kept. This can't be undone.`)) return;
    setClearing(true);
    try {
      const res = await fetch("/api/templates/delete-many", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
      });
      const data = res.ok ? await res.json() : null;
      if (data) {
        toast({ title: `Deleted ${data.deleted} piece${data.deleted === 1 ? "" : "s"}`, description: data.kept > 0 ? `${data.kept} kept because campaign assets use them.` : undefined });
        setSelected(new Set());
      } else {
        toast({ title: "Could not delete the selection", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
    } finally {
      setClearing(false);
    }
  };
  const clearAll = async () => {
    const n = wipTemplates.length;
    if (!confirm(`Delete all ${n} work-in-progress pieces? Right/Wrong feedback you have given is kept. This can't be undone.`)) return;
    setClearing(true);
    try {
      const res = await fetch("/api/templates/clear-wip", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = res.ok ? await res.json() : null;
      if (data) {
        toast({ title: `Cleared ${data.deleted} piece${data.deleted === 1 ? "" : "s"}`, description: data.kept > 0 ? `${data.kept} kept because campaign assets use them.` : undefined });
      } else {
        toast({ title: "Could not clear work in progress", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
    } finally {
      setClearing(false);
    }
  };

  const applyToTemplate = async (source: Template) => {
    const targets = (allTemplates ?? []).filter(t => t.category !== "wip" && t.category !== "knowledge" && t.id !== source.id);
    if (targets.length === 0) { toast({ title: "No templates to apply to yet", description: "Promote a finished layout to Templates first." }); return; }
    const list = targets.map((t, i) => `${i + 1}. ${t.name} (${t.dims})`).join("\n");
    const pick = prompt(`Apply "${source.name}" artwork to which template?\n\n${list}\n\nEnter a number:`);
    const idx = Number(pick) - 1;
    if (!pick || !Number.isInteger(idx) || idx < 0 || idx >= targets.length) return;
    const res = await fetch(`/api/templates/${targets[idx].id}/apply-artwork`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceTemplateId: source.id }),
    });
    if (res.ok) {
      const created = await res.json();
      toast({ title: "Artwork applied", description: `"${created.name}" created in WIP.` });
      queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
    } else {
      const err = await res.json().catch(() => ({}));
      toast({ title: "Could not apply artwork", description: err.error, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Work in progress</h1>
          <p className="text-muted-foreground mt-1.5">
            Imported artwork you're still developing. Nothing here is selectable in campaign
            briefs — press <span className="font-medium">Make template</span> when a piece is finished.
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {wipTemplates.length > 0 && (
              <Button variant="outline" onClick={toggleAll} disabled={clearing} data-testid="button-select-all-wip">
                {allSelected ? "Deselect all" : `Select all (${wipTemplates.length})`}
              </Button>
            )}
            {selected.size > 0 && (
              <Button variant="destructive" onClick={deleteSelected} disabled={clearing} data-testid="button-delete-selected-wip">
                <Trash2 className="w-4 h-4 mr-2" />{clearing ? "Deleting…" : `Delete selected (${selected.size})`}
              </Button>
            )}
            {wipTemplates.length > 0 && selected.size === 0 && (
              <Button variant="ghost" onClick={clearAll} disabled={clearing} data-testid="button-clear-wip">
                {clearing ? "Clearing…" : "Clear all"}
              </Button>
            )}
            <Link href="/wip/import">
              <Button data-testid="button-import-wip"><FileUp className="w-4 h-4 mr-2" />Import artwork</Button>
            </Link>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-lg" />)}
        </div>
      ) : wipTemplates.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {wipTemplates.map((t) => (
            <WipCard key={t.id} template={t} isAdmin={isAdmin} selected={selected.has(t.id)} onToggle={toggleOne} onDelete={handleDelete} onPromote={handlePromote} onApply={applyToTemplate} />
          ))}
        </div>
      ) : (
        <Card className="border-dashed border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Hammer className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="font-semibold">Nothing in progress</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Imported artwork lands here first so you can develop it without it appearing as a
              selectable template. Finished pieces get promoted to Templates.
            </p>
            {isAdmin && (
              <Link href="/wip/import">
                <Button className="mt-5" data-testid="button-import-wip-empty">
                  <FileUp className="w-4 h-4 mr-2" />Import artwork
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
