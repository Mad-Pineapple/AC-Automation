import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Clock, Briefcase, FileImage, Send, ArrowUpRight, FileUp, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useListBrands, useListTemplates, useListBriefs } from "@workspace/api-client-react";
import { CampaignIdeasPanel } from "@/components/CampaignIdeas";
import { useUser } from "@clerk/react";
import { TemplateThumbnail } from "@/components/TemplateRenderer";
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
  const { data: templates } = useListTemplates();
  const { data: briefs } = useListBriefs();
  const pendingBriefs = (briefs ?? []).filter((b) => b.status === "pending_approval");
  const { user } = useUser();
  const firstName = user?.firstName ?? null;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const recentTemplates = (templates ?? [])
    .filter((t) => (t.config as { kind?: string })?.kind === "freeform")
    // The API lists templates newest first.
    .slice(0, 6);
  // Tile accents derive from the active brand's palette (white-label) with a
  // neutral success green for "dispatched" (status colour, not brand colour).
  const metrics = [
    {
      title: "Campaigns",
      value: stats?.totalBriefs,
      icon: Briefcase,
      tint: theme.secondaryHex,
    },
    {
      title: "Awaiting review",
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
      title: "Assets",
      value: stats?.totalAssets,
      icon: FileImage,
      tint: theme.primaryHex,
    },
  ];

  return (
    <div className="space-y-8 w-full">
      {/* Hero band — Ocean gradient with the kotahitanga waves as texture
          (guidelines: patterns as subtle background rows, ≤30% opacity). */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#11263d] via-[#16324e] to-[#183a68] text-white p-7 md:p-10 shadow-lg">
        <svg
          aria-hidden
          viewBox="0 0 1200 160"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 md:h-32 w-full"
        >
          <path d="M0 60 Q75 20 150 60 T300 60 T450 60 T600 60 T750 60 T900 60 T1050 60 T1200 60 V160 H0 Z" fill="#0073bd" opacity="0.18" />
          <path d="M0 95 Q75 55 150 95 T300 95 T450 95 T600 95 T750 95 T900 95 T1050 95 T1200 95 V160 H0 Z" fill="#00a7e5" opacity="0.12" />
          <path d="M0 130 Q75 95 150 130 T300 130 T450 130 T600 130 T750 130 T900 130 T1050 130 T1200 130 V160 H0 Z" fill="#ffffff" opacity="0.08" />
        </svg>
        <div className="relative">
          <span className="inline-block text-[11px] font-bold uppercase tracking-[0.2em] text-white/70 bg-white/10 rounded-full px-3 py-1">
            {today}
          </span>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mt-3">
            {firstName ? `Kia ora, ${firstName}` : "Kia ora"}
          </h1>
          <p className="text-white/70 mt-2 max-w-md">
            Here's what's happening across your creative today.
          </p>

          {/* Primary path first: the app's main job is starting a campaign. */}
          <div className="flex flex-wrap items-center gap-3 mt-6">
            <Link href="/briefs/new">
              <Button size="lg" className="rounded-full bg-white text-[#11263d] hover:bg-white/90 font-semibold gap-2 shadow-md">
                <PlusCircle className="w-4 h-4" />
                Start a new campaign
              </Button>
            </Link>
            <Link href="/wip/import">
              <Button
                size="lg"
                variant="ghost"
                className="rounded-full text-white border border-white/25 hover:bg-white/10 hover:text-white gap-2"
              >
                <FileUp className="w-4 h-4" />
                Import artwork
              </Button>
            </Link>
          </div>

          {/* At-a-glance numbers, inline — no competing card row below. */}
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 mt-7 pt-6 border-t border-white/15">
            {metrics.map((m) => (
              <div key={m.title} className="flex items-center gap-2.5">
                <m.icon className={cn("w-4 h-4", m.alert ? "text-[#ff8a9b]" : "text-white/50")} />
                {statsLoading ? (
                  <Skeleton className="h-6 w-8 bg-white/20" />
                ) : (
                  <span className={cn("text-2xl font-extrabold tracking-tight", m.alert && "text-[#ff8a9b]")}>
                    {m.value ?? 0}
                  </span>
                )}
                <span className="text-xs text-white/60">{m.title}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Needs your attention — the single clearest "what do I do next". */}
      {pendingBriefs.length > 0 && (
        <div className="bg-card rounded-3xl border border-border/60 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-6 md:px-8 pt-6 pb-4">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center">
                <Clock className="w-4 h-4" />
              </span>
              <h2 className="text-xl font-bold text-foreground">Needs your review</h2>
            </div>
            <Link href="/briefs">
              <Button variant="ghost" size="sm" className="rounded-full text-primary hover:bg-primary/10 font-medium">
                All campaigns
              </Button>
            </Link>
          </div>
          <div className="divide-y divide-border/60">
            {pendingBriefs.slice(0, 4).map((b) => (
              <Link key={b.id} href={`/briefs/${b.id}/approve`}>
                <div className="group flex items-center gap-4 px-6 md:px-8 py-4 hover:bg-muted/40 transition-colors cursor-pointer">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate text-foreground">{b.campaignName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {b.assetCount} asset{b.assetCount === 1 ? "" : "s"} waiting · {b.brand?.name ?? ""}
                    </p>
                  </div>
                  <Button size="sm" className="rounded-full gap-1.5 shrink-0">
                    Review
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent templates */}
      {recentTemplates.length > 0 && brands?.[0] && (
        <div className="bg-card rounded-3xl p-6 md:p-8 border border-border/60 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-bold text-foreground">Recent templates</h2>
            <Link href="/templates">
              <Button variant="ghost" size="sm" className="rounded-full text-primary hover:bg-primary/10 font-medium">
                All templates
              </Button>
            </Link>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-1">
            {recentTemplates.map((t) => (
              <Link key={t.id} href={`/templates/${t.id}`}>
                <div className="group shrink-0 w-44 cursor-pointer" data-testid={`recent-template-${t.id}`}>
                  <div className="h-28 rounded-xl border border-border/60 bg-muted/30 flex items-center justify-center overflow-hidden group-hover:border-primary/40 transition-colors">
                    <TemplateThumbnail
                      templateSize={t.key}
                      maxWidth={168}
                      maxHeight={104}
                      overrideConfig={{
                        width: t.width,
                        height: t.height,
                        kind: (t.config as { kind?: string })?.kind,
                        elements: (t.config as { elements?: unknown[] })?.elements as never,
                      }}
                      brand={brands[0]}
                    />
                  </div>
                  <p className="text-xs font-medium mt-2 truncate text-foreground">{t.name}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">{t.width}×{t.height}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <CampaignIdeasPanel />

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent activity */}
        <div className="lg:col-span-2 bg-card rounded-3xl p-6 md:p-8 border border-border/60 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-foreground">Recent activity</h2>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 bg-muted rounded-full p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMine(false)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    !viewMine ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  data-testid="button-view-all"
                >
                  Everyone
                </button>
                <button
                  type="button"
                  onClick={() => setViewMine(true)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    viewMine ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  data-testid="button-view-mine"
                >
                  Just me
                </button>
              </div>
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
