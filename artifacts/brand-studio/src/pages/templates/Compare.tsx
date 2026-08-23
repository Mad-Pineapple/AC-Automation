import { useParams, Link } from "wouter";
import { useGetTemplate, useListTemplates, useListBrands, getGetTemplateQueryKey, Template } from "@workspace/api-client-react";
import { ChevronLeft, Pencil } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TemplateThumbnail, LayoutOptions } from "@/components/TemplateRenderer";
import { ExportStaticMenu } from "@/components/ExportStaticMenu";

/** Side-by-side review of a master and every size adapted from it — each
 * artwork shown complete at a comparable scale, with the layout engine's
 * chosen placement labelled, so the set can be audited at a glance. */
export default function CompareTemplates() {
  const params = useParams();
  const id = Number(params.id);
  const { data: master, isLoading } = useGetTemplate(id, { query: { queryKey: getGetTemplateQueryKey(id) } });
  const { data: all } = useListTemplates();
  const { data: brands } = useListBrands();
  const brand = brands?.[0];

  if (isLoading || !master) {
    return <div className="max-w-6xl mx-auto"><Skeleton className="h-96 rounded-lg" /></div>;
  }

  const family: Template[] = [
    master,
    ...(all ?? []).filter((t) => t.id !== master.id && (t.description ?? "").startsWith(`Adapted from "${master.name}"`)),
  ].sort((a, b) => (a.id === master.id ? -1 : b.id === master.id ? 1 : a.width * a.height - b.width * b.height));

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href={`/templates/${master.id}`} className="p-2 hover:bg-muted rounded-full transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Compare sizes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {master.name} · {family.length - 1} adapted size{family.length === 2 ? "" : "s"} · every artwork shown complete
          </p>
        </div>
        <ExportStaticMenu templateId={master.id} templateName={master.name} familyIds={family.map((t) => t.id)} />
      </div>

      {family.length === 1 && (
        <p className="text-sm text-muted-foreground">No adapted sizes yet — use “Adapt to other sizes” on the master.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {family.map((t) => {
          const cfg = t.config as { kind?: string; elements?: any[]; layoutOptions?: { label: string; x: number; y: number; score: number }[] };
          const headline = cfg.elements?.find((e) => e.id === "kv_headline");
          const chosen = headline && cfg.layoutOptions
            ? cfg.layoutOptions.find((o) => Math.abs(o.x - headline.x) < 2 && Math.abs(o.y - headline.y) < 2)
            : undefined;
          const isMaster = t.id === master.id;
          const tall = t.height > t.width * 1.3;
          return (
            <Card key={t.id} className="border-border/50 overflow-hidden" data-testid={`compare-card-${t.id}`}>
              <div className="flex items-center justify-center bg-muted/30 p-4" style={{ height: tall ? 460 : 320 }}>
                {brand && (
                  <TemplateThumbnail
                    templateSize={t.key}
                    maxWidth={520}
                    maxHeight={(tall ? 460 : 320) - 32}
                    overrideConfig={{
                      width: t.width,
                      height: t.height,
                      layout: t.config as LayoutOptions,
                      kind: cfg.kind,
                      elements: cfg.elements,
                    }}
                    brand={brand}
                  />
                )}
              </div>
              <div className="p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{isMaster ? "Master" : t.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{t.width}×{t.height}</p>
                  {!isMaster && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Layout: {chosen ? chosen.label : headline ? "custom" : "—"}
                      {cfg.layoutOptions && cfg.layoutOptions.length > 1 ? ` · ${cfg.layoutOptions.length - 1} alternative${cfg.layoutOptions.length === 2 ? "" : "s"}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isMaster && <Badge variant="secondary">Master</Badge>}
                  <Link href={`/templates/${t.id}`}>
                    <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5">
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
