import { Link } from "wouter";
import { useListBrands, useListTemplates, useDeleteTemplate, getListTemplatesQueryKey, Template, useListBrandAssets, getListBrandAssetsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, LayoutTemplate, FileUp, FileText, Folder } from "lucide-react";
import { isTemplateFolder } from "@/lib/templateFolders";
import { TemplateThumbnail, LayoutOptions } from "@/components/TemplateRenderer";
import { useToast } from "@/hooks/use-toast";
import { useMe } from "@/hooks/use-me";

function TemplateCard({ template, isAdmin, onDelete }: { template: Template; isAdmin: boolean; onDelete: (t: Template) => void }) {
  const { data: brands } = useListBrands();
  const brand = brands?.[0];

  return (
    <Card className="border-border/50 overflow-hidden">
      <div className="flex items-center justify-center bg-muted/30 p-4" style={{ height: 180 }}>
        {brand ? (
          <TemplateThumbnail
            templateSize={template.key}
            overrideConfig={{
              width: template.width,
              height: template.height,
              layout: template.config as LayoutOptions,
              kind: template.config?.kind,
              elements: template.config?.elements,
            }}
            brand={brand}
            headline={template.name}
            bodyText="Sample supporting copy for this format."
            callToAction="Shop Now"
          />
        ) : (
          <LayoutTemplate className="w-10 h-10 text-muted-foreground" />
        )}
      </div>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate">{template.name}</h3>
            <p className="text-xs text-muted-foreground font-mono">{template.dims}</p>
          </div>
          <Badge variant="secondary" className="text-xs capitalize shrink-0">{template.category}</Badge>
        </div>
        {template.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{template.description}</p>
        )}
        {isAdmin && (
          <div className="flex gap-2 pt-1">
            <Link href={`/templates/${template.id}`} className="flex-1">
              <Button variant="outline" size="sm" className="w-full" data-testid={`button-edit-template-${template.id}`}>
                <Pencil className="w-3.5 h-3.5 mr-2" />Edit
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => onDelete(template)} data-testid={`button-delete-template-${template.id}`}>
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Brand-asset folders named "*template*" (imported from the brand portal —
// signage source files, video format guides, …) are shown here rather than in
// the brand Library tab.
function BrandTemplateFiles() {
  const { data: brands } = useListBrands();
  const brand = brands?.[0];
  const { data: assets } = useListBrandAssets(brand?.id ?? 0, {
    query: { queryKey: getListBrandAssetsQueryKey(brand?.id ?? 0), enabled: !!brand },
  });
  const templateAssets = (assets ?? []).filter((a) => isTemplateFolder(a.folder));
  if (templateAssets.length === 0) return null;

  const folders = Array.from(new Set(templateAssets.map((a) => a.folder as string))).sort(
    (a, b) => a.localeCompare(b),
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Brand template files</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Downloadable source files and format guides from the {brand?.name} brand library.
        </p>
      </div>
      {folders.map((folder) => (
        <div key={folder} className="space-y-3">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">{folder}</h3>
            <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
              {templateAssets.filter((a) => a.folder === folder).length}
            </Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {templateAssets
              .filter((a) => a.folder === folder)
              .map((asset) => {
                const isImage = (asset.contentType ?? "").startsWith("image/");
                const ext = asset.name.split(".").pop()?.toUpperCase();
                return (
                  <a
                    key={asset.id}
                    href={asset.url}
                    target="_blank"
                    rel="noreferrer"
                    title={`Open ${asset.name}`}
                  >
                    <Card className="overflow-hidden hover:border-primary/40 transition-colors">
                      <div className="aspect-square bg-muted/40 flex flex-col items-center justify-center gap-2 p-2">
                        {isImage ? (
                          <img
                            src={asset.url}
                            alt={asset.name}
                            loading="lazy"
                            className="max-h-full max-w-full object-contain"
                          />
                        ) : (
                          <>
                            <FileText className="w-10 h-10 text-muted-foreground" />
                            <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                              {ext}
                            </Badge>
                          </>
                        )}
                      </div>
                      <div className="p-2">
                        <p className="text-xs font-medium truncate" title={asset.name}>
                          {asset.name}
                        </p>
                      </div>
                    </Card>
                  </a>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TemplateList() {
  const { data: allTemplates, isLoading } = useListTemplates();
  const templates = allTemplates?.filter(t => t.category !== "knowledge");
  const { data: meData } = useMe();
  const isAdmin = meData?.role === "admin";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteTemplate = useDeleteTemplate();

  const handleDelete = (template: Template) => {
    if (!confirm(`Delete template "${template.name}"? Existing assets using it will keep their saved copy.`)) return;
    deleteTemplate.mutate({ id: template.id }, {
      onSuccess: () => {
        toast({ title: "Template deleted" });
        queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
      },
      onError: () => toast({ title: "Failed to delete template", variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Templates</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1 uppercase tracking-widest">Custom Creative Formats</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Link href="/templates/import">
              <Button variant="outline" data-testid="button-import-pdf"><FileUp className="w-4 h-4 mr-2" />Import PDF</Button>
            </Link>
            <Link href="/templates/new">
              <Button data-testid="button-new-template"><Plus className="w-4 h-4 mr-2" />New Template</Button>
            </Link>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-lg" />)}
        </div>
      ) : templates && templates.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {templates.map(t => (
            <TemplateCard key={t.id} template={t} isAdmin={isAdmin} onDelete={handleDelete} />
          ))}
        </div>
      ) : (
        <Card className="border-dashed border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <LayoutTemplate className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="font-semibold">No custom templates yet</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Create reusable creative formats with custom dimensions and layouts to use across your campaign briefs.
            </p>
            {isAdmin && (
              <div className="flex gap-2 mt-5">
                <Link href="/templates/import">
                  <Button variant="outline" data-testid="button-import-pdf-empty"><FileUp className="w-4 h-4 mr-2" />Import PDF</Button>
                </Link>
                <Link href="/templates/new">
                  <Button data-testid="button-new-template-empty"><Plus className="w-4 h-4 mr-2" />New Template</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <BrandTemplateFiles />
    </div>
  );
}
