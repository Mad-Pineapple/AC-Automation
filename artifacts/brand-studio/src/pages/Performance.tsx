import { useGetPerformanceStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { BarChart3, MousePointerClick, Eye, Tag, TrendingUp } from "lucide-react";
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

export default function Performance() {
  const { data: stats, isLoading } = useGetPerformanceStats();

  if (isLoading || !stats) {
    return (
      <div className="space-y-8 max-w-6xl mx-auto">
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
    <div className="space-y-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-4xl font-bold tracking-tight font-sans">Performance</h1>
        <p className="text-muted-foreground mt-2 font-mono text-sm uppercase tracking-widest">Ad Tracking & Engagement</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Impressions" value={stats.impressions.toLocaleString()} icon={Eye} />
        <StatCard label="Clicks" value={stats.clicks.toLocaleString()} icon={MousePointerClick} />
        <StatCard label="CTR" value={ctrPct} icon={TrendingUp} />
        <StatCard label="Active Tags" value={stats.totalTags.toLocaleString()} icon={Tag} />
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
