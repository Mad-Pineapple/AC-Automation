import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  ShieldCheck,
  ShieldOff,
  MoreVertical,
  UserX,
  UserCheck,
  Trash2,
} from "lucide-react";

interface TeamMember {
  id: number;
  clerkId: string;
  role: string;
  email: string | null;
  name: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  deactivatedAt: string | null;
}

const INACTIVE_THRESHOLD_DAYS = 30;
const INACTIVE_THRESHOLD_MS = INACTIVE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

function isInactive(value: string | null): boolean {
  if (!value) return true;
  const date = new Date(value);
  if (isNaN(date.getTime())) return true;
  return Date.now() - date.getTime() > INACTIVE_THRESHOLD_MS;
}

function formatLastSeen(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "Never";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Active now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface MeData {
  id: number;
  role: string;
}

function useMe() {
  return useQuery<MeData>({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await fetch("/api/me", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch current user");
      return res.json();
    },
    staleTime: 60_000,
  });
}

function useTeamMembers() {
  return useQuery<TeamMember[]>({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await fetch("/api/users", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch team members");
      return res.json();
    },
  });
}

function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, role }: { id: number; role: string }) => {
      const res = await fetch(`/api/users/${id}/role`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to update role");
      }
      return res.json() as Promise<TeamMember>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

function useSetActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await fetch(`/api/users/${id}/active`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to update status");
      }
      return res.json() as Promise<TeamMember>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const res = await fetch(`/api/users/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to remove member");
      }
      return res.json() as Promise<{ id: number }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

function memberDisplayName(member: TeamMember): string {
  return member.name || member.email || `User #${member.id}`;
}

function memberInitials(member: TeamMember): string {
  const name = memberDisplayName(member);
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export default function TeamPage() {
  const { data: me } = useMe();
  const { data: members, isLoading } = useTeamMembers();
  const updateRole = useUpdateRole();
  const setActive = useSetActive();
  const removeMember = useRemoveMember();
  const { toast } = useToast();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<
    { action: "deactivate" | "remove"; member: TeamMember } | null
  >(null);

  if (me?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        You don't have permission to view this page.
      </div>
    );
  }

  const handleToggleRole = async (member: TeamMember) => {
    const newRole = member.role === "admin" ? "user" : "admin";
    const label = newRole === "admin" ? "promoted to admin" : "demoted to user";
    setPendingId(member.id);
    try {
      await updateRole.mutateAsync({ id: member.id, role: newRole });
      toast({
        title: "Role updated",
        description: `${memberDisplayName(member)} was ${label}.`,
      });
    } catch (err: any) {
      toast({
        title: "Failed to update role",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setPendingId(null);
    }
  };

  const handleReactivate = async (member: TeamMember) => {
    setPendingId(member.id);
    try {
      await setActive.mutateAsync({ id: member.id, active: true });
      toast({
        title: "Member reactivated",
        description: `${memberDisplayName(member)} can sign in again.`,
      });
    } catch (err: any) {
      toast({
        title: "Failed to reactivate member",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setPendingId(null);
    }
  };

  const handleConfirm = async () => {
    if (!confirm) return;
    const { action, member } = confirm;
    setPendingId(member.id);
    try {
      if (action === "deactivate") {
        await setActive.mutateAsync({ id: member.id, active: false });
        toast({
          title: "Member deactivated",
          description: `${memberDisplayName(member)} can no longer sign in.`,
        });
      } else {
        await removeMember.mutateAsync({ id: member.id });
        toast({
          title: "Member removed",
          description: `${memberDisplayName(member)} was removed from the team.`,
        });
      }
    } catch (err: any) {
      toast({
        title:
          action === "deactivate"
            ? "Failed to deactivate member"
            : "Failed to remove member",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setPendingId(null);
      setConfirm(null);
    }
  };

  const adminCount = members?.filter((m) => m.role === "admin").length ?? 0;

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-4xl font-bold tracking-tight font-sans">Team</h1>
        <p className="text-muted-foreground mt-2 font-mono text-sm uppercase tracking-widest">
          Manage roles &amp; permissions
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{members?.length ?? "-"}</p>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider font-mono">Total members</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{adminCount || "-"}</p>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider font-mono">Admins</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Users className="w-4 h-4" />
            All members
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <>
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </>
          ) : members?.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4 text-center">No members found.</p>
          ) : (
            members?.map((member) => {
              const isSelf = member.id === me?.id;
              const isPending = pendingId === member.id;
              const isAdmin = member.role === "admin";
              const isDeactivated = !!member.deactivatedAt;

              return (
                <div
                  key={member.id}
                  className={`flex items-center gap-4 p-3 rounded-lg border border-border bg-card hover:bg-muted/40 transition-colors ${
                    isDeactivated ? "opacity-60" : ""
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {memberInitials(member)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">
                        {memberDisplayName(member)}
                      </span>
                      {isSelf && (
                        <span className="text-xs text-muted-foreground">(you)</span>
                      )}
                    </div>
                    {member.email && member.name && (
                      <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                    )}
                    <p
                      className="text-xs text-muted-foreground/80 mt-0.5"
                      data-testid={`last-seen-${member.id}`}
                    >
                      Last active {formatLastSeen(member.lastSeenAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isDeactivated ? (
                      <Badge
                        variant="outline"
                        className="font-mono text-xs border-destructive/50 text-destructive"
                        data-testid={`deactivated-badge-${member.id}`}
                      >
                        Deactivated
                      </Badge>
                    ) : (
                      isInactive(member.lastSeenAt) && (
                        <Badge
                          variant="outline"
                          className="font-mono text-xs border-amber-500/50 text-amber-600 dark:text-amber-400"
                          data-testid={`inactive-badge-${member.id}`}
                        >
                          Inactive
                        </Badge>
                      )
                    )}
                    <Badge
                      variant={isAdmin ? "default" : "secondary"}
                      className="capitalize font-mono text-xs"
                    >
                      {member.role}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isDeactivated ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => handleReactivate(member)}
                        className="gap-1.5 text-xs"
                        data-testid={`reactivate-${member.id}`}
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        Reactivate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isSelf || isPending}
                        onClick={() => handleToggleRole(member)}
                        className="gap-1.5 text-xs"
                        data-testid={`role-toggle-${member.id}`}
                      >
                        {isAdmin ? (
                          <>
                            <ShieldOff className="w-3.5 h-3.5" />
                            Demote
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Make admin
                          </>
                        )}
                      </Button>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={isSelf || isPending}
                          className="h-8 w-8"
                          data-testid={`member-actions-${member.id}`}
                        >
                          <MoreVertical className="w-4 h-4" />
                          <span className="sr-only">Member actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!isDeactivated && (
                          <DropdownMenuItem
                            onSelect={() =>
                              setConfirm({ action: "deactivate", member })
                            }
                            data-testid={`deactivate-${member.id}`}
                          >
                            <UserX className="w-4 h-4 mr-2" />
                            Deactivate
                          </DropdownMenuItem>
                        )}
                        {isDeactivated && (
                          <DropdownMenuItem
                            onSelect={() => handleReactivate(member)}
                            data-testid={`reactivate-menu-${member.id}`}
                          >
                            <UserCheck className="w-4 h-4 mr-2" />
                            Reactivate
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() =>
                            setConfirm({ action: "remove", member })
                          }
                          data-testid={`remove-${member.id}`}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Remove from team
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === "remove"
                ? "Remove this member?"
                : "Deactivate this member?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.action === "remove" ? (
                <>
                  {confirm
                    ? memberDisplayName(confirm.member)
                    : "This member"}{" "}
                  will be permanently removed from the team and lose access. This
                  can't be undone.
                </>
              ) : (
                <>
                  {confirm
                    ? memberDisplayName(confirm.member)
                    : "This member"}{" "}
                  will no longer be able to sign in. You can reactivate them
                  later.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              className={
                confirm?.action === "remove"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }
              data-testid="confirm-member-action"
            >
              {confirm?.action === "remove" ? "Remove" : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
