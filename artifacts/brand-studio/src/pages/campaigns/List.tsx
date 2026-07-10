import { useListCampaigns } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Megaphone, ArrowRight, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";

function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "active") return "default";
  if (status === "archived") return "outline";
  return "secondary";
}

function formatDate(d?: string | null): string | null {
  if (!d) return null;
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function CampaignList() {
  const { data: campaigns, isLoading } = useListCampaigns();

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight font-sans">Campaigns</h1>
          <p className="text-muted-foreground mt-2 font-mono text-sm uppercase tracking-widest">Group Briefs & Shared Schedules</p>
        </div>
        <Link href="/campaigns/new">
          <Button data-testid="button-new-campaign" className="font-mono uppercase text-xs tracking-wider">
            <Plus className="w-4 h-4 mr-2" />
            New Campaign
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-44 w-full rounded-xl" />)}
        </div>
      ) : campaigns?.length === 0 ? (
        <Card className="border-dashed bg-transparent p-12 text-center">
          <Megaphone className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium">No campaigns yet</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            Create a campaign to group related briefs under shared dates and goals.
          </p>
          <Link href="/campaigns/new">
            <Button variant="outline">Create Campaign</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaigns?.map(campaign => {
            const start = formatDate(campaign.startDate);
            const end = formatDate(campaign.endDate);
            return (
              <Link key={campaign.id} href={`/campaigns/${campaign.id}`}>
                <Card className="hover:border-primary transition-colors cursor-pointer group h-full flex flex-col" data-testid={`card-campaign-${campaign.id}`}>
                  <CardHeader className="flex-1">
                    <div className="flex justify-between items-start gap-2">
                      <CardTitle className="text-xl group-hover:text-primary transition-colors">{campaign.name}</CardTitle>
                      <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0 shrink-0 mt-1" />
                    </div>
                    {campaign.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{campaign.description}</p>
                    )}
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={statusVariant(campaign.status)} className="text-xs capitalize">{campaign.status}</Badge>
                      <Badge variant="outline" className="text-xs">{campaign.briefCount ?? 0} brief{(campaign.briefCount ?? 0) !== 1 ? "s" : ""}</Badge>
                    </div>
                    {(start || end) && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                        <Calendar className="w-3.5 h-3.5" />
                        {start ?? "-"} → {end ?? "-"}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
