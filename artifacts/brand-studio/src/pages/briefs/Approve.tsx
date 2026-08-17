import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  useGetBrief, useListAssets, useUpdateAsset, useRegenerateAsset, useDeleteAsset, useApproveBrief,
  useGetReviewProgress, useSaveReviewProgress, useCreateBriefAdTags, useExportAssetVideo,
  getGetBriefQueryKey, getListAssetsQueryKey, getListBriefsQueryKey, getGetReviewProgressQueryKey,
  getGetAdTagQueryKey,
} from "@workspace/api-client-react";
import { useParams, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useMe } from "@/hooks/use-me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ChevronLeft, CheckCircle, RefreshCw, Edit2, X, Check, Maximize2, Columns2, Eye, XCircle, Clock, Trash2, Tag, ShieldCheck, ShieldAlert } from "lucide-react";
import { TemplateThumbnail, getTemplateLabel, getTemplateConfig } from "@/components/TemplateRenderer";
import HtmlBannerEditor from "@/components/HtmlBannerEditor";
import AssetLightbox from "@/components/AssetLightbox";
import AssetCompare from "@/components/AssetCompare";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { ToastAction } from "@/components/ui/toast";

function AssetStatusBadge({ status, assetId }: { status: string; assetId: number }) {
  if (status === "approved") {
    return (
      <Badge
        className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 text-xs gap-1"
        data-testid={`status-badge-${assetId}`}
        data-status="approved"
      >
        <CheckCircle className="w-3 h-3" /> Approved
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge
        className="bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30 text-xs gap-1"
        data-testid={`status-badge-${assetId}`}
        data-status="rejected"
      >
        <XCircle className="w-3 h-3" /> Rejected
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-xs gap-1 text-muted-foreground"
      data-testid={`status-badge-${assetId}`}
      data-status="pending"
    >
      <Clock className="w-3 h-3" /> Pending
    </Badge>
  );
}

/** Parse the JSON-encoded complianceIssues column into a string array. */
function parseComplianceIssues(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((i): i is string => typeof i === "string") : [];
  } catch {
    return [];
  }
}

function isComplianceBlocked(asset: { complianceStatus?: string | null }): boolean {
  return asset.complianceStatus === "failed";
}

function ComplianceBadge({
  status,
  score,
  assetId,
}: {
  status: string | null | undefined;
  score: number | null | undefined;
  assetId: number;
}) {
  if (status === "failed") {
    return (
      <Badge
        className="bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30 text-xs gap-1"
        data-testid={`compliance-badge-${assetId}`}
        data-compliance="failed"
      >
        <ShieldAlert className="w-3 h-3" /> Off-brand{typeof score === "number" ? ` (${score})` : ""}
      </Badge>
    );
  }
  if (status === "passed") {
    return (
      <Badge
        className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-xs gap-1"
        data-testid={`compliance-badge-${assetId}`}
        data-compliance="passed"
      >
        <ShieldCheck className="w-3 h-3" /> On-brand{typeof score === "number" ? ` (${score})` : ""}
      </Badge>
    );
  }
  return null;
}

