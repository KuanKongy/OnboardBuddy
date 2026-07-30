import { AlertTriangle, BookOpenCheck, CalendarDays, Crown, FileCheck2, Github, Loader2, LogOut, Mail, RefreshCw, Trash2, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ConfirmDangerDialog } from "@/components/ConfirmDangerDialog";
import { PageHeader } from "@/components/PageHeader";
import { useProject } from "@/contexts/ProjectContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { apiFetch } from "@/lib/api";
import { FALLBACK_ROLE, ROLE_OPTIONS } from "@/lib/roles";

interface Member {
  user_id: string;
  email: string;
  permission_tier: string;
  developer_role: string;
  joined_at: string;
  github_username: string | null;
  /** Editorial: sections this member approved (owner/admin action). */
  sections_reviewed: number;
  /** Personal: sections this member marked as read in the reader (any tier). */
  sections_read: number;
}

interface PendingInvitation {
  id: string;
  email: string;
  permission_tier: string;
  developer_role: string | null;
  invited_by_email: string | null;
  created_at: string;
  /** #74/B4: null on invitations created before the 14-day TTL — those never expire. */
  expires_at: string | null;
}

/**
 * Low-saturation tints drawn from the app's own semantic tokens.
 *
 * The six fully saturated Tailwind swatches this replaces (blue-500,
 * amber-500, emerald-500, rose-500…) were the loudest colour on any screen in
 * the product, and four of them sat side by side in a viewport that was
 * otherwise empty. Identity still varies per member; the volume does not.
 */
const avatarTints = [
  "bg-primary/15 text-primary",
  "bg-info/15 text-info",
  "bg-success/15 text-success",
  "bg-warning/15 text-warning",
  "bg-muted text-muted-foreground",
];

function getInitials(email: string): string {
  const name = email.split("@")[0] ?? email;
  return name.slice(0, 2).toUpperCase();
}

function getAvatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarTints[Math.abs(hash) % avatarTints.length] ?? avatarTints[0]!;
}

/** "2026-03-04T…" → "4 Mar 2026". Empty for an unparseable value. */
function fmtDate(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const tierBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  owner: "default",
  admin: "secondary",
  developer: "outline",
};

