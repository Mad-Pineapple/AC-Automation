import { Link } from "wouter";
import {
  useListTemplates,
  useDeleteTemplate,
  getListTemplatesQueryKey,
  useListBrands,
  Template,
  Brand,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Trash2, ImagePlus, Wand2, ImageIcon, BookOpen, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMe } from "@/hooks/use-me";

function KnowledgeCard({ template, isAdmin, onDelete }: { template: Template; isAdmin: boolean; onDelete: (t: Template) => void }) {
  return (
    <Card className="border-border/50 overflow-hidden">
      <div className="flex items-center justify-center bg-muted/30 overflow-hidden" style={{ height: 200 }}>
        {template.sourceImageUrl ? (
          <img
            src={template.sourceImageUrl}
            alt={template.name}
            className="max-h-full max-w-full object-contain"
            data-testid={`img-knowledge-${template.id}`}
          />
        ) : (
          <ImageIcon className="w-10 h-10 text-muted-foreground" />
        )}
      </div>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate">{template.name}</h3>
            <p className="text-xs text-muted-foreground font-mono">{template.dims}</p>
          </div>
          <Badge variant="secondary" className="text-xs shrink-0 gap-1">
            <Sparkles className="w-3 h-3" />
            Learned
          </Badge>
        </div>
        {template.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{template.description}</p>
        )}
        <div className="flex gap-2 pt-1">
          <Link href={`/briefs/new?template=${template.key}`} className="flex-1">
            <Button size="sm" className="w-full" data-testid={`button-use-creative-${template.id}`}>
              <Wand2 className="w-3.5 h-3.5 mr-2" />
              Use this creative
            </Button>
          </Link>
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={() => onDelete(template)} data-testid={`button-delete-knowledge-${template.id}`}>
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function GuidelineCard({ brand }: { brand: Brand }) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-7 h-7 rounded-md border border-border flex-shrink-0"
              style={{ backgroundColor: brand.primaryColor }}
            />
            <h3 className="font-semibold text-sm truncate">{brand.name}</h3>
          </div>
          <Badge variant="secondary" className="text-xs shrink-0 gap-1">
            <BookOpen className="w-3 h-3" />
            Guidelines
          </Badge>
        </div>
        {brand.guidelines && (
          <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
            {brand.guidelines}
          </p>
        )}
        <Link href={`/brands/${brand.id}`}>
          <Button size="sm" variant="outline" className="w-full" data-testid={`button-view-brand-${brand.id}`}>
            View brand
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export default function KnowledgeList() {
  const { data: templates, isLoading } = useListTemplates();
  const { data: brands, isLoading: brandsLoading } = useListBrands();
  const { data: meData } = useMe();
  const isAdmin = meData?.role === "admin";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteTemplate = useDeleteTemplate();

  const learned = (templates ?? []).filter(t => t.category === "knowledge");
  const branded = (brands ?? []).filter(b => !!b.guidelines && b.guidelines.trim().length > 0);

  const handleDelete = (template: Template) => {
    if (!confirm(`Forget creative "${template.name}"? Existing assets using it will keep their saved copy.`)) return;
    deleteTemplate.mutate({ id: template.id }, {
      onSuccess: () => {
        toast({ title: "Creative forgotten" });
        queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
      },
      onError: () => toast({ title: "Failed to delete creative", variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Knowledge</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1 uppercase tracking-widest">Brand guidelines &amp; learned creatives</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Link href="/knowledge/guidelines">
              <Button variant="outline" data-testid="button-add-guidelines"><BookOpen className="w-4 h-4 mr-2" />Add brand guidelines</Button>
            </Link>
            <Link href="/knowledge/learn">
              <Button data-testid="button-learn-artwork"><ImagePlus className="w-4 h-4 mr-2" />Learn new artwork</Button>
            </Link>
          </div>
        )}
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-mono tracking-widest text-muted-foreground uppercase flex items-center gap-2">
          <BookOpen className="w-4 h-4" /> Brand guidelines
        </h2>
        {brandsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}
          </div>
        ) : branded.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {branded.map(b => <GuidelineCard key={b.id} brand={b} />)}
          </div>
        ) : (
          <Card className="border-dashed border-border/50">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="w-10 h-10 text-muted-foreground mb-3" />
              <h3 className="font-semibold text-sm">No brand guidelines yet</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Upload a guideline PDF to fill in a brand's colors, font and tone, and to steer
                future AI copy and creative.
              </p>
              {isAdmin && (
                <Link href="/knowledge/guidelines" className="mt-4">
                  <Button data-testid="button-add-guidelines-empty"><BookOpen className="w-4 h-4 mr-2" />Add brand guidelines</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-mono tracking-widest text-muted-foreground uppercase flex items-center gap-2">
          <Sparkles className="w-4 h-4" /> Learned creatives
        </h2>
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-80 rounded-lg" />)}
          </div>
        ) : learned.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {learned.map(t => (
              <KnowledgeCard key={t.id} template={t} isAdmin={isAdmin} onDelete={handleDelete} />
            ))}
          </div>
        ) : (
          <Card className="border-dashed border-border/50">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Sparkles className="w-10 h-10 text-muted-foreground mb-3" />
              <h3 className="font-semibold text-sm">No learned creatives yet</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Upload a finished creative and the studio will learn its layout, so you can reuse it in future briefs with
                fresh copy and imagery.
              </p>
              {isAdmin && (
                <Link href="/knowledge/learn" className="mt-4">
                  <Button data-testid="button-learn-artwork-empty"><ImagePlus className="w-4 h-4 mr-2" />Learn new artwork</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
