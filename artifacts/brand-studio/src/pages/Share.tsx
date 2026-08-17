import { useParams } from "wouter";
import { useGetSharedBrief, getGetSharedBriefQueryKey } from "@workspace/api-client-react";
import { getTemplateLabel, getTemplateConfig } from "@/components/TemplateRenderer";
import { Loader2 } from "lucide-react";

/**
 * Public stakeholder view of one brief's creative, reached via a share-link
 * token. Renders outside the authenticated app shell: no nav, no actions,
 * read-only. Token possession is the only authorization.
 */
export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, error } = useGetSharedBrief(token ?? "", {
    query: { enabled: !!token, queryKey: getGetSharedBriefQueryKey(token ?? ""), retry: false },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="text-center max-w-sm">
          <h1 className="text-xl font-semibold mb-2">This link isn't available</h1>
          <p className="text-sm text-muted-foreground">
            The share link may have expired or been revoked. Ask the person who sent it for a new one.
          </p>
        </div>
      </div>
    );
  }

  const withArt = data.assets.filter((a) => a.imageUrl);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center gap-4">
          {data.brandLogoUrl && (
            <img src={data.brandLogoUrl} alt="" className="h-10 w-10 object-contain rounded" />
          )}
          <div>
            <h1 className="text-xl font-bold tracking-tight" data-testid="share-campaign-name">
              {data.campaignName}
            </h1>
            <p className="text-xs text-muted-foreground">
              {data.brandName ?? "Shared creative"} · {data.assets.length} asset
              {data.assets.length === 1 ? "" : "s"} · view only
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {withArt.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-16">
            No previewable assets in this brief yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
            {withArt.map((a) => (
              <figure key={a.id} className="rounded-xl border border-border overflow-hidden bg-card" data-testid={`share-asset-${a.id}`}>
                {/* SVG artwork has no intrinsic size, so give the frame the
                    template's real aspect ratio or the image collapses. */}
                <img
                  src={a.imageUrl ?? undefined}
                  alt={a.headline ?? ""}
                  className="w-full object-contain bg-white"
                  style={{
                    aspectRatio:
                      a.templateSize === "html_banner"
                        ? "728 / 90"
                        : `${getTemplateConfig(a.templateSize).width} / ${getTemplateConfig(a.templateSize).height}`,
                  }}
                  loading="lazy"
                />
                <figcaption className="px-3 py-2 text-xs text-muted-foreground flex items-center justify-between gap-2">
                  <span className="truncate">
                    {getTemplateLabel(a.templateSize)}
                    {a.variantLabel ? ` · ${a.variantLabel}` : ""}
                  </span>
                  {a.status === "approved" && <span className="text-emerald-600 font-medium">Approved</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        {data.expiresAt && (
          <p className="text-[11px] text-muted-foreground text-center mt-10">
            This link expires {new Date(data.expiresAt).toLocaleDateString()}.
          </p>
        )}
      </main>
    </div>
  );
}
