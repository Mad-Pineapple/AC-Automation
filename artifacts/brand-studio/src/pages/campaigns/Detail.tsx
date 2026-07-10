import {
  useGetCampaign,
  useListBriefs,
  useUpdateCampaign,
  useDeleteCampaign,
  getGetCampaignQueryKey,
  getListCampaignsQueryKey,
} from "@workspace/api-client-react";
import { useParams, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ChevronLeft, Calendar, Trash2, Briefcase, ArrowRight, Megaphone } from "lucide-react";

function formatDate(d?: string | null): string | null {
  if (!d) return null;
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const campaignId = Number(id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: campaign, isLoading } = useGetCampaign(campaignId, {
    query: { enabled: !!campaignId, queryKey: getGetCampaignQueryKey(campaignId) },
  });
  const { data: allBriefs } = useListBriefs();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();

  const briefs = allBriefs?.filter(b => b.campaignId === campaignId) ?? [];

  const handleStatusChange = (status: string) => {
    updateCampaign.mutate({ id: campaignId, data: { status } }, {
      onSuccess: () => {
        toast({ title: "Status updated" });
        queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      },
      onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
    });
  };

  const handleDelete = () => {
    deleteCampaign.mutate({ id: campaignId }, {
      onSuccess: () => {
        toast({ title: "Campaign deleted", description: "Briefs were detached, not deleted." });
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        setLocation("/campaigns");
      },
      onError: () => toast({ title: "Failed to delete campaign", variant: "destructive" }),
    });
  };

  if (isLoading || !campaign) {
    return <div className="space-y-6 max-w-4xl mx-auto"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 w-full" /></div>;
  }

  const start = formatDate(campaign.startDate);
  const end = formatDate(campaign.endDate);

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Link href="/campaigns" className="p-2 hover:bg-muted rounded-full transition-colors mt-1">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{campaign.name}</h1>
            {campaign.description && <p className="text-muted-foreground text-sm mt-1">{campaign.description}</p>}
            {(start || end) && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono mt-2">
                <Calendar className="w-3.5 h-3.5" />
                {start ?? "-"} → {end ?? "-"}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={campaign.status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-32" data-testid="select-campaign-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="icon" data-testid="button-delete-campaign">
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the campaign. Briefs attached to it will be detached but not deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} data-testid="button-confirm-delete">Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="w-4 h-4" /> Briefs in this campaign
          </CardTitle>
          <Badge variant="outline" className="text-xs">{briefs.length}</Badge>
        </CardHeader>
        <CardContent>
          {briefs.length === 0 ? (
            <div className="text-center py-8">
              <Megaphone className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">No briefs assigned to this campaign yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Assign a campaign when creating a brief.</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {briefs.map(brief => (
                <Link key={brief.id} href={`/briefs/${brief.id}`}>
                  <div className="flex items-center justify-between py-3 px-2 hover:bg-muted/50 rounded-md cursor-pointer group" data-testid={`row-brief-${brief.id}`}>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{brief.campaignName}</span>
                      <Badge variant="secondary" className="text-xs capitalize">{brief.status}</Badge>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
