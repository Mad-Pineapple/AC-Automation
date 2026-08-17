import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListShareLinks,
  useCreateShareLink,
  useRevokeShareLink,
  getListShareLinksQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Check, Copy, Link2, Loader2, Trash2 } from "lucide-react";

/**
 * External share links for a brief: anyone with the URL sees a read-only
 * gallery of the generated assets — no account needed. Links expire and can
 * be revoked at any time.
 */
export default function ShareLinkDialog({
  briefId,
  open,
  onOpenChange,
}: {
  briefId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [copied, setCopied] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: links = [], isLoading } = useListShareLinks(briefId, {
    query: { enabled: open, queryKey: getListShareLinksQueryKey(briefId) },
  });
  const createLink = useCreateShareLink();
  const revokeLink = useRevokeShareLink();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListShareLinksQueryKey(briefId) });

  const shareUrl = (token: string) => `${window.location.origin}/share/${token}`;

  const handleCopy = (id: number, token: string) => {
    navigator.clipboard.writeText(shareUrl(token)).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(c => (c === id ? null : c)), 1800);
    });
  };

  const active = links.filter((l) => l.status === "active");
  const inactive = links.filter((l) => l.status !== "active");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-share-links">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-4 h-4" />
            Share with stakeholders
          </DialogTitle>
          <DialogDescription>
            Anyone with the link can view this brief's creative — no sign-in needed. Links can be
            revoked here at any time.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Select value={expiresInDays} onValueChange={setExpiresInDays}>
            <SelectTrigger className="w-36" data-testid="select-share-expiry">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Expires in 7 days</SelectItem>
              <SelectItem value="30">Expires in 30 days</SelectItem>
              <SelectItem value="90">Expires in 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() =>
              createLink.mutate(
                { id: briefId, data: { expiresInDays: Number(expiresInDays) } },
                {
                  onSuccess: (link) => {
                    invalidate();
                    handleCopy(link.id, link.token);
                    toast({ title: "Share link created and copied" });
                  },
                  onError: () => toast({ title: "Could not create share link", variant: "destructive" }),
                },
              )
            }
            disabled={createLink.isPending}
            data-testid="button-create-share-link"
          >
            {createLink.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create link"}
          </Button>
        </div>

        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin mx-auto my-4 text-muted-foreground" />
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {active.length === 0 && inactive.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No share links yet.</p>
            )}
            {active.map((l) => (
              <div
                key={l.id}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                data-testid={`share-link-${l.id}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono truncate">{shareUrl(l.token)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {l.expiresAt ? `Expires ${new Date(l.expiresAt).toLocaleDateString()}` : "No expiry"}
                    {l.createdBy ? ` · by ${l.createdBy}` : ""}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 flex-shrink-0"
                  onClick={() => handleCopy(l.id, l.token)}
                  data-testid={`share-link-copy-${l.id}`}
                >
                  {copied === l.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 flex-shrink-0 text-muted-foreground"
                  onClick={() =>
                    revokeLink.mutate(
                      { id: l.id },
                      { onSuccess: () => { invalidate(); toast({ title: "Share link revoked" }); } },
                    )
                  }
                  data-testid={`share-link-revoke-${l.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            {inactive.length > 0 && (
              <p className="text-[11px] text-muted-foreground pt-1">
                {inactive.length} expired or revoked link{inactive.length === 1 ? "" : "s"} no longer work.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
