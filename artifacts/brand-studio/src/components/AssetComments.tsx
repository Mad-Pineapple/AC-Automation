import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAssetComments,
  useCreateAssetComment,
  useUpdateAssetComment,
  useDeleteAssetComment,
  getListAssetCommentsQueryKey,
  AssetComment,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, MapPin, RotateCcw, Trash2, X } from "lucide-react";

/**
 * Pinned review comments for one asset (the Storyteq-style annotation gap).
 * The overlay draws numbered pins over the artwork; the panel holds the
 * thread. A pending pin (chosen by clicking the artwork while composing)
 * lives here and is submitted with the next comment.
 */

export interface PendingPin {
  x: number;
  y: number;
}

export function CommentPinsOverlay({
  comments,
  pendingPin,
  showResolved,
}: {
  comments: AssetComment[];
  pendingPin: PendingPin | null;
  showResolved: boolean;
}) {
  const pinned = comments.filter(
    (c) => c.pinX != null && c.pinY != null && (showResolved || !c.resolvedAt),
  );
  return (
    <>
      {pinned.map((c) => {
        const n = comments.filter((x) => x.pinX != null).findIndex((x) => x.id === c.id) + 1;
        return (
          <div
            key={c.id}
            className={`absolute z-10 w-5 h-5 -ml-2.5 -mt-2.5 rounded-full text-[10px] font-bold flex items-center justify-center ring-2 ring-white shadow ${
              c.resolvedAt ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
            }`}
            style={{ left: `${(c.pinX ?? 0) * 100}%`, top: `${(c.pinY ?? 0) * 100}%` }}
            title={c.body}
            data-testid={`comment-pin-${c.id}`}
          >
            {n}
          </div>
        );
      })}
      {pendingPin && (
        <div
          className="absolute z-10 w-5 h-5 -ml-2.5 -mt-2.5 rounded-full bg-amber-500 ring-2 ring-white shadow animate-pulse"
          style={{ left: `${pendingPin.x * 100}%`, top: `${pendingPin.y * 100}%` }}
          data-testid="comment-pin-pending"
        />
      )}
    </>
  );
}

export function CommentsPanel({
  assetId,
  comments,
  isLoading,
  pendingPin,
  onClearPendingPin,
  showResolved,
  onToggleResolved,
  onClose,
}: {
  assetId: number;
  comments: AssetComment[];
  isLoading: boolean;
  pendingPin: PendingPin | null;
  onClearPendingPin: () => void;
  showResolved: boolean;
  onToggleResolved: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createComment = useCreateAssetComment();
  const updateComment = useUpdateAssetComment();
  const deleteComment = useDeleteAssetComment();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListAssetCommentsQueryKey(assetId) });

  const handleSubmit = () => {
    if (!draft.trim()) return;
    createComment.mutate(
      {
        id: assetId,
        data: { body: draft.trim(), pinX: pendingPin?.x ?? null, pinY: pendingPin?.y ?? null },
      },
      {
        onSuccess: () => {
          setDraft("");
          onClearPendingPin();
          invalidate();
        },
        onError: () => toast({ title: "Could not add comment", variant: "destructive" }),
      },
    );
  };

  const visible = comments.filter((c) => showResolved || !c.resolvedAt);
  const pinNumber = (c: AssetComment) =>
    c.pinX != null ? comments.filter((x) => x.pinX != null).findIndex((x) => x.id === c.id) + 1 : null;

  return (
    <div
      className="fixed right-4 top-16 bottom-4 w-80 z-20 rounded-xl bg-background border border-border shadow-2xl flex flex-col"
      onClick={(e) => e.stopPropagation()}
      data-testid="comments-panel"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-semibold text-sm">
          Comments{comments.length > 0 ? ` (${comments.length})` : ""}
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs px-2"
            onClick={onToggleResolved}
            data-testid="comments-toggle-resolved"
          >
            {showResolved ? "Hide resolved" : "Show resolved"}
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose} data-testid="comments-close">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin mx-auto mt-6 text-muted-foreground" />
        ) : visible.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center mt-6">
            No comments yet. Click the artwork to drop a pin, then write your note below.
          </p>
        ) : (
          visible.map((c) => (
            <div
              key={c.id}
              className={`rounded-lg border p-2.5 text-sm ${c.resolvedAt ? "opacity-60 border-border" : "border-border"}`}
              data-testid={`comment-${c.id}`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium truncate">
                  {pinNumber(c) !== null && (
                    <span className="inline-flex items-center justify-center w-4 h-4 mr-1.5 rounded-full bg-red-600 text-white text-[9px] font-bold align-text-bottom">
                      {pinNumber(c)}
                    </span>
                  )}
                  {c.authorName ?? "Unknown"}
                </span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {new Date(c.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-xs whitespace-pre-wrap">{c.body}</p>
              <div className="flex items-center gap-1 mt-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[11px] gap-1"
                  onClick={() =>
                    updateComment.mutate(
                      { id: c.id, data: { resolved: !c.resolvedAt } },
                      { onSuccess: invalidate },
                    )
                  }
                  data-testid={`comment-resolve-${c.id}`}
                >
                  {c.resolvedAt ? <RotateCcw className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                  {c.resolvedAt ? "Reopen" : "Resolve"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground"
                  onClick={() =>
                    deleteComment.mutate(
                      { id: c.id },
                      {
                        onSuccess: invalidate,
                        onError: () =>
                          toast({ title: "Only the author or an admin can delete this", variant: "destructive" }),
                      },
                    )
                  }
                  data-testid={`comment-delete-${c.id}`}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
                {c.resolvedAt && c.resolvedBy && (
                  <span className="text-[10px] text-muted-foreground ml-auto">by {c.resolvedBy}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border p-3 space-y-2">
        {pendingPin ? (
          <div className="flex items-center justify-between text-[11px] text-amber-600 dark:text-amber-400">
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Pin placed on artwork
            </span>
            <button className="underline" onClick={onClearPendingPin} data-testid="comment-clear-pin">
              remove
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">Click the artwork to pin this comment (optional).</p>
        )}
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment…"
          rows={2}
          className="text-sm"
          data-testid="comment-input"
        />
        <Button
          size="sm"
          className="w-full"
          onClick={handleSubmit}
          disabled={!draft.trim() || createComment.isPending}
          data-testid="comment-submit"
        >
          {createComment.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Comment"}
        </Button>
      </div>
    </div>
  );
}

export function useAssetComments(assetId: number, enabled: boolean) {
  const { data: comments = [], isLoading } = useListAssetComments(assetId, {
    query: { enabled, queryKey: getListAssetCommentsQueryKey(assetId) },
  });
  return { comments, isLoading };
}
