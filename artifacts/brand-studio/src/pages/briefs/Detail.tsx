import { useGetBrief, useGenerateBriefAssets, useDuplicateBrief, useDeleteBrief, getGetBriefQueryKey, getListBriefsQueryKey } from "@workspace/api-client-react";
import { useParams, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Zap, Copy, Trash2, CheckCircle, Send, Pencil } from "lucide-react";
import { getTemplateLabel } from "@/components/TemplateRenderer";
import { useEffect, useRef } from "react";

const STATUS_COLORS: Record<string, string> = {
  draft: "secondary",
  generating: "outline",
  pending_approval: "default",
  approved: "default",
  dispatched: "default",
};

export default function BriefDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const briefId = Number(id);

  const { data: brief, isLoading } = useGetBrief(briefId, {
    query: { enabled: !!briefId, queryKey: getGetBriefQueryKey(briefId) },
  });

  const generateAssets = useGenerateBriefAssets();
  const duplicateBrief = useDuplicateBrief();
  const deleteBrief = useDeleteBrief();

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (brief?.status === "generating") {
      pollingRef.current = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: getGetBriefQueryKey(briefId) });
      }, 2500);
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current);
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [brief?.status, briefId, queryClient]);

  useEffect(() => {
    if (brief?.status === "pending_approval") {
      setLocation(`/briefs/${briefId}/approve`);
    }
  }, [brief?.status, briefId, setLocation]);

  const handleGenerate = () => {
    generateAssets.mutate({ id: briefId }, {
      onSuccess: () => {
        toast({ title: "Generation started", description: "AI is creating your assets..." });
        queryClient.invalidateQueries({ queryKey: getGetBriefQueryKey(briefId) });
      },
      onError: () => toast({ title: "Generation failed", variant: "destructive" }),
    });
  };

  const handleDuplicate = () => {
    duplicateBrief.mutate({ id: briefId }, {
      onSuccess: (newBrief) => {
        toast({ title: "Brief duplicated" });
        queryClient.invalidateQueries({ queryKey: getListBriefsQueryKey() });
        setLocation(`/briefs/${newBrief.id}`);
      },
    });
  };

  const handleDelete = () => {
    deleteBrief.mutate({ id: briefId }, {
      onSuccess: () => {
        toast({ title: "Brief deleted" });
        queryClient.invalidateQueries({ queryKey: getListBriefsQueryKey() });
        setLocation("/briefs");
      },
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!brief) return <div className="text-muted-foreground p-8">Brief not found.</div>;

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="flex items-start gap-4">
        <Link href="/briefs" className="p-2 hover:bg-muted rounded-full transition-colors mt-1">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight">{brief.campaignName}</h1>
            <Badge variant={(STATUS_COLORS[brief.status] as any) ?? "secondary"} className="capitalize">
              {brief.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm font-mono mt-1">{brief.brand?.name} · {brief.templateSizes.length} sizes</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {brief.status === "draft" && (
            <Link href={`/briefs/${briefId}/edit`}>
              <Button variant="outline" data-testid="button-edit">
                <Pencil className="w-4 h-4 mr-2" />
                Edit
              </Button>
            </Link>
          )}
          {(brief.status === "draft" || brief.status === "approved" || brief.status === "dispatched") && (
            <Button onClick={handleGenerate} disabled={generateAssets.isPending} data-testid="button-generate">
              <Zap className="w-4 h-4 mr-2" />
              {generateAssets.isPending ? "Starting..." : "Generate Assets"}
            </Button>
          )}
          {brief.status === "pending_approval" && (
            <Link href={`/briefs/${briefId}/approve`}>
              <Button data-testid="button-review">
                <CheckCircle className="w-4 h-4 mr-2" />
                Review Assets
              </Button>
            </Link>
          )}
          {brief.status === "approved" && (
            <Link href={`/briefs/${briefId}/dispatch`}>
              <Button variant="outline" data-testid="button-dispatch">
                <Send className="w-4 h-4 mr-2" />
                Dispatch
              </Button>
            </Link>
          )}
        </div>
      </div>

      {brief.status === "generating" && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <div>
              <p className="font-semibold">AI is generating your assets</p>
              <p className="text-sm text-muted-foreground mt-0.5">This usually takes 20-60 seconds depending on the number of sizes selected.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-border/50">
          <CardHeader><CardTitle className="text-base">Brief Details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {brief.createdByName && (
              <div><span className="text-muted-foreground">Created by: </span>{brief.createdByName}</div>
            )}
            {brief.approvedByName && (
              <div>
                <span className="text-muted-foreground">Approved by: </span>{brief.approvedByName}
                {brief.approvedAt && <span className="text-muted-foreground"> · {new Date(brief.approvedAt).toLocaleString()}</span>}
              </div>
            )}
            {brief.dispatchedByName && (
              <div>
                <span className="text-muted-foreground">Dispatched by: </span>{brief.dispatchedByName}
                {brief.dispatchedAt && <span className="text-muted-foreground"> · {new Date(brief.dispatchedAt).toLocaleString()}</span>}
              </div>
            )}
            {brief.headline && <div><span className="text-muted-foreground">Headline: </span>{brief.headline}</div>}
            {brief.bodyText && <div><span className="text-muted-foreground">Body: </span>{brief.bodyText}</div>}
            {brief.callToAction && <div><span className="text-muted-foreground">CTA: </span>{brief.callToAction}</div>}
            {brief.productImageUrl && <div><span className="text-muted-foreground">Image: </span><a href={brief.productImageUrl} className="text-primary underline truncate">{brief.productImageUrl}</a></div>}
            <div><span className="text-muted-foreground">AI Copy: </span>{brief.useAiCopy ? "Yes" : "No"}</div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader><CardTitle className="text-base">Template Sizes</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {brief.templateSizes.map(size => (
                <Badge key={size} variant="secondary" className="text-xs">{getTemplateLabel(size)}</Badge>
              ))}
            </div>
            {brief.dispatchLog && (
              <p className="text-xs text-muted-foreground mt-4 bg-muted/50 rounded p-2 font-mono border border-border/50">{brief.dispatchLog}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3 pt-4 border-t border-border/50">
        <Button variant="outline" size="sm" onClick={handleDuplicate} disabled={duplicateBrief.isPending} data-testid="button-duplicate">
          <Copy className="w-4 h-4 mr-2" />
          Duplicate
        </Button>
        <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleteBrief.isPending} data-testid="button-delete">
          <Trash2 className="w-4 h-4 mr-2" />
          Delete
        </Button>
      </div>
    </div>
  );
}
