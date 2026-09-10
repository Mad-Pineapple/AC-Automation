import { useState } from "react";
import { useLocation } from "wouter";
import { useSuggestCampaignIdeas, useListBrands, type CampaignIdea } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Lightbulb, RefreshCw, Loader2, ArrowRight } from "lucide-react";
import { TEMPLATE_SIZE_LABELS } from "@/components/TemplateRenderer";

/** Key read by the New Brief page to prefill the form from a suggested idea. */
export const PENDING_IDEA_KEY = "pendingCampaignIdea";

/**
 * Proactive campaign ideation ("what should we run right now?"). Ideas are
 * grounded in the brand, the NZ season and civic calendar, the imagery the
 * library holds, recent campaigns and live ad performance. One click turns an
 * idea into a pre-filled brief.
 */
export function CampaignIdeasPanel() {
  const { data: brands } = useListBrands();
  const brand = brands?.[0];
  const suggest = useSuggestCampaignIdeas();
  const [ideas, setIdeas] = useState<CampaignIdea[] | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const fetchIdeas = () => {
    if (!brand) return;
    suggest.mutate(
      { data: { brandId: brand.id } },
      {
        onSuccess: (res) => setIdeas(res.ideas),
        onError: () =>
          toast({ title: "Couldn't fetch campaign ideas", description: "Try again in a moment.", variant: "destructive" }),
      },
    );
  };

  const useIdea = (idea: CampaignIdea) => {
    sessionStorage.setItem(PENDING_IDEA_KEY, JSON.stringify(idea));
    setLocation("/briefs/new");
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3 flex-row items-center justify-between gap-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-primary" />
          Campaign ideas
        </CardTitle>
        <Button
          size="sm"
          variant={ideas ? "ghost" : "default"}
          className="gap-1.5"
          disabled={!brand || suggest.isPending}
          onClick={fetchIdeas}
        >
          {suggest.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {suggest.isPending ? "Thinking…" : ideas ? "Refresh" : "Suggest ideas"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!ideas && !suggest.isPending && (
          <p className="text-sm text-muted-foreground">
            What should {brand?.name ?? "your brand"} run right now? Ideas are timed to the season and civic
            calendar, grounded in your library's real imagery and live ad performance.
          </p>
        )}
        {ideas?.length === 0 && (
          <p className="text-sm text-muted-foreground">No ideas came back — try refreshing.</p>
        )}
        {ideas?.map((idea, i) => (
          <div key={i} className="rounded-lg border p-3 space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-sm">{idea.title}</p>
              <Button size="sm" variant="outline" className="gap-1 h-7 text-xs shrink-0" onClick={() => useIdea(idea)}>
                Create brief
                <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
            {idea.keyMessage && <p className="text-xs text-muted-foreground">{idea.keyMessage}</p>}
            {idea.rationale && <p className="text-xs text-muted-foreground/80 italic">{idea.rationale}</p>}
            {idea.sizes.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {idea.sizes.map((s) => (
                  <Badge key={s} variant="secondary" className="text-[10px] h-5 px-1.5">
                    {TEMPLATE_SIZE_LABELS[s] ?? s}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
