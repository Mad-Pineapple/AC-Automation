import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPerformanceStats,
  useGetMetaPerformance,
  useSyncMetaPerformance,
  getGetMetaPerformanceQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useMe } from "@/hooks/use-me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { BarChart3, MousePointerClick, Eye, Tag, TrendingUp, Users, Wallet, RefreshCw, Loader2, Plug } from "lucide-react";
import { getTemplateLabel } from "@/components/TemplateRenderer";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest">{label}</p>
            <p className="text-3xl font-bold mt-2">{value}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const fmtMoney = (n: number, currency: string | null) =>
  new Intl.NumberFormat("en-NZ", { style: "currency", currency: currency || "NZD", maximumFractionDigits: 2 }).format(n);

/** Meta Ads results for studio creative — dormant until the ad account is connected. */
function MetaSection() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useGetMetaPerformance({ days });
  const sync = useSyncMetaPerformance();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";

  const runSync = async () => {
    try {
      const r = await sync.mutateAsync();
      await qc.invalidateQueries({ queryKey: getGetMetaPerformanceQueryKey() });
      toast({
        title: r.ok ? "Meta results updated" : "Meta sync failed",
        description: r.ok ? `${r.upserted} ad-days refreshed from the last ${r.days} days.` : r.errors.join("; "),
        variant: r.ok ? undefined : "destructive",
      });
    } catch (e) {
      toast({ title: "Meta sync failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  if (isLoading || !data) return <Skeleton className="h-40 w-full rounded-xl" />;

  if (!data.configured) {
    return (
      <Card className="border-border/50" data-testid="meta-not-connected">
        <CardHeader><CardTitle className="text-base">Meta Ads results</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Plug className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="text-sm space-y-1.5">
              <p className="font-medium">Not connected</p>
              <p className="text-muted-foreground">
                Once the council's Meta ad account is linked, impressions, reach, link clicks and spend for every ad
                built here appear in this section and refresh nightly. Ads are matched back to their studio creative
                by the file name from the Meta tracking sheet.
              </p>
              <p className="text-muted-foreground">
                To connect: an admin of the council Business Manager creates a system user with <em>ads_read</em> on
                the ad account and sets <code className="font-mono text-xs">META_ACCESS_TOKEN</code> and{" "}
                <code className="font-mono text-xs">META_AD_ACCOUNT_ID</code> on the deployment.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const t = data.totals;
  const hasData = t.impressions > 0;
  return (
    <div className="space-y-4" data-testid="meta-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Meta Ads results</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data.lastSyncedAt ? `Last updated ${new Date(data.lastSyncedAt).toLocaleString("en-NZ")}` : "Not synced yet"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)} data-testid={`meta-days-${d}`}>
              {d}d
            </Button>
          ))}
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={runSync} disabled={sync.isPending} data-testid="meta-sync">
              {sync.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
              Sync now
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <StatCard label="Impressions" value={t.impressions.toLocaleString()} icon={Eye} />
        <StatCard label="Reach" value={t.reach.toLocaleString()} icon={Users} />
        <StatCard label="Link clicks" value={t.linkClicks.toLocaleString()} icon={MousePointerClick} />
        <StatCard label="CTR" value={`${(t.ctr * 100).toFixed(2)}%`} icon={TrendingUp} />
        <StatCard label="Spend" value={fmtMoney(t.spend, data.currency)} icon={Wallet} />
        <StatCard label="CPM" value={fmtMoney(t.cpm, data.currency)} icon={BarChart3} />
      </div>

      <Card className="border-border/50">
        <CardHeader><CardTitle className="text-base">Impressions & link clicks (last {data.days} days)</CardTitle></CardHeader>
        <CardContent>
          {data.timeseries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No Meta results in this window yet.</p>
          ) : (
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <LineChart data={data.timeseries} margin={{ top: 8, right: 16, bottom: 8, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "0.5rem", fontSize: "0.8rem" }} />
                  <Line yAxisId="left" type="monotone" dataKey="impressions" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Impressions" />
                  <Line yAxisId="right" type="monotone" dataKey="linkClicks" stroke="#22c55e" strokeWidth={2} dot={false} name="Link clicks" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader><CardTitle className="text-base">Ads</CardTitle></CardHeader>
        <CardContent>
          {data.ads.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{hasData ? "No per-ad rows." : "No ads ran in this window."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground font-mono uppercase tracking-wider border-b border-border/50">
                    <th className="py-2 pr-4 font-medium">Ad</th>
                    <th className="py-2 pr-4 font-medium">Meta campaign</th>
                    <th className="py-2 pr-4 font-medium">Studio creative</th>
                    <th className="py-2 pr-4 font-medium text-right">Impressions</th>
                    <th className="py-2 pr-4 font-medium text-right">Link clicks</th>
                    <th className="py-2 pr-4 font-medium text-right">CTR</th>
                    <th className="py-2 font-medium text-right">Spend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {data.ads.map((row) => (
                    <tr key={row.adId} data-testid={`row-meta-ad-${row.adId}`}>
                      <td className="py-2.5 pr-4 font-mono text-xs">{row.adName}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{row.campaignName ?? "-"}</td>
                      <td className="py-2.5 pr-4">
                        {row.templateId ? (
                          <a href={`/templates/${row.templateId}`} className="text-primary hover:underline">{row.templateName}</a>
                        ) : row.briefId ? (
                          <a href={`/briefs/${row.briefId}`} className="text-primary hover:underline">{row.briefCampaignName}</a>
                        ) : (
                          <span className="text-muted-foreground">Unmatched</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{row.impressions.toLocaleString()}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{row.linkClicks.toLocaleString()}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{(row.ctr * 100).toFixed(2)}%</td>
                      <td className="py-2.5 text-right tabular-nums">{fmtMoney(row.spend, data.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Performance() {
  const { data: stats, isLoading } = useGetPerformanceStats();

  if (isLoading || !stats) {
    return (
      <div className="space-y-8 w-full">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  const ctrPct = `${(stats.ctr * 100).toFixed(2)}%`;
  const hasData = stats.impressions > 0 || stats.clicks > 0;

  return (
    <div className="space-y-8 w-full">
      <div>
        <h1 className="text-4xl font-bold tracking-tight font-sans">Performance</h1>
        <p className="text-muted-foreground mt-1.5">Ad Tracking & Engagement</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Impressions" value={stats.impressions.toLocaleString()} icon={Eye} />
        <StatCard label="Clicks" value={stats.clicks.toLocaleString()} icon={MousePointerClick} />
        <StatCard label="CTR" value={ctrPct} icon={TrendingUp} />
        <StatCard label="Active Tags" value={stats.totalTags.toLocaleString()} icon={Tag} />
      </div>

      <MetaSection />

      <div>
        <h2 className="text-xl font-bold tracking-tight">Hosted ad tags</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Impressions and clicks recorded by the studio's own tracking beacons on display ads it serves.</p>
      </div>

      <Card className="border-border/50">
        <CardHeader><CardTitle className="text-base">Impressions & Clicks (last 14 days)</CardTitle></CardHeader>
        <CardContent>
          {stats.timeseries.length === 0 ? (
            <div className="text-center py-16">
              <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">No tracking events recorded yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Generate an ad tag from an approved asset and embed it to start collecting data.</p>
            </div>
          ) : (
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <LineChart data={stats.timeseries} margin={{ top: 8, right: 16, bottom: 8, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "0.5rem",
                      fontSize: "0.8rem",
                    }}
                  />
                  <Line type="monotone" dataKey="impressions" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Impressions" />
                  <Line type="monotone" dataKey="clicks" stroke="#22c55e" strokeWidth={2} dot={false} name="Clicks" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader><CardTitle className="text-base">Top Performing Assets</CardTitle></CardHeader>
        <CardContent>
          {stats.topAssets.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {hasData ? "No per-asset data available." : "No tracked assets yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground font-mono uppercase tracking-wider border-b border-border/50">
                    <th className="py-2 pr-4 font-medium">Asset</th>
                    <th className="py-2 pr-4 font-medium">Campaign</th>
                    <th className="py-2 pr-4 font-medium text-right">Impressions</th>
                    <th className="py-2 pr-4 font-medium text-right">Clicks</th>
                    <th className="py-2 font-medium text-right">CTR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {stats.topAssets.map(row => (
                    <tr key={row.assetId} data-testid={`row-asset-${row.assetId}`}>
                      <td className="py-2.5 pr-4">
                        <Badge variant="secondary" className="text-xs font-normal">
                          {row.templateSize ? getTemplateLabel(row.templateSize) : `Asset #${row.assetId}`}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{row.campaignName ?? "-"}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{row.impressions.toLocaleString()}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{row.clicks.toLocaleString()}</td>
                      <td className="py-2.5 text-right tabular-nums">{((row.ctr ?? 0) * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