function ComplianceIssuesPanel({
  asset,
}: {
  asset: { id: number; complianceIssues?: string | null };
}) {
  const issues = parseComplianceIssues(asset.complianceIssues);
  return (
    <div
      className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-2.5 text-xs"
      data-testid={`compliance-issues-${asset.id}`}
    >
      <div className="flex items-center gap-1.5 font-medium text-red-700 dark:text-red-400">
        <ShieldAlert className="w-3.5 h-3.5" /> Blocked: doesn't follow brand guidelines
      </div>
      {issues.length > 0 ? (
        <ul className="mt-1.5 list-disc pl-4 space-y-0.5 text-muted-foreground">
          {issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-muted-foreground">Regenerate to produce an on-brand version before it can be approved.</p>
      )}
    </div>
  );
}

function formatRejectedAt(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function parseCompareParam(search: string): number[] {
  const params = new URLSearchParams(search);
  const raw = params.get("compare");
  if (!raw) return [];
  const ids = raw
    .split(",")
    .map(s => Number(s.trim()))
    .filter(n => Number.isInteger(n) && n > 0);
  const unique = Array.from(new Set(ids));
  return unique.length === 2 ? unique : [];
}

export default function ApproveScreen() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useMe();
  const briefId = Number(id);
  const [editingAsset, setEditingAsset] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<{ headline?: string; bodyText?: string; callToAction?: string }>({});
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [htmlLightboxIndex, setHtmlLightboxIndex] = useState<number | null>(null);
  const initialCompare = parseCompareParam(typeof window !== "undefined" ? window.location.search : "");
  const [compareMode, setCompareMode] = useState(initialCompare.length === 2);
  const [compareSelection, setCompareSelection] = useState<number[]>(initialCompare);
  const [compareOpen, setCompareOpen] = useState(initialCompare.length === 2);
  // True only while showing the exact pair that a shared ?compare=A,B link
  // opened. Any manual selection or exiting compare mode clears it so the
  // normal compare flow keeps its auto-advance behavior.
  const [comparePinned, setComparePinned] = useState(initialCompare.length === 2);
  const [reviewedAssetIds, setReviewedAssetIds] = useState<Set<number>>(new Set());
  const [assetDecisions, setAssetDecisions] = useState<Record<number, "approved" | "rejected">>({});
  const [confirmApproveOpen, setConfirmApproveOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "rejected" | "pending">("all");
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<number>>(new Set());
  const deleteTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const [adTagsOpen, setAdTagsOpen] = useState(false);
  const [bulkClickUrl, setBulkClickUrl] = useState("");
  const createBriefAdTags = useCreateBriefAdTags();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (compareOpen && compareSelection.length === 2) {
      params.set("compare", `${compareSelection[0]},${compareSelection[1]}`);
    } else {
      params.delete("compare");
    }
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    window.history.replaceState(null, "", url);
  }, [compareOpen, compareSelection]);

  const handleViewed = useCallback((assetId: number) => {
    setReviewedAssetIds(prev => prev.has(assetId) ? prev : new Set([...prev, assetId]));
  }, []);

  const toggleReviewed = useCallback((assetId: number) => {
    setReviewedAssetIds(prev => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, []);

  const handleDecision = useCallback((assetId: number, decision: "approved" | "rejected") => {
    setAssetDecisions(prev => (prev[assetId] === decision ? prev : { ...prev, [assetId]: decision }));
  }, []);

  const toggleCompareMode = () => {
    setCompareMode(m => !m);
    setCompareSelection([]);
    setCompareOpen(false);
    setComparePinned(false);
  };

  const handleCompareCardClick = (assetId: number) => {
    setComparePinned(false);
    setCompareSelection(prev => {
      if (prev.includes(assetId)) return prev.filter(id => id !== assetId);
      if (prev.length >= 2) return prev;
      const next = [...prev, assetId];
      if (next.length === 2) setCompareOpen(true);
      return next;
    });
  };

  const { data: brief, isLoading: briefLoading } = useGetBrief(briefId, {
    query: { enabled: !!briefId, queryKey: getGetBriefQueryKey(briefId) },
  });
  const { data: assets, isLoading: assetsLoading } = useListAssets({ briefId }, {
    query: { enabled: !!briefId, queryKey: getListAssetsQueryKey({ briefId }) },
  });

  const userId = me?.id;
  const storageKey = briefId && userId ? `brand-studio:reviewed-assets:${briefId}:${userId}` : null;
  const assetSignature = useMemo(
    () => (assets ? assets.map(a => a.id).sort((a, b) => a - b).join(",") : null),
    [assets],
  );
  const hydratedTokenRef = useRef<string | null>(null);
  const justHydratedRef = useRef(false);

  // Review progress lives on the server (per brief + user) so it is shared
  // across teammates and survives switching devices. localStorage is kept as a
  // cache for instant offline fallback when the server is unreachable.
  const reviewProgressQuery = useGetReviewProgress(briefId, {
    query: {
      enabled: !!briefId && !!userId,
      queryKey: getGetReviewProgressQueryKey(briefId),
    },
  });
  const saveReviewProgress = useSaveReviewProgress();

  useEffect(() => {
    if (!storageKey || assetSignature === null || !briefId) return;
    // Wait for the server query to settle so we don't hydrate an empty set
    // before progress arrives.
    if (reviewProgressQuery.isLoading) return;
    const token = `${storageKey}|${assetSignature}`;
    if (hydratedTokenRef.current === token) return;

    const validIds = new Set(
      assetSignature ? assetSignature.split(",").filter(Boolean).map(Number) : [],
    );
    let ids: number[] = [];

    if (reviewProgressQuery.isSuccess && reviewProgressQuery.data) {
      // Server is the source of truth; drop ids for assets that no longer exist.
      ids = reviewProgressQuery.data.reviewedAssetIds.filter(n => validIds.has(n));
    } else {
      // Server unreachable: fall back to the locally cached progress.
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { signature?: string; ids?: unknown };
          if (parsed && parsed.signature === assetSignature && Array.isArray(parsed.ids)) {
            ids = parsed.ids.filter((n): n is number => typeof n === "number");
          }
        }
      } catch {
        /* ignore malformed storage */
      }
    }

    hydratedTokenRef.current = token;
    justHydratedRef.current = true;
    setReviewedAssetIds(new Set(ids));
  }, [
    storageKey,
    assetSignature,
    briefId,
    reviewProgressQuery.isLoading,
    reviewProgressQuery.isSuccess,
    reviewProgressQuery.data,
  ]);

  useEffect(() => {
    if (!storageKey || assetSignature === null || !briefId) return;
    if (hydratedTokenRef.current !== `${storageKey}|${assetSignature}`) return;
    if (justHydratedRef.current) {
      justHydratedRef.current = false;
      return;
    }
    const ids = Array.from(reviewedAssetIds);
    // Cache locally for instant offline fallback.
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ signature: assetSignature, ids }),
      );
    } catch {
      /* ignore quota/serialization errors */
    }
    // Persist to the server so progress is shared and device-independent.
    // Failures are non-fatal: the localStorage cache covers the offline case.
    saveReviewProgress.mutate({ id: briefId, data: { reviewedAssetIds: ids } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewedAssetIds, storageKey, assetSignature, briefId]);

  const decisionsStorageKey = briefId && userId ? `brand-studio:review-decisions:${briefId}:${userId}` : null;
  const decisionsHydratedTokenRef = useRef<string | null>(null);
  const decisionsJustHydratedRef = useRef(false);

  useEffect(() => {
    if (!decisionsStorageKey || assetSignature === null) return;
    const token = `${decisionsStorageKey}|${assetSignature}`;
    if (decisionsHydratedTokenRef.current === token) return;
    decisionsHydratedTokenRef.current = token;
    decisionsJustHydratedRef.current = true;
    try {
      const raw = localStorage.getItem(decisionsStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { signature?: string; decisions?: unknown };
        if (parsed && parsed.signature === assetSignature && parsed.decisions && typeof parsed.decisions === "object") {
          const restored: Record<number, "approved" | "rejected"> = {};
          for (const [key, value] of Object.entries(parsed.decisions as Record<string, unknown>)) {
            const idNum = Number(key);
            if (Number.isFinite(idNum) && (value === "approved" || value === "rejected")) {
              restored[idNum] = value;
            }
          }
          setAssetDecisions(restored);
          return;
        }
      }
    } catch {
      /* ignore malformed storage */
    }
    setAssetDecisions({});
  }, [decisionsStorageKey, assetSignature]);

  useEffect(() => {
    if (!decisionsStorageKey || assetSignature === null) return;
    if (decisionsHydratedTokenRef.current !== `${decisionsStorageKey}|${assetSignature}`) return;
    if (decisionsJustHydratedRef.current) {
      decisionsJustHydratedRef.current = false;
      return;
    }
    try {
      localStorage.setItem(
        decisionsStorageKey,
        JSON.stringify({ signature: assetSignature, decisions: assetDecisions }),
      );
    } catch {
      /* ignore quota/serialization errors */
    }
  }, [assetDecisions, decisionsStorageKey, assetSignature]);

  const updateAsset = useUpdateAsset();
  const regenerateAsset = useRegenerateAsset();
  const approveBrief = useApproveBrief();

  const handleStartEdit = (asset: any) => {
    setEditingAsset(asset.id);
    setEditValues({ headline: asset.headline ?? "", bodyText: asset.bodyText ?? "", callToAction: asset.callToAction ?? "" });
  };

  const handleSaveEdit = (assetId: number) => {
    updateAsset.mutate({ id: assetId, data: editValues }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey({ briefId }) });
        setEditingAsset(null);
        toast({ title: "Asset updated" });
      },
    });
  };

  const handleSaveHtml = async (assetId: number, html: string) => {
    await new Promise<void>((resolve, reject) => {
      updateAsset.mutate({ id: assetId, data: { htmlContent: html } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey({ briefId }) });
          resolve();
        },
        onError: reject,
      });
    });
  };

  const handleRegenerate = (assetId: number) => {
    regenerateAsset.mutate({ id: assetId }, {
      onSuccess: () => {
        setTimeout(() => queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey({ briefId }) }), 3000);
        toast({ title: "Regenerating asset..." });
      },
    });
  };

  // ---- Video export (animated HTML creatives → MP4/GIF) ---------------------
  const exportVideo = useExportAssetVideo();
  const [exportingAssetId, setExportingAssetId] = useState<number | null>(null);
  const handleExportVideo = (assetId: number, format: "mp4" | "gif") => {
    setExportingAssetId(assetId);
    toast({ title: `Rendering ${format.toUpperCase()}…`, description: "Headless browser plays the creative in real time (~15s)." });
    exportVideo.mutate({ id: assetId, data: { format } }, {
      onSuccess: (result) => {
        setExportingAssetId(null);
        toast({ title: `${result.format.toUpperCase()} ready (${Math.round((result.bytes ?? 0) / 1024)} KB)` });
        window.open(result.url, "_blank");
      },
      onError: (error) => {
        setExportingAssetId(null);
        const detail = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({ title: "Video export failed", description: detail, variant: "destructive" });
      },
    });
  };

  // ---- Delete with deferred undo --------------------------------------------
  const deleteAsset = useDeleteAsset();
  const deleteMutateRef = useRef(deleteAsset.mutate);
  useEffect(() => {
    deleteMutateRef.current = deleteAsset.mutate;
  }, [deleteAsset.mutate]);

  const commitDelete = useCallback((assetId: number) => {
    deleteTimersRef.current.delete(assetId);
    deleteMutateRef.current({ id: assetId }, {
      onSuccess: () => {
        queryClient.setQueryData<typeof assets>(
          getListAssetsQueryKey({ briefId }),
          (old) => (old ? old.filter((a) => a.id !== assetId) : old),
        );
        setPendingDeleteIds((prev) => {
          const next = new Set(prev);
          next.delete(assetId);
          return next;
        });
        queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey({ briefId }) });
      },
      onError: () => {
        setPendingDeleteIds((prev) => {
          const next = new Set(prev);
          next.delete(assetId);
          return next;
        });
        toast({ title: "Couldn't delete asset", description: "Please try again.", variant: "destructive" });
      },
    });
  }, [briefId, queryClient, toast]);

  const handleUndoDelete = useCallback((assetId: number) => {
    const timer = deleteTimersRef.current.get(assetId);
    if (timer) {
      clearTimeout(timer);
      deleteTimersRef.current.delete(assetId);
    }
    setPendingDeleteIds((prev) => {
      const next = new Set(prev);
      next.delete(assetId);
      return next;
    });
  }, []);

  const handleDeleteAsset = useCallback((assetId: number) => {
    // Hide the asset immediately, then commit the delete after a short grace
    // period so the user can undo. Navigating away flushes pending deletes.
    setPendingDeleteIds((prev) => new Set(prev).add(assetId));
    const existing = deleteTimersRef.current.get(assetId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => commitDelete(assetId), 5000);
    deleteTimersRef.current.set(assetId, timer);
    toast({
      title: "Asset deleted",
      description: "It will be permanently removed shortly.",
      duration: 5000,
      action: (
        <ToastAction altText="Undo delete" onClick={() => handleUndoDelete(assetId)}>
          Undo
        </ToastAction>
      ),
    });
  }, [commitDelete, handleUndoDelete, toast]);

  // Flush any still-pending deletes when leaving the page so the user's intent
  // is honored even if they navigate away during the undo grace period.
  useEffect(() => {
    const timers = deleteTimersRef.current;
    return () => {
      timers.forEach((timer, id) => {
        clearTimeout(timer);
        deleteMutateRef.current({ id });
      });
      timers.clear();
    };
  }, []);

  const visibleAssets = useMemo(
    () => (assets ?? []).filter((a) => !pendingDeleteIds.has(a.id)),
    [assets, pendingDeleteIds],
  );
  const visibleReviewedCount = useMemo(
    () => visibleAssets.filter((a) => reviewedAssetIds.has(a.id)).length,
    [visibleAssets, reviewedAssetIds],
  );

  const performApprove = () => {
    const blockedNow = visibleAssets.filter(
      a => (assetDecisions[a.id] ?? a.status) !== "rejected" && isComplianceBlocked(a),
    ).length;
    approveBrief.mutate({ id: briefId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBriefQueryKey(briefId) });
        queryClient.invalidateQueries({ queryKey: getListBriefsQueryKey() });
        toast(
          blockedNow > 0
            ? {
                title: "Approved on-brand assets",
                description: `${blockedNow} asset${blockedNow !== 1 ? "s" : ""} blocked for brand compliance ${blockedNow !== 1 ? "were" : "was"} skipped. Regenerate to include ${blockedNow !== 1 ? "them" : "it"}.`,
              }
            : { title: "All assets approved" },
        );
        setLocation(`/briefs/${briefId}/dispatch`);
      },
    });
  };

  const handleApproveAll = () => {
    const total = visibleAssets.length;
    if (total > 0 && visibleReviewedCount < total) {
      setConfirmApproveOpen(true);
      return;
    }
    performApprove();
  };

  const handleConfirmApprove = () => {
    setConfirmApproveOpen(false);
    performApprove();
  };

  const handleGenerateAdTags = () => {
    createBriefAdTags.mutate(
      { id: briefId, data: { clickUrl: bulkClickUrl.trim() || null } },
      {
        onSuccess: (res) => {
          setAdTagsOpen(false);
          setBulkClickUrl("");
          visibleAssets.forEach(a =>
            queryClient.invalidateQueries({ queryKey: getGetAdTagQueryKey(a.id) })
          );
          const parts: string[] = [];
          if (res.created) parts.push(`${res.created} created`);
          if (res.updated) parts.push(`${res.updated} updated`);
          toast({
            title: `Ad tags ready for ${res.total} creative${res.total === 1 ? "" : "s"}`,
            description: parts.length
              ? `${parts.join(", ")}. Open any creative to copy its embed snippet.`
              : "All creatives already had tags. Open any creative to copy its snippet.",
          });
        },
        onError: () => toast({ title: "Could not generate ad tags", variant: "destructive" }),
      }
    );
  };

  const skippedCount = visibleAssets.length - visibleReviewedCount;

  if (briefLoading || assetsLoading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-72 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  const htmlBannerAssets = visibleAssets.filter(a => a.templateSize === "html_banner");
  const regularAssets = visibleAssets.filter(a => a.templateSize !== "html_banner");

  const effectiveStatus = (asset: (typeof visibleAssets)[number]): "approved" | "rejected" | "pending" => {
    const s = assetDecisions[asset.id] ?? asset.status;
    if (s === "approved") return "approved";
    if (s === "rejected") return "rejected";
    return "pending";
  };

  const statusCounts = {
    all: visibleAssets.length,
    approved: visibleAssets.filter(a => effectiveStatus(a) === "approved").length,
    rejected: visibleAssets.filter(a => effectiveStatus(a) === "rejected").length,
    pending: visibleAssets.filter(a => effectiveStatus(a) === "pending").length,
  };

  const rejectedAssets = visibleAssets.filter(a => effectiveStatus(a) === "rejected");
  // Compliance-blocked assets are excluded from dispatch too (but don't double
  // count ones already rejected).
  const blockedAssets = visibleAssets.filter(a => effectiveStatus(a) !== "rejected" && isComplianceBlocked(a));
  const shippableCount = visibleAssets.length - rejectedAssets.length - blockedAssets.length;

  const matchesFilter = (asset: (typeof visibleAssets)[number]) =>
    statusFilter === "all" || effectiveStatus(asset) === statusFilter;

  const shownRegularAssets = regularAssets.filter(matchesFilter);
  const shownHtmlBannerAssets = htmlBannerAssets.filter(matchesFilter);
  const hasFilteredResults = shownRegularAssets.length > 0 || shownHtmlBannerAssets.length > 0;

  const statusFilters: { key: typeof statusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "pending", label: "Pending" },
  ];

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex items-start gap-4">
        <Link href={`/briefs/${briefId}`} className="p-2 hover:bg-muted rounded-full transition-colors mt-1">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Review Assets</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1">
            {brief?.campaignName} · {visibleAssets.length} assets
            {brief?.createdByName && <> · by {brief.createdByName}</>}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {visibleAssets.length >= 2 && (
            <Button
              variant={compareMode ? "default" : "outline"}
              onClick={toggleCompareMode}
              data-testid="button-compare-mode"
              className={compareMode ? "bg-primary text-primary-foreground" : ""}
            >
              <Columns2 className="w-4 h-4 mr-2" />
              {compareMode ? "Exit Compare" : "Compare"}
            </Button>
          )}
          {visibleAssets.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setAdTagsOpen(true)}
              disabled={compareMode}
              data-testid="button-generate-ad-tags"
            >
              <Tag className="w-4 h-4 mr-2" />
              Generate Ad Tags
            </Button>
          )}
          <Button
            onClick={handleApproveAll}
            disabled={approveBrief.isPending || !visibleAssets.length || compareMode}
            data-testid="button-approve-all"
          >
            <CheckCircle className="w-4 h-4 mr-2" />
            {approveBrief.isPending
              ? "Approving..."
              : `Approve All${visibleAssets.length ? ` (${visibleReviewedCount}/${visibleAssets.length} reviewed)` : ""}`}
          </Button>
        </div>
      </div>

      {visibleAssets.length > 0 && (() => {
        const total = visibleAssets.length;
        const reviewed = visibleReviewedCount;
        const allReviewed = reviewed >= total;
        const pct = Math.round((reviewed / total) * 100);
        return (
          <div className="space-y-2" data-testid="review-progress">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {allReviewed ? (
                  <span className="text-green-600 dark:text-green-500 font-medium inline-flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4" />
                    Ready to approve
                  </span>
                ) : (
                  <>Review progress</>
                )}
              </span>
              <span className="font-mono text-muted-foreground" data-testid="review-progress-count">
                {reviewed}/{total} reviewed
              </span>
            </div>
            <Progress
              value={pct}
              className={allReviewed ? "[&>div]:bg-green-500" : ""}
              data-testid="review-progress-bar"
            />
          </div>
        );
      })()}

      {!compareMode && rejectedAssets.length > 0 && (
        <Card className="border-red-500/30 bg-red-500/5" data-testid="rejected-summary">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-red-700 dark:text-red-400">
              <XCircle className="w-4 h-4" />
              {rejectedAssets.length} rejected asset{rejectedAssets.length !== 1 ? "s" : ""} won't ship
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {rejectedAssets.length === visibleAssets.length ? (
                <>Every asset in this brief is rejected — nothing will be dispatched.</>
              ) : (
                <>These are excluded from dispatch. Approving the brief sends only the remaining {shippableCount} asset{shippableCount !== 1 ? "s" : ""}.</>
              )}
            </p>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {rejectedAssets.map(asset => {
              const rejectedAtLabel = asset.rejectedAt ? formatRejectedAt(asset.rejectedAt) : null;
              return (
                <div
                  key={asset.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-red-500/20 bg-background/60 px-3 py-2"
                  data-testid={`rejected-item-${asset.id}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{getTemplateLabel(asset.templateSize)}{asset.variantLabel ? ` — ${asset.variantLabel}` : ""}</div>
                    {asset.headline && (
                      <div className="text-xs text-muted-foreground truncate">{asset.headline}</div>
                    )}
                    {asset.rejectionReason && (
                      <div className="text-xs mt-1" data-testid={`rejected-reason-${asset.id}`}>
                        <span className="font-medium text-foreground">Reason:</span> {asset.rejectionReason}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground flex-shrink-0 space-y-0.5">
                    {asset.rejectedByName ? (
                      <div data-testid={`rejected-by-${asset.id}`}>by {asset.rejectedByName}</div>
                    ) : (
                      <div className="italic">rejecter unknown</div>
                    )}
                    {rejectedAtLabel && <div>{rejectedAtLabel}</div>}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {!compareMode && blockedAssets.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5" data-testid="compliance-summary">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <ShieldAlert className="w-4 h-4" />
              {blockedAssets.length} asset{blockedAssets.length !== 1 ? "s" : ""} blocked for brand compliance
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              These don't follow the brand guidelines and can't be approved or dispatched. Regenerate each one to produce an on-brand version.
            </p>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {blockedAssets.map(asset => {
              const issues = parseComplianceIssues(asset.complianceIssues);
              return (
                <div
                  key={asset.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-amber-500/20 bg-background/60 px-3 py-2"
                  data-testid={`compliance-item-${asset.id}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{getTemplateLabel(asset.templateSize)}{asset.variantLabel ? ` — ${asset.variantLabel}` : ""}</div>
                    {issues.length > 0 && (
                      <ul className="text-xs text-muted-foreground mt-1 list-disc pl-4 space-y-0.5">
                        {issues.slice(0, 3).map((issue, i) => <li key={i}>{issue}</li>)}
                      </ul>
                    )}
                  </div>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => handleRegenerate(asset.id)}
                    disabled={regenerateAsset.isPending || asset.status === "generating"}
                    data-testid={`button-regenerate-blocked-${asset.id}`}
                    className="flex-shrink-0 h-7"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${asset.status === "generating" ? "animate-spin" : ""}`} />
                    Regenerate
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {compareMode && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {compareSelection.length === 0 && "Select two assets below to compare them side by side."}
            {compareSelection.length === 1 && "Select one more asset to compare."}
            {compareSelection.length === 2 && "Both assets selected - opening comparison…"}
          </p>
          {compareSelection.length === 2 && (
            <Button
              size="sm"
              data-testid="button-open-compare"
              onClick={() => setCompareOpen(true)}
            >
              <Columns2 className="w-3.5 h-3.5 mr-1.5" />
              Open Comparison
            </Button>
          )}
        </div>
      )}

      {visibleAssets.length === 0 ? (
        <Card className="border-dashed p-12 text-center">
          <p className="text-muted-foreground">No assets generated yet. Go back and trigger generation.</p>
        </Card>
      ) : (
        <div className="space-y-8">
          {!compareMode && (
            <div
              className="inline-flex items-center gap-1 rounded-lg border bg-muted/30 p-1 w-fit"
              data-testid="status-filter"
              role="group"
              aria-label="Filter assets by status"
            >
              {statusFilters.map(f => (
                <Button
                  key={f.key}
                  type="button"
                  size="sm"
                  variant={statusFilter === f.key ? "default" : "ghost"}
                  onClick={() => setStatusFilter(f.key)}
                  data-testid={`filter-${f.key}`}
                  aria-pressed={statusFilter === f.key}
                  className="h-7 gap-1.5"
                >
                  {f.label}
                  <span
                    className={`rounded-full px-1.5 text-xs font-mono ${
                      statusFilter === f.key ? "bg-primary-foreground/20" : "bg-muted-foreground/15"
                    }`}
                    data-testid={`filter-count-${f.key}`}
                  >
                    {statusCounts[f.key]}
                  </span>
                </Button>
              ))}
            </div>
          )}

          {!compareMode && !hasFilteredResults ? (
            <Card className="border-dashed p-12 text-center" data-testid="filter-empty-state">
              <p className="text-muted-foreground">
                No {statusFilter} assets in this brief.
              </p>
            </Card>
          ) : (
          <div className="space-y-8">
          {shownRegularAssets.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {shownRegularAssets.map(asset => {
                const isEditing = editingAsset === asset.id;
                const isSelected = compareSelection.includes(asset.id);
                const selectionIndex = compareSelection.indexOf(asset.id);
                const isDisabledForCompare = compareMode && compareSelection.length >= 2 && !isSelected;
                const effectiveRejected = (assetDecisions[asset.id] ?? asset.status) === "rejected";
                return (
                  <Card
                    key={asset.id}
                    className={`overflow-hidden flex flex-col transition-all ${
                      compareMode
                        ? isSelected
                          ? "border-primary ring-2 ring-primary/60"
                          : isDisabledForCompare
                            ? "border-border/30 opacity-40"
                            : "border-border/50 hover:border-primary/40 cursor-pointer"
                        : effectiveRejected
                          ? "border-border/50 opacity-60"
                          : "border-border/50"
                    }`}
                    data-testid={`card-asset-${asset.id}`}
                    onClick={compareMode ? () => handleCompareCardClick(asset.id) : undefined}
                  >
                    <CardHeader className="pb-3 flex-row items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {compareMode && isSelected && (
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                            {selectionIndex + 1}
                          </span>
                        )}
                        <div className="min-w-0">
                          <CardTitle className="text-sm">{getTemplateLabel(asset.templateSize)}{asset.variantLabel ? ` — ${asset.variantLabel}` : ""}</CardTitle>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <AssetStatusBadge status={asset.status} assetId={asset.id} />
                            <ComplianceBadge status={asset.complianceStatus} score={asset.complianceScore} assetId={asset.id} />
                            {asset.isAnimated && <Badge variant="outline" className="text-xs">Animated</Badge>}
                          </div>
                        </div>
                      </div>
                      {!compareMode && (
                        <div className="flex gap-1.5 flex-shrink-0">
                          <Button
                            variant="ghost" size="sm"
                            onClick={e => { e.stopPropagation(); toggleReviewed(asset.id); }}
                            data-testid={`button-toggle-reviewed-${asset.id}`}
                            className={`h-7 px-2 ${reviewedAssetIds.has(asset.id) ? "text-green-600 dark:text-green-500" : ""}`}
                            title={reviewedAssetIds.has(asset.id) ? "Mark as not reviewed" : "Mark as reviewed"}
                            aria-pressed={reviewedAssetIds.has(asset.id)}
                          >
                            {reviewedAssetIds.has(asset.id)
                              ? <CheckCircle className="w-3.5 h-3.5" />
                              : <Eye className="w-3.5 h-3.5" />}
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => handleRegenerate(asset.id)}
                            disabled={regenerateAsset.isPending || asset.status === "generating"}
                            data-testid={`button-regenerate-${asset.id}`}
                            className="h-7 px-2"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${asset.status === "generating" ? "animate-spin" : ""}`} />
                          </Button>
                          {asset.htmlContent && (
                            <>
                              <Button
                                variant="ghost" size="sm"
                                onClick={e => { e.stopPropagation(); handleExportVideo(asset.id, "mp4"); }}
                                disabled={exportingAssetId !== null}
                                title="Export as MP4 video"
                                data-testid={`button-export-mp4-${asset.id}`}
                                className="h-7 px-2 text-xs font-mono"
                              >
                                {exportingAssetId === asset.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "MP4"}
                              </Button>
                              <Button
                                variant="ghost" size="sm"
                                onClick={e => { e.stopPropagation(); handleExportVideo(asset.id, "gif"); }}
                                disabled={exportingAssetId !== null}
                                title="Export as animated GIF"
                                data-testid={`button-export-gif-${asset.id}`}
                                className="h-7 px-2 text-xs font-mono"
                              >
                                GIF
                              </Button>
                            </>
                          )}
                          {!asset.htmlContent && (isEditing ? (
                            <>
                              <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); setEditingAsset(null); }} className="h-7 px-2">
                                <X className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); handleSaveEdit(asset.id); }} className="h-7 px-2">
                                <Check className="w-3.5 h-3.5 text-primary" />
                              </Button>
                            </>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => handleStartEdit(asset)} className="h-7 px-2" data-testid={`button-edit-${asset.id}`}>
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                          ))}
                          <Button
                            variant="ghost" size="sm"
                            onClick={e => { e.stopPropagation(); handleDeleteAsset(asset.id); }}
                            data-testid={`button-delete-${asset.id}`}
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            title="Delete asset"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </CardHeader>

                    {brief?.brand && (
                      <div
                        className={`px-4 pb-3 flex items-center justify-center bg-muted/30 mx-4 rounded-lg overflow-hidden relative group ${compareMode ? "cursor-pointer" : "cursor-zoom-in"}`}
                        style={{ minHeight: 140 }}
                        onClick={compareMode ? undefined : e => { e.stopPropagation(); setLightboxIndex(regularAssets.indexOf(asset)); }}
                        data-testid={`thumbnail-click-${asset.id}`}
                        title={compareMode ? (isSelected ? "Click to deselect" : "Click to select for comparison") : "Click to preview full size"}
                      >
                        {asset.htmlContent ? (
                          <div
                            style={{ width: 200, height: 200, overflow: "hidden" }}
                            className="relative pointer-events-none"
                          >
                            <iframe
                              srcDoc={asset.htmlContent}
                              sandbox="allow-scripts"
                              style={{
                                border: "none",
                                width: getTemplateConfig(asset.templateSize).width,
                                height: getTemplateConfig(asset.templateSize).height,
                                transformOrigin: "top left",
                                transform: `scale(${200 / getTemplateConfig(asset.templateSize).width})`,
                                pointerEvents: "none",
                              }}
                              title="Animated HTML Banner"
                              data-testid={`thumbnail-html-${asset.id}`}
                            />
                          </div>
                        ) : (
                          <TemplateThumbnail
                            templateSize={asset.templateSize}
                            brand={brief.brand}
                            headline={isEditing ? editValues.headline : asset.headline}
                            bodyText={isEditing ? editValues.bodyText : asset.bodyText}
                            callToAction={isEditing ? editValues.callToAction : asset.callToAction}
                            imageUrl={asset.imageUrl}
                            isAnimated={asset.isAnimated}
                          />
                        )}
                        <div className={`absolute inset-0 transition-colors rounded-lg flex items-center justify-center ${
                          compareMode
                            ? isSelected ? "bg-primary/20" : "bg-black/0 group-hover:bg-primary/10"
                            : "bg-black/0 group-hover:bg-black/25"
                        }`}>
                          {!compareMode && <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />}
                          {compareMode && isSelected && <Check className="w-6 h-6 text-primary opacity-80" />}
                        </div>
                        {reviewedAssetIds.has(asset.id) && (
                          <div
                            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center shadow-md pointer-events-none"
                            data-testid={`reviewed-badge-${asset.id}`}
                            title="Reviewed"
                          >
                            <Eye className="w-3.5 h-3.5 text-white" />
                          </div>
                        )}
                      </div>
                    )}

                    <CardContent className="pt-4 pb-4 flex-1">
                      {isEditing ? (
                        <div className="space-y-3">
                          <div>
                            <Label className="text-xs">Headline</Label>
                            <Input value={editValues.headline ?? ""} onChange={e => setEditValues(v => ({ ...v, headline: e.target.value }))}
                              className="mt-1 h-8 text-sm" data-testid={`input-headline-${asset.id}`} />
                          </div>
                          <div>
                            <Label className="text-xs">Body Text</Label>
                            <Textarea value={editValues.bodyText ?? ""} onChange={e => setEditValues(v => ({ ...v, bodyText: e.target.value }))}
                              className="mt-1 text-sm" rows={2} data-testid={`input-body-${asset.id}`} />
                          </div>
                          <div>
                            <Label className="text-xs">Call to Action</Label>
                            <Input value={editValues.callToAction ?? ""} onChange={e => setEditValues(v => ({ ...v, callToAction: e.target.value }))}
                              className="mt-1 h-8 text-sm" data-testid={`input-cta-${asset.id}`} />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1 text-xs text-muted-foreground">
                          {asset.headline && <div><span className="font-medium text-foreground">H:</span> {asset.headline}</div>}
                          {asset.bodyText && <div><span className="font-medium text-foreground">B:</span> {asset.bodyText}</div>}
                          {asset.callToAction && <div><span className="font-medium text-foreground">CTA:</span> {asset.callToAction}</div>}
                        </div>
                      )}
                      {isComplianceBlocked(asset) && !isEditing && (
                        <ComplianceIssuesPanel asset={asset} />
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {shownHtmlBannerAssets.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">HTML Banners</h2>
                <Badge variant="outline" className="text-xs">AI-Generated</Badge>
              </div>
              {shownHtmlBannerAssets.map(asset => {
                const isSelected = compareSelection.includes(asset.id);
                const selectionIndex = compareSelection.indexOf(asset.id);
                const isDisabledForCompare = compareMode && compareSelection.length >= 2 && !isSelected;
                const effectiveRejected = (assetDecisions[asset.id] ?? asset.status) === "rejected";
                return (
                  <Card
                    key={asset.id}
                    className={`transition-all ${
                      compareMode
                        ? isSelected
                          ? "border-primary ring-2 ring-primary/60 cursor-pointer"
                          : isDisabledForCompare
                            ? "border-border/30 opacity-40"
                            : "border-border/50 hover:border-primary/40 cursor-pointer"
                        : effectiveRejected
                          ? "border-border/50 opacity-60"
                          : "border-border/50"
                    }`}
                    data-testid={`card-asset-${asset.id}`}
                    onClick={compareMode ? () => handleCompareCardClick(asset.id) : undefined}
                  >
                    <CardHeader className="pb-3 flex-row items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {compareMode && isSelected && (
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                            {selectionIndex + 1}
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <CardTitle className="text-sm">{getTemplateLabel(asset.templateSize)}{asset.variantLabel ? ` — ${asset.variantLabel}` : ""}</CardTitle>
                            <AssetStatusBadge status={asset.status} assetId={asset.id} />
                            <ComplianceBadge status={asset.complianceStatus} score={asset.complianceScore} assetId={asset.id} />
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">Edit the HTML directly and save your style for future campaigns</p>
                        </div>
                      </div>
                      {!compareMode && (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <Button
                            variant="ghost" size="sm"
                            onClick={e => { e.stopPropagation(); toggleReviewed(asset.id); }}
                            data-testid={`button-toggle-reviewed-${asset.id}`}
                            className={`h-7 px-2 ${reviewedAssetIds.has(asset.id) ? "text-green-600 dark:text-green-500" : ""}`}
                            title={reviewedAssetIds.has(asset.id) ? "Mark as not reviewed" : "Mark as reviewed"}
                            aria-pressed={reviewedAssetIds.has(asset.id)}
                          >
                            {reviewedAssetIds.has(asset.id)
                              ? <CheckCircle className="w-3.5 h-3.5" />
                              : <Eye className="w-3.5 h-3.5" />}
                          </Button>
                          {asset.htmlContent && (
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => setHtmlLightboxIndex(htmlBannerAssets.indexOf(asset))}
                              data-testid={`button-preview-${asset.id}`}
                              className="h-7 px-2"
                              title="Preview full size"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => handleRegenerate(asset.id)}
                            disabled={regenerateAsset.isPending || asset.status === "generating"}
                            data-testid={`button-regenerate-${asset.id}`}
                            className="h-7 px-2"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${asset.status === "generating" ? "animate-spin" : ""}`} />
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            onClick={e => { e.stopPropagation(); handleDeleteAsset(asset.id); }}
                            data-testid={`button-delete-${asset.id}`}
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            title="Delete asset"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </CardHeader>
                    {!compareMode && (
                      <CardContent className="pt-0">
                        {asset.htmlContent ? (
                          brief?.brand ? (
                            <>
                              <div
                                className="mb-4 rounded-md overflow-hidden ring-1 ring-border/50 bg-white cursor-zoom-in relative group"
                                style={{ width: 364, height: 45 }}
                                onClick={() => setHtmlLightboxIndex(htmlBannerAssets.indexOf(asset))}
                                data-testid={`thumbnail-click-${asset.id}`}
                                title="Click to preview full size"
                              >
                                <iframe
                                  srcDoc={asset.htmlContent}
                                  sandbox="allow-scripts"
                                  style={{
                                    border: "none",
                                    width: 728,
                                    height: 90,
                                    transformOrigin: "top left",
                                    transform: "scale(0.5)",
                                    pointerEvents: "none",
                                  }}
                                  title="HTML Banner Thumbnail"
                                  data-testid={`thumbnail-html-banner-${asset.id}`}
                                />
                                <div className="absolute inset-0 transition-colors flex items-center justify-center bg-black/0 group-hover:bg-black/25">
                                  <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
                                </div>
                              </div>
                              <HtmlBannerEditor
                                assetId={asset.id}
                                briefId={briefId}
                                brandId={brief.brand.id}
                                brandName={brief.brand.name}
                                campaignName={brief.campaignName}
                                initialHtml={asset.htmlContent}
                                onSave={(html) => handleSaveHtml(asset.id, html)}
                              />
                            </>
                          ) : null
                        ) : (
                          <div className="text-sm text-muted-foreground p-4 border border-dashed rounded-md text-center">
                            {asset.status === "generating"
                              ? "Generating HTML banner…"
                              : "No HTML content yet. Try regenerating this asset."}
                          </div>
                        )}
                        {isComplianceBlocked(asset) && <ComplianceIssuesPanel asset={asset} />}
                      </CardContent>
                    )}
                    {compareMode && (
                      <CardContent className="pt-0 pb-4">
                        {asset.htmlContent && brief?.brand ? (
                          <div
                            className="mb-2 rounded-md overflow-hidden ring-1 ring-border/50 bg-white relative group"
                            style={{ width: 364, height: 45 }}
                          >
                            <iframe
                              srcDoc={asset.htmlContent}
                              sandbox="allow-scripts"
                              style={{
                                border: "none",
                                width: 728,
                                height: 90,
                                transformOrigin: "top left",
                                transform: "scale(0.5)",
                                pointerEvents: "none",
                              }}
                              title="HTML Banner Thumbnail"
                              data-testid={`thumbnail-html-banner-${asset.id}`}
                            />
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); setHtmlLightboxIndex(htmlBannerAssets.indexOf(asset)); }}
                              className="absolute top-1 right-1 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                              title="Open full-size preview"
                              data-testid={`button-compare-maximize-html-${asset.id}`}
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          {isSelected ? "Selected for comparison" : "Click to select for comparison"}
                        </p>
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
          </div>
          )}
        </div>
      )}

      {lightboxIndex !== null && brief?.brand && regularAssets.length > 0 && (
        <AssetLightbox
          assets={regularAssets}
          initialIndex={lightboxIndex}
          brand={brief.brand}
          onClose={() => setLightboxIndex(null)}
          onViewed={handleViewed}
        />
      )}

      {htmlLightboxIndex !== null && brief?.brand && htmlBannerAssets.length > 0 && (
        <AssetLightbox
          assets={htmlBannerAssets}
          initialIndex={htmlLightboxIndex}
          brand={brief.brand}
          onClose={() => setHtmlLightboxIndex(null)}
          onViewed={handleViewed}
        />
      )}

      {compareOpen && compareSelection.length === 2 && brief?.brand && (() => {
        const allAssets = [...regularAssets, ...htmlBannerAssets];
        const indexA = allAssets.findIndex(a => a.id === compareSelection[0]);
        const indexB = allAssets.findIndex(a => a.id === compareSelection[1]);
        if (indexA === -1 || indexB === -1) return null;
        return (
          <AssetCompare
            assets={allAssets}
            initialIndexA={indexA}
            initialIndexB={indexB}
            brand={brief.brand}
            pinned={comparePinned}
            onClose={() => setCompareOpen(false)}
            onActioned={(assetId, action) => {
              handleDecision(assetId, action === "approve" ? "approved" : "rejected");
              queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey({ briefId }) });
            }}
          />
        );
      })()}

      <Dialog open={adTagsOpen} onOpenChange={setAdTagsOpen}>
        <DialogContent data-testid="dialog-bulk-ad-tags">
          <DialogHeader>
            <DialogTitle>Generate ad tags for all creatives</DialogTitle>
            <DialogDescription>
              Creates a trackable ad tag for every creative in this brief. Creatives
              that already have a tag keep their existing one, so anything you've
              already embedded keeps working.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="bulk-click-url">Click-through URL (optional)</Label>
            <Input
              id="bulk-click-url"
              placeholder="https://example.com/landing"
              value={bulkClickUrl}
              onChange={e => setBulkClickUrl(e.target.value)}
              data-testid="input-bulk-click-url"
            />
            <p className="text-xs text-muted-foreground">
              Applied to every creative. Leave blank to keep each creative's current
              landing URL.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdTagsOpen(false)} data-testid="button-cancel-ad-tags">
              Cancel
            </Button>
            <Button
              onClick={handleGenerateAdTags}
              disabled={createBriefAdTags.isPending}
              data-testid="button-confirm-ad-tags"
            >
              <Tag className="w-4 h-4 mr-2" />
              {createBriefAdTags.isPending ? "Generating..." : "Generate tags"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmApproveOpen} onOpenChange={setConfirmApproveOpen}>
        <AlertDialogContent data-testid="dialog-confirm-approve">
          <AlertDialogHeader>
            <AlertDialogTitle>Approve without reviewing everything?</AlertDialogTitle>
            <AlertDialogDescription>
              {skippedCount === 1
                ? "1 asset hasn't been previewed yet."
                : `${skippedCount} assets haven't been previewed yet.`}{" "}
              Approving now will sign off on {skippedCount === 1 ? "it" : "them"} without a full review.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-approve">Go back to review</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmApprove} data-testid="button-confirm-approve">
              Approve anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
