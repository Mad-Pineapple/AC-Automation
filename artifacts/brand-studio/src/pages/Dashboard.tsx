import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Clock, Briefcase, FileImage, Send, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useListBrands } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";

type DashboardStats = {
  totalBriefs: number;
  pendingApproval: number;
  dispatched: number;
  totalAssets: number;
  totalBrands: number;
  briefsByStatus: { status: string; count: number }[];
};

type ActivityEntry = {
  id: number;
  type: string;
  briefId: number;
  briefName: string;
  brandName: string;
  timestamp: string;
};

function useDashboardStats(mine: boolean) {
  return useQuery<DashboardStats>({
    queryKey: ["stats/dashboard", mine],
    queryFn: async () => {
      const url = mine ? "/api/stats/dashboard?mine=true" : "/api/stats/dashboard";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
    staleTime: 10_000,
  });
}

function useRecentActivity(mine: boolean) {
  return useQuery<ActivityEntry[]>({
    queryKey: ["stats/recent-activity", mine],
    queryFn: async () => {
      const url = mine
        ? "/api/stats/recent-activity?limit=10&mine=true"
        : "/api/stats/recent-activity?limit=10";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch activity");
      return res.json();
    },
    staleTime: 10_000,
  });
}

export default function Dashboard() {
  const [viewMine, setViewMine] = useState(false);

  const theme = useTheme();
  const { data: stats, isLoading: statsLoading } = useDashboardStats(viewMine);
  const { data: activity, isLoading: activityLoading } = useRecentActivity(viewMine);
  const { data: brands } = useListBrands();

  // Tile accents derive from the active brand's palette (white-label) with a
  // neutral success green for "dispatched" (status colour, not brand colour).
  const metrics = [
    {
      title: "Total Briefs",
      value: stats?.totalBriefs,
      icon: Briefcase,
      tint: theme.secondaryHex,
    },
    {
      title: "Pending Approval",
      value: stats?.pendingApproval,
      icon: Clock,
      tint: theme.accentHex,
      alert: !!stats?.pendingApproval && stats.pendingApproval > 0,
    },
    {
      title: "Dispatched",
      value: stats?.dispatched,
      icon: Send,
      tint: "#5b9c33",
    },
    {
      title: "Total Assets",
      value: stats?.totalAssets,
      icon: FileImage,
      tint: theme.primaryHex,
    },
  ];

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1.5">
            Here's what's happening across your brands today.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-full p-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewMine(false)}
            className={cn(
              "rounded-full",
              !viewMine ? "bg-card shadow-sm text-foreground" : "text-muted-foreground",
            )}
            data-testid="button-view-all"
          >
            All activity
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewMine(true)}
            className={cn(
              "rounded-full",
              viewMine ? "bg-card shadow-sm text-foreground" : "text-muted-foreground",
            )}
            data-testid="button-view-mine"
          >
            My activity
          </Button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {metrics.map((m) => (
          <div
            key={m.title}
            className={cn(
              "bg-card rounded-3xl p-6 border shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200",
              m.alert ? "border-destructive/40" : "border-border/60",
            )}
            data-testid={`stat-${m.title.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <div
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center mb-4",
                m.alert && "bg-destructive/10 text-destructive",
              )}
              style={
                m.alert
                  ? undefined
                  : { backgroundColor: `color-mix(in srgb, ${m.tint} 12%, white)`, color: m.tint }
              }
            >
              <m.icon className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">{m.title}</h3>
            {statsLoading ? (
              <Skeleton className="h-9 w-16" />
            ) : (
              <span
                className={cn(
                  "text-3xl font-bold tracking-tight",
                  m.alert ? "text-destructive" : "text-foreground",
                )}
              >
                {m.value ?? 0}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent activity */}
        <div className="lg:col-span-2 bg-card rounded-3xl p-6 md:p-8 border border-border/60 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-foreground">
              {viewMine ? "My Recent Activity" : "Recent Activity"}
            </h2>
            <Link href="/briefs">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full text-primary hover:bg-primary/10 font-medium"
                data-testid="link-view-all-activity"
              >
                View all
              </Button>
            </Link>
          </div>

          {activityLoading ? (
            <div className="space-y-5">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="w-11 h-11 rounded-2xl shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : activity?.length ? (
            <div className="space-y-5">
              {activity.map((entry, i) => (
                <div key={entry.id} className="flex items-start gap-4">
                  <div
                    className={cn(
                      "w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-sm shrink-0 shadow-sm",
                      activityColor(entry.type),
                    )}
                  >
                    {(entry.brandName?.[0] ?? "?").toUpperCase()}
                  </div>
                  <div
                    className={cn(
                      "flex-1 pb-5 border-b border-border/60",
                      i === activity.length - 1 && "border-0 pb-0",
                    )}
                  >
                    <p className="text-sm text-foreground leading-relaxed">
                      <span className="font-semibold">{entry.brandName}</span>{" "}
                      {getActivityText(entry.type)}{" "}
                      <Link
                        href={`/briefs/${entry.briefId}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        {entry.briefName}
                      </Link>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {new Date(entry.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Clock className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <p>{viewMine ? "You have no recent activity" : "No recent activity"}</p>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Briefs by status */}
          <div className="bg-card rounded-3xl p-6 md:p-8 border border-border/60 shadow-sm">
            <h2 className="text-xl font-bold text-foreground mb-6">Briefs by Status</h2>
            {viewMine && (
              <p className="text-xs text-muted-foreground -mt-4 mb-6">Your briefs only</p>
            )}
            {statsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : stats?.briefsByStatus?.length ? (
              <div className="space-y-4">
                {stats.briefsByStatus.map((s) => (
                  <div key={s.status} className="flex items-center justify-between group">
                    <div className="flex items-center gap-3">
                      <span className={cn("w-3 h-3 rounded-full", statusColor(s.status))} />
                      <span className="text-sm font-medium text-muted-foreground capitalize group-hover:text-foreground transition-colors">
                        {s.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <span className="font-semibold text-sm bg-muted px-3 py-1 rounded-full">
                      {s.count}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No briefs yet</p>
            )}
          </div>

          {/* Active brands */}
          <div className="rounded-3xl p-6 md:p-8 shadow-md text-white relative overflow-hidden bg-gradient-to-br from-[#11263d] to-[#0073bd]">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />
            <h2 className="text-lg font-semibold text-white/90 mb-1">Active Brands</h2>
            <div className="text-5xl font-bold mb-5" data-testid="stat-total-brands">
              {statsLoading ? "—" : stats?.totalBrands ?? 0}
            </div>
            {brands?.length ? (
              <div className="flex -space-x-3 mb-6">
                {brands.slice(0, 4).map((b) => (
                  <div
                    key={b.id}
                    className="w-10 h-10 rounded-full border-2 border-white/80 bg-white flex items-center justify-center overflow-hidden shadow-sm"
                    title={b.name}
                  >
                    {b.logoUrl ? (
                      <img
                        src={b.logoUrl}
                        alt={b.name}
                        className="w-full h-full object-contain p-1"
                      />
                    ) : (
                      <span className="text-[#11263d] text-xs font-bold">
                        {b.name[0]?.toUpperCase()}
                      </span>
                    )}
                  </div>
                ))}
                {brands.length > 4 && (
                  <div className="w-10 h-10 rounded-full border-2 border-white/80 bg-white/20 flex items-center justify-center text-xs font-semibold">
                    +{brands.length - 4}
                  </div>
                )}
              </div>
            ) : null}
            <Link href="/brands">
              <Button
                className="w-full bg-white text-[#11263d] hover:bg-white/90 rounded-full font-semibold border-0 h-11"
                data-testid="button-manage-brands"
              >
                Manage brands
                <ArrowUpRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function activityColor(type: string) {
  switch (type) {
    case "approved":
      return "bg-[#5b9c33] text-white";
    case "dispatched":
      return "bg-[#ffe104] text-[#11263d]";
    case "generated":
      return "bg-[#0073bd] text-white";
    case "generating":
      return "bg-[#0073bd]/70 text-white";
    default:
      return "bg-[#11263d] text-white";
  }
}

function statusColor(status: string) {
  const s = status.toLowerCase();
  if (s.includes("draft")) return "bg-slate-300";
  if (s.includes("review") || s.includes("pending")) return "bg-amber-400";
  if (s.includes("approved")) return "bg-[#5b9c33]";
  if (s.includes("dispatched")) return "bg-[#0073bd]";
  return "bg-slate-300";
}

function getActivityText(type: string) {
  switch (type) {
    case "dispatched":
      return "dispatched assets for";
    case "approved":
      return "approved brief";
    case "generated":
      return "generated assets for";
    case "generating":
      return "generating assets for";
    default:
      return "created brief";
  }
}
