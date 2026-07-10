import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListBriefs, useDuplicateBrief, getListBriefsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Plus, Briefcase, FileImage, ChevronRight, Copy, ChevronLeft, ChevronRight as ChevronRightIcon, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useMe } from "@/hooks/use-me";

const MINE_FILTER_KEY = "briefs.mineOnly";

interface TeamMember {
  id: number;
  clerkId: string;
  name: string | null;
}

const PAGE_SIZE = 10;

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Draft", variant: "secondary" },
  generating: { label: "Generating", variant: "outline" },
  pending_approval: { label: "Pending Approval", variant: "default" },
  approved: { label: "Approved", variant: "default" },
  dispatched: { label: "Dispatched", variant: "default" },
};

export default function BriefList() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createdByFilter, setCreatedByFilter] = useState<string>("all");
  const [mineOnly, setMineOnly] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(MINE_FILTER_KEY) === "true";
  });
  const [, setLocation] = useLocation();
  const { data: allBriefs, isLoading } = useListBriefs();
  const { data: me } = useMe();
  const duplicateBrief = useDuplicateBrief();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleMineToggle = (pressed: boolean) => {
    setMineOnly(pressed);
    setPage(1);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MINE_FILTER_KEY, String(pressed));
    }
  };

  // Full team roster (non-admin endpoint) so the "Created by" filter can list
  // everyone, not just teammates who already authored a campaign. Falls back to
  // creators derived from the loaded briefs when the endpoint is unavailable.
  const { data: teamMembers } = useQuery<TeamMember[]>({
    queryKey: ["team"],
    queryFn: async () => {
      const res = await fetch("/api/team", { credentials: "include" });
      if (!res.ok) throw new Error(`GET /api/team failed: ${res.status}`);
      return res.json() as Promise<TeamMember[]>;
    },
    staleTime: 60_000,
  });

  const creators = (() => {
    const map = new Map<string, string>();
    for (const b of allBriefs ?? []) {
      if (b.createdBy) map.set(b.createdBy, b.createdByName || "Unknown");
    }
    for (const m of teamMembers ?? []) {
      if (m.clerkId && !map.has(m.clerkId)) {
        map.set(m.clerkId, m.name || "Unknown");
      }
    }
    return Array.from(map.entries())
      .map(([clerkId, name]) => ({ clerkId, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  })();

  const filteredBriefs = allBriefs?.filter(b => {
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (mineOnly && (!me || b.createdBy !== me.clerkId)) return false;
    if (createdByFilter !== "all" && b.createdBy !== createdByFilter) return false;
    return true;
  }) ?? [];

  const totalPages = Math.max(1, Math.ceil(filteredBriefs.length / PAGE_SIZE));
  const paginatedBriefs = filteredBriefs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleReopen = (e: React.MouseEvent, briefId: number) => {
    e.preventDefault();
    e.stopPropagation();
    duplicateBrief.mutate({ id: briefId }, {
      onSuccess: (newBrief) => {
        toast({ title: "Brief duplicated - opening copy as draft" });
        queryClient.invalidateQueries({ queryKey: getListBriefsQueryKey() });
        setLocation(`/briefs/${newBrief.id}`);
      },
      onError: () => toast({ title: "Failed to duplicate brief", variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight font-sans">Campaigns</h1>
          <p className="text-muted-foreground mt-2 font-mono text-sm uppercase tracking-widest">All Campaign Briefs</p>
        </div>
        <Link href="/briefs/new">
          <Button data-testid="button-new-brief" className="font-mono uppercase text-xs tracking-wider">
            <Plus className="w-4 h-4 mr-2" />
            New Brief
          </Button>
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-48 h-8 text-xs" data-testid="select-status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="generating">Generating</SelectItem>
            <SelectItem value="pending_approval">Pending Approval</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="dispatched">Dispatched</SelectItem>
          </SelectContent>
        </Select>
        {creators.length > 0 && (
          <Select value={createdByFilter} onValueChange={(v) => { setCreatedByFilter(v); setPage(1); }}>
            <SelectTrigger className="w-48 h-8 text-xs" data-testid="select-created-by-filter">
              <SelectValue placeholder="Created by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Creators</SelectItem>
              {creators.map(c => (
                <SelectItem key={c.clerkId} value={c.clerkId} data-testid={`select-creator-${c.clerkId}`}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Toggle
          variant="outline"
          size="sm"
          pressed={mineOnly}
          onPressedChange={handleMineToggle}
          className="h-8 text-xs font-mono uppercase tracking-wider"
          data-testid="toggle-mine-only"
          aria-label="Show only my campaigns"
        >
          <User className="w-3.5 h-3.5 mr-1.5" />
          My campaigns
        </Toggle>
        {filteredBriefs.length > 0 && (
          <span className="text-xs text-muted-foreground">{filteredBriefs.length} campaign{filteredBriefs.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : paginatedBriefs.length === 0 ? (
        <Card className="border-dashed bg-transparent p-12 text-center">
          <Briefcase className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium">{statusFilter !== "all" || mineOnly || createdByFilter !== "all" ? "No campaigns match this filter" : "No campaigns yet"}</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            {mineOnly ? "You haven't created any campaigns matching this filter." : createdByFilter !== "all" ? "This team member has no campaigns matching this filter." : statusFilter !== "all" ? "Try a different status filter." : "Create your first campaign brief to get started."}
          </p>
          {statusFilter === "all" && !mineOnly && createdByFilter === "all" && (
            <Link href="/briefs/new">
              <Button variant="outline">Create Brief</Button>
            </Link>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {paginatedBriefs.map(brief => {
            const statusConf = STATUS_CONFIG[brief.status] ?? { label: brief.status, variant: "secondary" };
            const nextAction =
              brief.status === "pending_approval" ? `/briefs/${brief.id}/approve` :
              brief.status === "approved" ? `/briefs/${brief.id}/dispatch` :
              `/briefs/${brief.id}`;
            const canReopen = ["approved", "dispatched", "pending_approval"].includes(brief.status);

            return (
              <Link key={brief.id} href={nextAction}>
                <Card className="hover:border-primary transition-all duration-150 cursor-pointer group" data-testid={`card-brief-${brief.id}`}>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: (brief.brand?.primaryColor ?? "#666") + "22" }}>
                        <Briefcase className="w-5 h-5" style={{ color: brief.brand?.primaryColor ?? "#666" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-semibold text-sm truncate">{brief.campaignName}</span>
                          <Badge variant={statusConf.variant} className="text-xs capitalize shrink-0">
                            {statusConf.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                          <span>{brief.brand?.name}</span>
                          <span className="flex items-center gap-1">
                            <FileImage className="w-3 h-3" />
                            {brief.assetCount} assets
                          </span>
                          <span>{brief.templateSizes.length} sizes</span>
                          {brief.createdByName && (
                            <span>by {brief.createdByName}</span>
                          )}
                          {brief.approvedByName && (
                            <span data-testid={`text-approved-by-${brief.id}`}>approved by {brief.approvedByName}</span>
                          )}
                          {brief.dispatchedByName && (
                            <span data-testid={`text-dispatched-by-${brief.id}`}>dispatched by {brief.dispatchedByName}</span>
                          )}
                          <span>{formatDistanceToNow(new Date(brief.updatedAt), { addSuffix: true })}</span>
                        </div>
                        {brief.dispatchLog && (
                          <p className="text-xs text-muted-foreground mt-1 truncate opacity-60">{brief.dispatchLog}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {canReopen && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => handleReopen(e, brief.id)}
                            disabled={duplicateBrief.isPending}
                            className="h-8 px-2.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                            data-testid={`button-reopen-${brief.id}`}
                            title="Duplicate this brief as a new draft"
                          >
                            <Copy className="w-3.5 h-3.5 mr-1" />
                            Duplicate
                          </Button>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <Button
            variant="outline" size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            data-testid="button-page-prev"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button
            variant="outline" size="sm"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            data-testid="button-page-next"
          >
            Next
            <ChevronRightIcon className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