export function TeamPage() {
  const { project, refetch } = useProject();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [invitationsError, setInvitationsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTier, setInviteTier] = useState("developer");
  const [inviteRole, setInviteRole] = useState<string>(FALLBACK_ROLE);
  const [inviting, setInviting] = useState(false);

  const [manageMember, setManageMember] = useState<Member | null>(null);
  const [editTier, setEditTier] = useState("developer");
  const [editRole, setEditRole] = useState<string>(FALLBACK_ROLE);
  const [savingMember, setSavingMember] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<Member | null>(null);
  const [removing, setRemoving] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [transferTarget, setTransferTarget] = useState<Member | null>(null);
  const [transferring, setTransferring] = useState(false);

  const canManage =
    project?.permission_tier === "owner" || project?.permission_tier === "admin";
  const isOwner = project?.permission_tier === "owner";

  useEffect(() => {
    if (!id) return;
    apiFetch(`/projects/${id}/members`)
      .then((data: { members: Member[] }) => setMembers(data.members))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Pending invitations are only actionable by owner/admin.
  //
  // Bug #68: this used to swallow its rejection and "leave invitations empty",
  // which hides the whole section — so a failed fetch looks exactly like
  // "nobody is waiting". An admin acting on that re-invites someone who
  // already has a pending invitation.
  const loadInvitations = useCallback(() => {
    if (!id || !canManage) return;
    apiFetch(`/projects/${id}/members/invitations`)
      .then((data: { invitations: PendingInvitation[] }) => {
        setInvitations(data.invitations);
        setInvitationsError(false);
      })
      .catch(() => setInvitationsError(true));
  }, [id, canManage]);

  useEffect(() => { loadInvitations(); }, [loadInvitations]);

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setError("");
    try {
      const data = await apiFetch(`/projects/${id}/members/invitations`, {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail,
          permission_tier: inviteTier,
          developer_role: inviteRole,
        }),
      }) as { invitation: PendingInvitation };
      setInvitations((prev) => [data.invitation, ...prev]);
      setInviteEmail("");
      setInviteOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to invite");
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(invitationId: string) {
    setRevokingId(invitationId);
    try {
      await apiFetch(`/projects/${id}/members/invitations/${invitationId}`, {
        method: "PATCH",
      });
      setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to revoke invitation");
    } finally {
      setRevokingId(null);
    }
  }

  function openManage(member: Member) {
    setError("");
    setManageMember(member);
    setEditTier(member.permission_tier);
    setEditRole(member.developer_role);
  }

  async function handleUpdateMember() {
    if (!manageMember) return;
    setSavingMember(true);
    setError("");
    try {
      await apiFetch(`/projects/${id}/members/${manageMember.user_id}`, {
        method: "PATCH",
        body: JSON.stringify({ permission_tier: editTier, developer_role: editRole }),
      });
      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === manageMember.user_id
            ? { ...m, permission_tier: editTier, developer_role: editRole }
            : m,
        ),
      );
      setManageMember(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update member");
    } finally {
      setSavingMember(false);
    }
  }

  async function handleRemove(member: Member) {
    setRemoving(true);
    setError("");
    try {
      await apiFetch(`/projects/${id}/members/${member.user_id}`, { method: "DELETE" });
      setMembers((prev) => prev.filter((m) => m.user_id !== member.user_id));
      setManageMember(null);
      setRemoveConfirm(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setRemoving(false);
    }
  }

  // Bug #72: ownership had no way to move, so the only exit for an owner was
  // deleting the project. Both tiers swap in one request; the local swap keeps
  // the table honest without a refetch, and `refetch()` re-reads the CALLER's
  // tier — every owner-only control on this page (and the danger zone on
  // settings) is gated on it, so without that the demoted owner keeps an
  // owner's UI until the next full page load.
  async function handleTransfer(member: Member) {
    setTransferring(true);
    setError("");
    try {
      await apiFetch(`/projects/${id}/members/${member.user_id}/transfer-ownership`, {
        method: "POST",
      });
      setMembers((prev) =>
        prev.map((m) => {
          if (m.user_id === member.user_id) return { ...m, permission_tier: "owner" };
          if (m.permission_tier === "owner") return { ...m, permission_tier: "admin" };
          return m;
        }),
      );
      setTransferTarget(null);
      setManageMember(null);
      refetch();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to transfer ownership");
    } finally {
      setTransferring(false);
    }
  }

  // Bug #72: a member could not get out of a project — removal is an
  // owner/admin action on somebody else, and it refuses self-removal. The
  // owner's way out is a transfer, so they get no button here.
  async function handleLeave() {
    setLeaving(true);
    setError("");
    try {
      await apiFetch(`/projects/${id}/members/me`, { method: "DELETE" });
      navigate("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to leave the project");
    } finally {
      setLeaving(false);
    }
  }

  // Backend: owners manage anyone but the owner; admins manage developers only.
  function canManageMember(member: Member): boolean {
    if (!canManage || member.permission_tier === "owner") return false;
    return isOwner || member.permission_tier === "developer";
  }

  if (!project) return null;

  return (
    <div>
      <PageHeader
        title="Team"
        subtitle={`Who has access to ${project.repo_name} and their permissions${
          !loading ? ` · ${members.length} member${members.length !== 1 ? "s" : ""}` : ""
        }`}
        actions={
          <>
            {canManage && (
              <Button size="sm" onClick={() => { setError(""); setInviteOpen(true); }}>
                <UserPlus className="h-3.5 w-3.5" />
                Invite
              </Button>
            )}
            {!isOwner && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setError(""); setLeaveOpen(true); }}
              >
                <LogOut className="h-3.5 w-3.5" />
                Leave project
              </Button>
            )}
          </>
        }
      />

      {canManage && (
        <Dialog
          open={inviteOpen}
          onOpenChange={(open) => {
            setInviteOpen(open);
            if (!open) setError("");
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">Invite a team member</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-3 pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                handleInvite();
              }}
            >
              <div className="space-y-1">
                <Label className="text-xs">Email address</Label>
                <Input
                  type="email"
                  placeholder="colleague@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="h-8 text-[0.8125rem]"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Permission tier</Label>
                  <Select value={inviteTier} onValueChange={setInviteTier}>
                    <SelectTrigger className="h-8 text-[0.8125rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="developer">Developer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Developer role</Label>
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger className="h-8 text-[0.8125rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-[0.6875rem] text-muted-foreground">
                Permission tier controls what they can manage; developer role tailors their onboarding content by specialty.
              </p>
              {/* #74/W1: no mail provider is provisioned, so "Send" was a lie —
                  the invitation only surfaces once the invitee signs in with
                  this address. Say so rather than leave them waiting on mail. */}
              <p className="text-[0.6875rem] text-muted-foreground">
                No email is sent — the invitation appears on their Invitations page when they sign
                in with this address.
              </p>
              {error && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setInviteOpen(false); setError(""); }}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={inviting || !inviteEmail.trim()}>
                  {inviting && <Loader2 className="h-3 w-3 animate-spin" />}
                  Create invitation
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {error && !inviteOpen && !leaveOpen && manageMember === null && removeConfirm === null && transferTarget === null && (
        <div className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* A four-column grid of avatar tiles spent a 1493px viewport on two
          members and still had nowhere to put what a reader wants to know
          about them. A bounded table holds the same people, their role, tier,
          when they joined, and both progress counts — approvals (editorial)
          and read marks (personal), which #74/F16 kept confusing for each
          other — and the empty two thirds of the screen stop being empty. */}
      <div className="mx-auto max-w-2xl">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">Member</th>
                <th scope="col" className="px-3 py-2 font-medium">Role</th>
                <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Joined</th>
                {/* Two columns because they are two different facts, and the
                    titles say which is which — an approval is editorial, a read
                    mark is the member's own progress (#74/F16). */}
                <th
                  scope="col"
                  className="px-3 py-2 text-right font-medium"
                  title="Sections this member approved (owner/admin review)"
                >
                  Approvals
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-right font-medium"
                  title="Sections this member marked as read in the reader"
                >
                  Read
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr
                  key={member.user_id}
                  // Every member opens the detail modal — management controls
                  // inside are permission-gated, viewing details is not.
                  tabIndex={0}
                  role="button"
                  aria-label={`View ${member.email}`}
                  onClick={() => openManage(member)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openManage(member); }
                  }}
                  className="cursor-pointer border-b border-border/60 transition-colors last:border-b-0 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                >
                  <td className="px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar className="h-6 w-6 shrink-0">
                        <AvatarFallback className={`${getAvatarColor(member.email)} text-[0.625rem] font-medium`}>
                          {getInitials(member.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground" title={member.email}>
                          {member.email.split("@")[0]}
                        </p>
                        <Badge
                          variant={tierBadgeVariant[member.permission_tier] ?? "outline"}
                          className="mt-0.5 text-[0.625rem] capitalize"
                        >
                          {member.permission_tier}
                        </Badge>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 capitalize text-muted-foreground">{member.developer_role}</td>
                  <td className="hidden px-3 py-2 tabular-nums text-muted-foreground sm:table-cell">
                    {fmtDate(member.joined_at)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {member.sections_reviewed}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {member.sections_read}
                  </td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    No members yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {canManage && invitationsError && (
        <div
          className="mt-5 flex items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2"
          role="alert"
        >
          <p className="text-xs text-danger">
            <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
            Couldn&apos;t load pending invitations. Don&apos;t re-invite anyone until this loads —
            there may already be an invitation waiting.
          </p>
          <Button variant="outline" size="xs" className="shrink-0 gap-1.5" onClick={loadInvitations}>
            <RefreshCw className="h-3 w-3" /> Retry
          </Button>
        </div>
      )}

      {/* Pending invitations (owner/admin) */}
      {canManage && !invitationsError && invitations.length > 0 && (
        <div className="mt-5">
          <h2 className="mb-2 text-xs font-medium text-muted-foreground">
            Pending invitations · {invitations.length}
          </h2>
          <div className="space-y-1.5">
            {invitations.map((inv) => (
              <Card key={inv.id}>
                <CardContent className="flex items-center justify-between gap-2 p-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-xs text-foreground" title={inv.email}>{inv.email}</p>
                      <p
                        className="truncate text-xs capitalize text-muted-foreground"
                        title={`${inv.permission_tier}${
                          inv.developer_role ? ` · ${inv.developer_role}` : ""
                        }${inv.invited_by_email ? ` · invited by ${inv.invited_by_email}` : ""}`}
                      >
                        {inv.permission_tier}
                        {inv.developer_role ? ` · ${inv.developer_role}` : ""}
                        {inv.invited_by_email ? ` · invited by ${inv.invited_by_email}` : ""}
                      </p>
                      {/* Invitations now expire (#74/B4), and a pending row that
                          nobody can redeem is indistinguishable from a fresh one
                          without the date. Older rows carry no expiry and say
                          nothing rather than guess one. */}
                      {inv.expires_at && (
                        <p className="truncate text-xs text-muted-foreground">
                          Expires {fmtDate(inv.expires_at)}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRevoke(inv.id)}
                    disabled={revokingId === inv.id}
                  >
                    {revokingId === inv.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <X className="h-3 w-3" />}
                    Revoke
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
      </div>

      {/* Member detail dialog: profile info for everyone, management
          controls only when the caller may manage this member. */}
      <Dialog
        open={manageMember !== null}
        onOpenChange={(open) => {
          if (!open) { setManageMember(null); setError(""); }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Avatar className="h-7 w-7">
                <AvatarFallback className={`${getAvatarColor(manageMember?.email ?? "")} text-[0.6875rem] font-medium`}>
                  {getInitials(manageMember?.email ?? "")}
                </AvatarFallback>
              </Avatar>
              {manageMember?.email.split("@")[0]}
              <Badge
                variant={tierBadgeVariant[manageMember?.permission_tier ?? ""] ?? "outline"}
                className="text-[0.6875rem] capitalize"
              >
                {manageMember?.permission_tier}
              </Badge>
            </DialogTitle>
          </DialogHeader>
          {manageMember && (
            <div className="space-y-3 pt-1">
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate text-foreground" title={manageMember.email}>{manageMember.email}</span>
                </div>
                {manageMember.github_username && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Github className="h-3.5 w-3.5 shrink-0" />
                    <a
                      href={`https://github.com/${manageMember.github_username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground hover:underline"
                    >
                      @{manageMember.github_username}
                    </a>
                  </div>
                )}
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Joined{" "}
                    {new Date(manageMember.joined_at).toLocaleDateString(undefined, {
                      year: "numeric", month: "long", day: "numeric",
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <FileCheck2 className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {manageMember.sections_reviewed} section{manageMember.sections_reviewed === 1 ? "" : "s"} approved
                  </span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <BookOpenCheck className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {manageMember.sections_read} section{manageMember.sections_read === 1 ? "" : "s"} marked read
                  </span>
                </div>
              </div>

              {canManageMember(manageMember) ? (
                <>
                  <Separator />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Permission tier</Label>
                      <Select value={editTier} onValueChange={setEditTier} disabled={!isOwner}>
                        <SelectTrigger className="h-8 w-full text-[0.8125rem]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="developer">Developer</SelectItem>
                        </SelectContent>
                      </Select>
                      {!isOwner && (
                        <p className="text-[0.6875rem] text-muted-foreground">Only the owner can change tiers.</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Developer role</Label>
                      <Select value={editRole} onValueChange={setEditRole}>
                        <SelectTrigger className="h-8 w-full text-[0.8125rem]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((r) => (
                            <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => { setError(""); setRemoveConfirm(manageMember); }}
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove
                      </Button>
                      {/* Owner-only, and never on the owner's own row — the
                          backend answers both cases 403/400, but the point is
                          that ownership moves from here rather than through the
                          tier dropdown, which refuses to assign it (#72). */}
                      {isOwner && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setError(""); setTransferTarget(manageMember); }}
                        >
                          <Crown className="h-3 w-3" />
                          Transfer ownership
                        </Button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setManageMember(null); setError(""); }}>Cancel</Button>
                      <Button size="sm" onClick={handleUpdateMember} disabled={savingMember}>
                        {savingMember && <Loader2 className="h-3 w-3 animate-spin" />}
                        Save
                      </Button>
                    </div>
                  </div>
                  {error && (
                    <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {error}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[0.6875rem] text-muted-foreground">
                  {manageMember.permission_tier === "owner"
                    ? "The project owner can't be modified."
                    : "You don't have permission to manage this member."}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Remove-member confirmation: a themed Dialog instead of
          window.confirm, matching ProjectSettingsPage's delete-project
          convention (Cancel/destructive-confirm buttons, inline error slot). */}
      <Dialog
        open={removeConfirm !== null}
        onOpenChange={(open) => {
          if (!open) { setRemoveConfirm(null); setError(""); }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Remove member</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Remove <span className="font-medium text-foreground">{removeConfirm?.email}</span> from this project? This can't be undone.
          </p>
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setRemoveConfirm(null); setError(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={removing}
              onClick={() => removeConfirm && handleRemove(removeConfirm)}
            >
              {removing && <Loader2 className="h-3 w-3 animate-spin" />}
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transfer is the one action on this page that cannot be undone by the
          person taking it — afterwards the caller is an admin and only the new
          owner can hand it back — so it gets the type-to-confirm treatment the
          project delete uses. */}
      <ConfirmDangerDialog
        open={transferTarget !== null}
        onOpenChange={(open) => { if (!open) { setTransferTarget(null); setError(""); } }}
        title="Transfer ownership"
        description={
          <>
            Make <span className="font-medium text-foreground">{transferTarget?.email}</span> the
            owner of {project.repo_name}? You will become an admin. Type{" "}
            <span className="font-mono font-medium text-foreground">{project.repo_name}</span> to confirm.
          </>
        }
        confirmWord={project.repo_name}
        confirmLabel="Transfer ownership"
        pending={transferring}
        error={error}
        onConfirm={() => transferTarget && handleTransfer(transferTarget)}
      />

      {/* Leave confirmation: same shape as remove-member. Deliberately a plain
          confirm rather than type-to-confirm — nothing is destroyed, and the
          member can be re-invited. */}
      <Dialog
        open={leaveOpen}
        onOpenChange={(open) => { if (!leaving) { setLeaveOpen(open); if (!open) setError(""); } }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Leave project</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Leave <span className="font-medium text-foreground">{project.repo_name}</span>? You'll
            lose access to its onboarding content until someone invites you back. Sections you
            approved and your reading progress are kept.
          </p>
          {error && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={leaving} onClick={() => { setLeaveOpen(false); setError(""); }}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" disabled={leaving} onClick={handleLeave}>
              {leaving && <Loader2 className="h-3 w-3 animate-spin" />}
              Leave project
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
