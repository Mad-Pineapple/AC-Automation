import { useState } from "react";
import { useGetBrief, useListAssets, useDispatchBrief, getGetBriefQueryKey, getListAssetsQueryKey, getListBriefsQueryKey } from "@workspace/api-client-react";
import { useParams, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronLeft, Download, Mail, Share2, Check, Loader2, Clock, CalendarClock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Facebook, Instagram, Linkedin } from "lucide-react";
import { TemplateThumbnail, getTemplateLabel, getTemplateConfig } from "@/components/TemplateRenderer";
import { captureAssetAsPng, captureAssetAsJpg, captureAnimatedAssetAsGif, captureHtmlBannerAsPng } from "@/lib/gifExport";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export default function DispatchScreen() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const briefId = Number(id);

  const [methods, setMethods] = useState<string[]>(["download"]);
  const [exportFormat, setExportFormat] = useState<"png" | "jpg" | "pdf">("png");
  const [emailRecipients, setEmailRecipients] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [dispatched, setDispatched] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [scheduledConfirm, setScheduledConfirm] = useState<string | null>(null);

  const { data: brief } = useGetBrief(briefId, {
    query: { enabled: !!briefId, queryKey: getGetBriefQueryKey(briefId) },
  });
  const { data: assets } = useListAssets({ briefId }, {
    query: { enabled: !!briefId, queryKey: getListAssetsQueryKey({ briefId }) },
  });

  // Compliance-failed assets are blocked from dispatch server-side; mirror that
  // here so the client-generated PDF/ZIP/email exports never package off-brand art.
  const shippableAssets = assets?.filter(a => a.status !== "rejected" && a.complianceStatus !== "failed");
  const rejectedCount = assets?.filter(a => a.status === "rejected").length ?? 0;
  const blockedCount = assets?.filter(a => a.status !== "rejected" && a.complianceStatus === "failed").length ?? 0;

  const dispatchBrief = useDispatchBrief();

  const toggleMethod = (m: string) => {
    setMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  };

  const handleDispatch = () => {
    const isScheduling = scheduleEnabled && !!scheduledAt;
    if (scheduleEnabled && !scheduledAt) {
      toast({ title: "Pick a date and time to schedule", variant: "destructive" });
      return;
    }
    dispatchBrief.mutate({
      id: briefId,
      data: {
        methods,
        emailRecipients: emailRecipients || null,
        emailSubject: emailSubject || null,
        emailMessage: emailMessage || null,
        socialPlatforms: [],
        scheduledAt: isScheduling ? new Date(scheduledAt).toISOString() : null,
      }
    }, {
      onSuccess: async () => {
        queryClient.invalidateQueries({ queryKey: getGetBriefQueryKey(briefId) });
        queryClient.invalidateQueries({ queryKey: getListBriefsQueryKey() });
        if (isScheduling) {
          setScheduledConfirm(new Date(scheduledAt).toLocaleString());
          toast({ title: "Dispatch scheduled", description: `Will run at ${new Date(scheduledAt).toLocaleString()}` });
          return;
        }
        toast({ title: "Assets dispatched successfully" });
        setDispatched(true);
        if (methods.includes("download")) {
          await handleExport();
        }
      },
      onError: () => toast({ title: "Dispatch failed", variant: "destructive" }),
    });
  };

  const handleExport = async () => {
    if (exportFormat === "pdf") {
      await handleDownloadPdf();
    } else {
      await handleDownloadZip();
    }
  };

  const handleDownloadPdf = async () => {
    if (!brief?.brand || !shippableAssets?.length) return;
    setExporting(true);
    try {
      const { jsPDF } = await import("jspdf");
      const stills = shippableAssets.filter(a => !a.isAnimated);
      if (!stills.length) {
        toast({ title: "No still assets to export as PDF", description: "Animated assets can only be exported via ZIP.", variant: "destructive" });
        return;
      }

      let doc: import("jspdf").jsPDF | null = null;
      let pagesAdded = 0;
      let skipped = 0;
      for (const asset of stills) {
        const blob = asset.templateSize === "html_banner"
          ? await captureHtmlBannerAsPng(asset.htmlContent ?? "")
          : await captureAssetAsPng(asset, brief.brand);
        if (!blob) { skipped++; continue; }
        const dataUrl = await blobToDataUrl(blob);
        const { width, height } = await imageSize(dataUrl);
        const orientation = width >= height ? "landscape" : "portrait";
        if (!doc) {
          doc = new jsPDF({ orientation, unit: "px", format: [width, height] });
        } else {
          doc.addPage([width, height], orientation);
        }
        doc.addImage(dataUrl, "PNG", 0, 0, width, height);
        pagesAdded++;
      }

      if (!doc) {
        toast({ title: "PDF export failed - no assets rendered", variant: "destructive" });
        return;
      }
      doc.save(`${brief.campaignName.replace(/[^a-zA-Z0-9]/g, "-")}-assets.pdf`);
      toast({
        title: `PDF downloaded - ${pagesAdded} page${pagesAdded !== 1 ? "s" : ""}`,
        description: skipped > 0 ? `${skipped} asset${skipped !== 1 ? "s" : ""} could not be rendered and were skipped.` : undefined,
      });
    } catch (err) {
      toast({ title: "PDF export failed - check browser console", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!brief?.brand || !shippableAssets?.length) return;
    setExporting(true);
    try {
      const jszip = await import("jszip");
      const JSZip = jszip.default;
      const zip = new JSZip();

      const ext = exportFormat === "jpg" ? "jpg" : "png";
      zip.file(
        "README.txt",
        `Campaign: ${brief.campaignName}\nBrand: ${brief.brand.name}\nAssets: ${shippableAssets.length} templates\nFormat: ${ext.toUpperCase()} (animated_social → HTML, html_banner → HTML5 ad + static PNG fallback)\nGenerated: ${new Date().toISOString()}\n\nHTML5 ads carry standard clickTag wiring and an ad.size meta tag — upload the .html to your ad server as-is.\n\nFiles:\n${shippableAssets.map(a => `  ${a.templateSize}.${a.isAnimated && a.htmlContent ? "html" : a.isAnimated ? "gif" : a.templateSize === "html_banner" ? "html + _static.png" : ext}`).join("\n")}`
      );

      const assetFolder = zip.folder("assets");
      for (const asset of shippableAssets) {
        if (asset.isAnimated && asset.htmlContent) {
          // Animated banners are self-contained animated HTML; ship the .html so
          // the motion is preserved (a flat GIF/PNG would lose it).
          if (assetFolder) {
            assetFolder.file(`${asset.templateSize}.html`, asset.htmlContent);
          }
        } else if (asset.isAnimated) {
          const gifBlob = await captureAnimatedAssetAsGif(asset, brief.brand);
          if (gifBlob && assetFolder) {
            assetFolder.file(`${asset.templateSize}.gif`, gifBlob);
          }
        } else if (asset.templateSize === "html_banner") {
          // Ship the real HTML5 creative (clickTag + ad.size intact) the way ad
          // servers expect it, plus a static PNG fallback — mirroring how agency
          // HTML5 display ads are dispatched.
          if (asset.htmlContent && assetFolder) {
            assetFolder.file(`${asset.templateSize}.html`, asset.htmlContent);
          }
          const blob = await captureHtmlBannerAsPng(asset.htmlContent ?? "");
          if (blob && assetFolder) {
            assetFolder.file(`${asset.templateSize}_static.png`, blob);
          }
        } else if (exportFormat === "jpg") {
          const blob = await captureAssetAsJpg(asset, brief.brand);
          if (blob && assetFolder) {
            assetFolder.file(`${asset.templateSize}.jpg`, blob);
          }
        } else {
          const blob = await captureAssetAsPng(asset, brief.brand);
          if (blob && assetFolder) {
            assetFolder.file(`${asset.templateSize}.png`, blob);
          }
        }
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${brief.campaignName.replace(/[^a-zA-Z0-9]/g, "-")}-assets.zip`;
      a.click();
      URL.revokeObjectURL(url);
      const stillCount = shippableAssets.filter(a => !a.isAnimated).length;
      const htmlAnimCount = shippableAssets.filter(a => a.isAnimated && a.htmlContent).length;
      const gifAnimCount = shippableAssets.filter(a => a.isAnimated && !a.htmlContent).length;
      toast({
        title: `ZIP downloaded - ${stillCount} ${ext.toUpperCase()}`
          + (htmlAnimCount ? ` + ${htmlAnimCount} HTML` : "")
          + (gifAnimCount ? ` + ${gifAnimCount} GIF` : ""),
      });
    } catch (err) {
      toast({ title: "Download failed - check browser console", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  if (!brief) {
    return <div className="space-y-6 max-w-4xl mx-auto"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="flex items-start gap-4">
        <Link href={`/briefs/${briefId}/approve`} className="p-2 hover:bg-muted rounded-full transition-colors mt-1">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dispatch Assets</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1">
            {brief.campaignName} · {shippableAssets?.length ?? 0} asset{(shippableAssets?.length ?? 0) !== 1 ? "s" : ""} to dispatch
            {rejectedCount > 0 && <> · {rejectedCount} rejected excluded</>}
            {blockedCount > 0 && <> · {blockedCount} blocked for compliance</>}
            {brief.createdByName && <> · by {brief.createdByName}</>}
            {brief.approvedByName && <> · approved by {brief.approvedByName}{brief.approvedAt && <> on {new Date(brief.approvedAt).toLocaleString()}</>}</>}
            {brief.dispatchedByName && <> · dispatched by {brief.dispatchedByName}{brief.dispatchedAt && <> on {new Date(brief.dispatchedAt).toLocaleString()}</>}</>}
          </p>
        </div>
      </div>

      {dispatched && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-5 flex items-center gap-3">
            <Check className="w-5 h-5 text-primary" />
            <div>
              <p className="font-semibold text-sm">Assets dispatched successfully</p>
              <p className="text-xs text-muted-foreground mt-0.5">{brief.dispatchLog}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {scheduledConfirm && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-5 flex items-center gap-3">
            <CalendarClock className="w-5 h-5 text-primary" />
            <div>
              <p className="font-semibold text-sm">Dispatch scheduled</p>
              <p className="text-xs text-muted-foreground mt-0.5">This brief will be dispatched automatically at {scheduledConfirm}.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {rejectedCount > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 text-sm">
            <span className="font-semibold">{rejectedCount} rejected asset{rejectedCount !== 1 ? "s" : ""}</span> will not be packaged or dispatched. Only the {shippableAssets?.length ?? 0} asset{(shippableAssets?.length ?? 0) !== 1 ? "s" : ""} below will go out.
          </CardContent>
        </Card>
      )}

      {blockedCount > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 text-sm">
            <span className="font-semibold">{blockedCount} asset{blockedCount !== 1 ? "s" : ""} blocked for brand compliance</span> won't be packaged or dispatched. Regenerate {blockedCount !== 1 ? "them" : "it"} on the approval screen to produce on-brand versions.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {shippableAssets?.map(asset => brief.brand && (
          <div key={asset.id} className="rounded-lg overflow-hidden border border-border/50 bg-card p-3">
            <p className="text-xs text-muted-foreground mb-2 font-mono">{getTemplateLabel(asset.templateSize)}</p>
            <div className="flex items-center justify-center bg-muted/30 rounded overflow-hidden" style={{ height: 120 }}>
              {asset.isAnimated && asset.htmlContent ? (
                <div style={{ width: 120, height: 120, overflow: "hidden" }} className="relative pointer-events-none">
                  <iframe
                    srcDoc={asset.htmlContent}
                    sandbox="allow-scripts"
                    style={{
                      border: "none",
                      width: getTemplateConfig(asset.templateSize).width,
                      height: getTemplateConfig(asset.templateSize).height,
                      transformOrigin: "top left",
                      transform: `scale(${120 / getTemplateConfig(asset.templateSize).width})`,
                      pointerEvents: "none",
                    }}
                    title={`${getTemplateLabel(asset.templateSize)} preview`}
                    data-testid={`dispatch-thumbnail-html-${asset.id}`}
                  />
                </div>
              ) : (
                <TemplateThumbnail
                  templateSize={asset.templateSize}
                  brand={brief.brand}
                  headline={asset.headline}
                  bodyText={asset.bodyText}
                  callToAction={asset.callToAction}
                  imageUrl={asset.imageUrl}
                  isAnimated={asset.isAnimated}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-border/50">
          <CardHeader><CardTitle className="text-base">Dispatch Methods</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${methods.includes("download") ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"}`}>
              <Checkbox checked={methods.includes("download")} onCheckedChange={() => toggleMethod("download")} data-testid="checkbox-download" />
              <Download className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Download ZIP</p>
                <p className="text-xs text-muted-foreground">Export assets in a ZIP (animated → GIF)</p>
                {methods.includes("download") && (
                  <div className="flex items-center gap-2 mt-1" onClick={e => e.stopPropagation()}>
                    <span className="text-xs text-muted-foreground">Format:</span>
                    <button
                      type="button"
                      onClick={() => setExportFormat("png")}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${exportFormat === "png" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"}`}
                    >PNG</button>
                    <button
                      type="button"
                      onClick={() => setExportFormat("jpg")}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${exportFormat === "jpg" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"}`}
                    >JPG</button>
                    <button
                      type="button"
                      onClick={() => setExportFormat("pdf")}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${exportFormat === "pdf" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"}`}
                    >PDF</button>
                  </div>
                )}
              </div>
            </label>
            <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${methods.includes("email") ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"}`}>
              <Checkbox checked={methods.includes("email")} onCheckedChange={() => toggleMethod("email")} data-testid="checkbox-email" />
              <Mail className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Email</p>
                <p className="text-xs text-muted-foreground">Send to specified recipients</p>
              </div>
            </label>
            <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${methods.includes("social") ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"}`}>
              <Checkbox checked={methods.includes("social")} onCheckedChange={() => toggleMethod("social")} data-testid="checkbox-social" />
              <Share2 className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Social Platforms</p>
                <p className="text-xs text-muted-foreground">Post to connected platforms</p>
              </div>
            </label>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {methods.includes("email") && (
            <Card className="border-border/50">
              <CardHeader><CardTitle className="text-base">Email Settings</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs">Recipients (comma-separated)</Label>
                  <Input value={emailRecipients} onChange={e => setEmailRecipients(e.target.value)}
                    placeholder="team@company.com, client@example.com" className="mt-1" data-testid="input-email-recipients" />
                </div>
                <div>
                  <Label className="text-xs">Subject</Label>
                  <Input value={emailSubject} onChange={e => setEmailSubject(e.target.value)}
                    placeholder={`${brief.campaignName} - Artwork Ready`} className="mt-1" data-testid="input-email-subject" />
                </div>
                <div>
                  <Label className="text-xs">Message</Label>
                  <Textarea value={emailMessage} onChange={e => setEmailMessage(e.target.value)}
                    placeholder="Please find the approved campaign assets attached..." rows={3} className="mt-1" data-testid="input-email-message" />
                </div>
              </CardContent>
            </Card>
          )}

          {methods.includes("social") && (
            <Card className="border-border/50">
              <CardHeader><CardTitle className="text-base">Social Platforms</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  { name: "Facebook", icon: Facebook, color: "#1877F2" },
                  { name: "Instagram", icon: Instagram, color: "#E4405F" },
                  { name: "LinkedIn", icon: Linkedin, color: "#0A66C2" },
                ].map(platform => (
                  <div key={platform.name} className="flex items-center justify-between p-3 rounded-lg border border-border/50">
                    <div className="flex items-center gap-2.5">
                      <platform.icon className="w-4 h-4" style={{ color: platform.color }} />
                      <span className="text-sm font-medium">{platform.name}</span>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 text-xs" data-testid={`button-connect-${platform.name.toLowerCase()}`}>
                      Connect Account
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground mt-2">Direct social posting is available in a future release.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" /> Schedule Dispatch
            </CardTitle>
            <div className="flex items-center gap-2">
              <Label htmlFor="schedule-toggle" className="text-sm text-muted-foreground">Schedule for later</Label>
              <Switch
                id="schedule-toggle"
                checked={scheduleEnabled}
                onCheckedChange={(v) => setScheduleEnabled(!!v)}
                disabled={dispatched || !!scheduledConfirm}
                data-testid="switch-schedule"
              />
            </div>
          </div>
        </CardHeader>
        {scheduleEnabled && (
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Dispatch date & time</Label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
                className="mt-1"
                disabled={!!scheduledConfirm}
                data-testid="input-scheduled-at"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The dispatch will run automatically at the selected time using the methods chosen above.
            </p>
          </CardContent>
        )}
      </Card>

      <div className="flex gap-3 justify-end pt-4 border-t border-border/50">
        <Link href={`/briefs/${briefId}/approve`}>
          <Button variant="outline">Back to Review</Button>
        </Link>
        {dispatched && methods.includes("download") && (
          <Button variant="outline" onClick={handleExport} disabled={exporting} data-testid="button-redownload">
            {exporting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Exporting...</> : <><Download className="w-4 h-4 mr-2" />Download Again</>}
          </Button>
        )}
        <Button onClick={handleDispatch} disabled={dispatchBrief.isPending || exporting || methods.length === 0 || dispatched || !!scheduledConfirm} data-testid="button-confirm-dispatch">
          {dispatchBrief.isPending || exporting
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Working...</>
            : dispatched
              ? "Dispatched"
              : scheduledConfirm
                ? "Scheduled"
                : scheduleEnabled
                  ? <><CalendarClock className="w-4 h-4 mr-2" />Schedule Dispatch</>
                  : `Dispatch via ${methods.length} method${methods.length !== 1 ? "s" : ""}`}
        </Button>
      </div>
    </div>
  );
}
