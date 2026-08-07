import { AlertTriangle, BookOpenCheck, CalendarDays, Crown, FileCheck2, Github, Loader2, LogOut, Mail, MoreVertical, RefreshCw, Trash2, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ConfirmDangerDialog } from "@/components/ConfirmDangerDialog";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { useProject } from "@/contexts/ProjectContext";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageSpinner } from "@/components/ui/page-spinner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
import { FALLBACK_ROLE, ROLE_OPTIONS, roleLabel } from "@/lib/roles";

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

interface InvitationRow {
  id: string;
  email: string;
  permission_tier: string;
  developer_role: string | null;
  invited_by_email: string | null;
  created_at: string;
  /** Null on invitations created before the TTL existed — those never expire. */
  expires_at: string | null;
  /** 'pending' | 'accepted' | 'revoked' | 'expired' | 'declined'. */
  status: string;
  /**
   * Server-computed "still redeemable": pending AND not past its TTL. Expiry is
   * not derivable here — a row can be `pending` and long dead — and the accept
   * path uses this same predicate, so it is the only honest basis for offering
   * Revoke.
   */
  live: boolean;
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

/**
 * Short labels, decided with the product owner: on the identity line the badge
 * competes with a truncating name, and "Developer" is the longest word there
 * for the least information. The stored tier stays lowercase everywhere else
 * (the profile dialog still spells it out, where there is room).
 */
const TIER_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  developer: "Dev",
};

/** The team-side word for where an invitation is in its lifecycle. */
function inviteStatusWord(inv: InvitationRow): string {
  if (inv.live) return "Invited";
  if (inv.status === "pending" || inv.status === "expired") return "Expired";
  if (inv.status === "declined") return "Declined";
  if (inv.status === "revoked") return "Revoked";
  return inv.status.charAt(0).toUpperCase() + inv.status.slice(1);
}

function inviteStatusVariant(inv: InvitationRow): "secondary" | "outline" | "warning" | "danger" {
  if (inv.live) return "secondary";
  if (inv.status === "declined") return "danger";
  if (inv.status === "revoked") return "warning";
  return "outline";
}

/** What happened and what the team can do next, from the team's side. */
function inviteStatusTooltip(inv: InvitationRow): string {
  if (inv.live) {
    return inv.expires_at
      ? `Waiting for them to respond. Expires ${fmtDate(inv.expires_at)}.`
      : "Waiting for them to respond.";
  }
  if (inv.status === "declined") return "They declined this invitation. Re-invite to send a new one, or delete the record.";
  if (inv.status === "revoked") return "You revoked this invitation. Re-invite if you change your mind, or delete the record.";
  return "It expired before they answered. Resend to give it a fresh window.";
}

export function TeamPage() {
  const { project, refetch } = useProject();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [invitationsError, setInvitationsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTier, setInviteTier] = useState("developer");
  const [inviteRole, setInviteRole] = useState<string>(FALLBACK_ROLE);
  const [inviting, setInviting] = useState(false);

  const [profileMember, setProfileMember] = useState<Member | null>(null);
  const [manageMember, setManageMember] = useState<Member | null>(null);
  const [editTier, setEditTier] = useState("developer");
  const [editRole, setEditRole] = useState<string>(FALLBACK_ROLE);
  const [savingMember, setSavingMember] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<Member | null>(null);
  const [removing, setRemoving] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [transferTarget, setTransferTarget] = useState<Member | null>(null);
  const [transferring, setTransferring] = useState(false);

  const canManage =
    project?.permission_tier === "owner" || project?.permission_tier === "admin";
  const isOwner = project?.permission_tier === "owner";
  const currentUserId = user?.id ?? null;

  useEffect(() => {
    if (!id) return;
    apiFetch(`/projects/${id}/members`)
      .then((data: { members: Member[] }) => setMembers(data.members))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  // The invitation history is an owner/admin view: they are the only ones who
  // can act on a row.
  //
  // Bug #68: this used to swallow its rejection and "leave invitations empty",
  // which hides the whole section — so a failed fetch looks exactly like
  // "nobody is waiting". An admin acting on that re-invites someone who
  // already has a pending invitation.
  const loadInvitations = useCallback(() => {
    if (!id || !canManage) return;
    apiFetch(`/projects/${id}/members/invitations`)
      .then((data: { invitations?: InvitationRow[] }) => {
        // A malformed success is a failure for Bug #68 purposes: rendering it
        // as an empty list would again look like "nobody is waiting".
        if (Array.isArray(data.invitations)) {
          setInvitations(data.invitations);
          setInvitationsError(false);
        } else {
          setInvitationsError(true);
        }
      })
      .catch(() => setInvitationsError(true));
  }, [id, canManage]);

  useEffect(() => { loadInvitations(); }, [loadInvitations]);

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setError("");
    try {
      await apiFetch(`/projects/${id}/members/invitations`, {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail,
          permission_tier: inviteTier,
          developer_role: inviteRole,
        }),
      });
      // The POST may have replaced a dead row for the same address, so only the
      // list knows what is left. Prepending the new invitation would show the
      // replaced row and its replacement side by side until the next reload.
      loadInvitations();
      setInviteEmail("");
      setInviteOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to invite");
    } finally {
      setInviting(false);
    }
  }

  // The row stays on the table after a revoke. Dropping it made the invitation
  // vanish with no trace, which is the question this page now answers ("what
  // happened to the invite I sent?") — and Re-invite has to have a row to sit on.
  async function handleRevoke(invitationId: string) {
    setRevokingId(invitationId);
    setError("");
    try {
      await apiFetch(`/projects/${id}/members/invitations/${invitationId}`, {
        method: "PATCH",
      });
      setInvitations((prev) =>
        prev.map((inv) =>
          inv.id === invitationId ? { ...inv, status: "revoked", live: false } : inv,
        ),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to revoke invitation");
    } finally {
      setRevokingId(null);
    }
  }

  // Resend never revives the row it is given: the route retires it and INSERTs a
  // fresh invitation with a NEW id. Patching state in place would leave the table
  // keyed on an id that is no longer redeemable, so the list is re-read instead.
  async function handleResend(invitationId: string) {
    setResendingId(invitationId);
    setError("");
    try {
      await apiFetch(`/projects/${id}/members/invitations/${invitationId}/resend`, {
        method: "POST",
      });
      loadInvitations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to resend invitation");
    } finally {
      setResendingId(null);
    }
  }

  // Dead rows only: the route refuses a live invitation (409, "revoke it
  // instead") so a stray click here cannot cancel someone's pending invitation
  // without them ever knowing it existed. Re-read rather than patched in place,
  // for the same reason resend does it — the row is gone server-side, and the
  // list is the only thing that knows what is left.
  async function handleDeleteInvitation(invitationId: string) {
    setDeletingId(invitationId);
    setError("");
    try {
      await apiFetch(`/projects/${id}/members/invitations/${invitationId}`, {
        method: "DELETE",
      });
      loadInvitations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete invitation");
    } finally {
      setDeletingId(null);
    }
  }

  /** Read-only: viewing a member is not gated, managing one is. */
  function openProfile(member: Member) {
    setError("");
    setProfileMember(member);
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

  // The local swap keeps the table honest without a refetch, but `refetch()` is what
  // re-reads the CALLER's tier — every owner-only control here and on settings is
  // gated on it, so without it the demoted owner keeps an owner's UI.
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

  // Removal is an owner/admin action on somebody else and refuses self-removal, so
  // leaving needs its own endpoint. The owner's way out is a transfer instead.
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
        // Leaving is a per-member action and now lives on the caller's own row,
        // next to every other thing you can do to a member.
        actions={
          canManage ? (
            <Button size="sm" onClick={() => { setError(""); setInviteOpen(true); }}>
              <UserPlus className="h-3.5 w-3.5" />
              Invite
            </Button>
          ) : undefined
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
                <Label htmlFor="invite-email" className="text-xs">Email address</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="colleague@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="h-8 text-[0.8125rem]"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="invite-tier" className="text-xs">Permission tier</Label>
                  <Select value={inviteTier} onValueChange={setInviteTier}>
                    <SelectTrigger id="invite-tier" className="h-8 text-[0.8125rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="developer">Developer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="invite-role" className="text-xs">Developer role</Label>
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger id="invite-role" className="h-8 text-[0.8125rem]">
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
              {/* No mail provider is provisioned: the invitation only surfaces once
                  the invitee signs in, so say so rather than imply an email. */}
              <p className="text-[0.6875rem] text-muted-foreground">
                No email is sent. The invitation appears on their Invitations page when they sign
                in with this address.
              </p>
              {error && <ErrorBanner>{error}</ErrorBanner>}
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

      {error && !inviteOpen && !leaveOpen && profileMember === null && manageMember === null && removeConfirm === null && transferTarget === null && (
        <ErrorBanner className="mb-3">{error}</ErrorBanner>
      )}

      {/* A four-column grid of avatar tiles spent a 1493px viewport on two
          members and still had nowhere to put what a reader wants to know
          about them. A bounded table holds the same people, their role, tier,
          when they joined, and both progress counts — approvals (editorial)
          and read marks (personal), which #74/F16 kept confusing for each
          other — and the empty two thirds of the screen stop being empty. */}
      <div className="mx-auto max-w-4xl">
      {loading ? (
        <PageSpinner className="py-12" iconClassName="h-4 w-4" label="Loading team members" />
      ) : (
        // Scrolls rather than clips: the actions column pushes the table to
        // 418px, and at 390px the old `overflow-hidden` cut the last 54px off
        // with no way to reach it — Manage and the row menu were unclickable.
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead>
              {/* Cell padding is what sets the row height: px-2 py-1.5 around a
                  size-7 avatar reproduces the sidebar account card's scale, which
                  is the density the rest of the app is read at. */}
              <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                <th scope="col" className="px-2 py-1.5 font-medium">Member</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Role</th>
                <th scope="col" className="hidden px-2 py-1.5 font-medium sm:table-cell">Joined</th>
                {/* Two columns because they are two different facts: an approval is
                    editorial, a read mark is the member's own progress. #74/F16
                    kept reading one as the other, so each header explains where
                    its number comes from.

                    Radix rather than a native `title`: the browser tooltip takes
                    about a second to appear and is unreachable from the keyboard,
                    so the explanation was effectively invisible. The trigger is a
                    span inside the th, not the th itself, so the column header's
                    accessible name stays the single word the reader scans for. */}
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0} className="cursor-help">Approvals</span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64">
                      Sections this member approved as a reviewer. It goes up when an owner or
                      admin approves a section in the reader.
                    </TooltipContent>
                  </Tooltip>
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0} className="cursor-help">Read</span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64">
                      Sections this member marked as read in the reader. It goes up as they check
                      sections off their own reading paths.
                    </TooltipContent>
                  </Tooltip>
                </th>
                <th scope="col" className="px-2 py-1.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isSelf = member.user_id === currentUserId;
                return (
                <tr
                  key={member.user_id}
                  // The row already highlights on hover, so it looked clickable
                  // while only the name was. Two guards: anything that starts on
                  // a control is that control's click, and a mouseup that ended a
                  // drag-selection is a copy, not a navigation.
                  onClick={(e) => {
                    if ((e.target as Element).closest("button,a,[role='menuitem'],[role='menu']")) return;
                    if (window.getSelection()?.toString()) return;
                    openProfile(member);
                  }}
                  className="cursor-pointer border-b border-border/60 transition-colors last:border-b-0 hover:bg-accent/50"
                >
                  <td className="px-2 py-1.5">
                    {/* The row's onClick is for the mouse; this button is the
                        accessible control, because a row-wide button cannot
                        contain the buttons in the actions cell. Viewing a
                        profile is ungated — managing is not. */}
                    <button
                      type="button"
                      aria-label={`View ${member.email}`}
                      onClick={() => openProfile(member)}
                      className="flex min-w-0 max-w-full items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Avatar className="size-7 shrink-0">
                        <AvatarFallback className={`${getAvatarColor(member.email)} text-[0.625rem] font-medium`}>
                          {getInitials(member.email)}
                        </AvatarFallback>
                      </Avatar>
                      {/* One line, not two: the tier badge sat under the name on
                          a row whose height is set by the avatar, so it bought
                          a taller row for a word that fits beside the name. */}
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="select-text truncate text-[0.8125rem] font-medium text-foreground" title={member.email}>
                          {member.email.split("@")[0]}
                        </span>
                        <Badge
                          variant={tierBadgeVariant[member.permission_tier] ?? "outline"}
                          className="shrink-0 text-[0.625rem]"
                        >
                          {TIER_LABELS[member.permission_tier] ?? member.permission_tier}
                        </Badge>
                        {isSelf && (
                          <Badge variant="secondary" className="shrink-0 text-[0.625rem]">You</Badge>
                        )}
                      </span>
                    </button>
                  </td>
                  {/* `select-text` on the data cells: the row is clickable now,
                      and these are the values someone copies out of it. */}
                  <td className="select-text whitespace-nowrap px-2 py-1.5 text-muted-foreground">{roleLabel(member.developer_role)}</td>
                  <td className="hidden select-text whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground sm:table-cell">
                    {fmtDate(member.joined_at)}
                  </td>
                  {/* Developers cannot approve a section, so a 0 here reads as a
                      failing grade for something they were never asked to do.
                      The placeholder says "not a number about you" instead. */}
                  {member.permission_tier === "developer" ? (
                    <td className="px-2 py-1.5 text-right text-muted-foreground">
                      <span aria-label="Not applicable: developers do not approve sections">—</span>
                    </td>
                  ) : (
                    <td className="select-text px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                      {member.sections_reviewed}
                    </td>
                  )}
                  <td className="select-text px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {member.sections_read}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      {isSelf ? (
                        isOwner ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {/* A disabled button fires no pointer events, so the
                                  tooltip — the only place the reason lives — needs a
                                  focusable wrapper to hang off. */}
                              <span tabIndex={0}>
                                <Button variant="outline" size="xs" disabled>
                                  <LogOut className="h-3 w-3" />
                                  Leave team
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              Transfer ownership first: a project cannot be ownerless
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={(e) => { e.stopPropagation(); setError(""); setLeaveOpen(true); }}
                          >
                            <LogOut className="h-3 w-3" />
                            Leave team
                          </Button>
                        )
                      ) : canManageMember(member) ? (
                        <>
                          <Button
                            variant="outline"
                            size="xs"
                            aria-label={`Manage ${member.email}`}
                            onClick={(e) => { e.stopPropagation(); openManage(member); }}
                          >
                            Manage
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Member actions for ${member.email}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {/* Ownership moves from here, not through the tier
                                  dropdown, which refuses to assign it. */}
                              {isOwner && (
                                <DropdownMenuItem onClick={() => { setError(""); setTransferTarget(member); }}>
                                  <Crown className="h-3 w-3" />
                                  Transfer ownership
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => { setError(""); setRemoveConfirm(member); }}
                              >
                                <Trash2 className="h-3 w-3" />
                                Remove member
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
                );
              })}
              {members.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No members yet.
                  </td>
                </tr>
              )}
              {/* Invitations continue the roster instead of sitting in a card
                  list below it: an invited person is a name this team is waiting
                  on, and the two lists were being read against each other by
                  hand. Accepted ones are skipped — that person is a member row
                  now, and showing both spells the same name twice.

                  These rows are deliberately inert: no cursor, no hover, no
                  onClick. There is no profile behind an invitation (no user
                  exists yet), so a row that highlighted would open nothing. */}
              {canManage && !invitationsError &&
                invitations
                  .filter((inv) => inv.status !== "accepted")
                  .map((inv) => (
                    <tr key={`inv:${inv.id}`} className="border-b border-border/60 last:border-b-0">
                      <td className="px-2 py-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar className="size-7 shrink-0">
                            <AvatarFallback className={`${getAvatarColor(inv.email)} text-[0.625rem] font-medium`}>
                              {getInitials(inv.email)}
                            </AvatarFallback>
                          </Avatar>
                          {/* The full address, not the local part: nobody has a
                              display name yet, and the address is the only thing
                              that identifies who was invited. */}
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              className="select-text truncate text-[0.8125rem] text-muted-foreground"
                              title={inv.email}
                            >
                              {inv.email}
                            </span>
                            <Badge
                              variant={tierBadgeVariant[inv.permission_tier] ?? "outline"}
                              className="shrink-0 text-[0.625rem]"
                            >
                              {TIER_LABELS[inv.permission_tier] ?? inv.permission_tier}
                            </Badge>
                            {/* A 'pending' row past its TTL is not pending to
                                anyone who matters: accept refuses it. `live` is
                                the server's own accept predicate, so it decides
                                the word.

                                Radix rather than a native `title`, for the same
                                reason the column headers above use one: the
                                browser tooltip takes about a second to appear
                                and is unreachable from the keyboard. The word
                                alone says what state the row is in but not what
                                to do about it, and the TTL an admin asks about
                                before nudging someone now lives in the live
                                row's tooltip. */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant={inviteStatusVariant(inv)}
                                  tabIndex={0}
                                  className="shrink-0 cursor-help text-[0.625rem]"
                                >
                                  {inviteStatusWord(inv)}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-64">
                                {inviteStatusTooltip(inv)}
                              </TooltipContent>
                            </Tooltip>
                          </span>
                        </div>
                      </td>
                      <td className="select-text whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                        {roleLabel(inv.developer_role) || "—"}
                      </td>
                      <td className="hidden select-text whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground sm:table-cell">
                        Invited {fmtDate(inv.created_at)}
                      </td>
                      {/* Approvals and read marks are member facts. Nobody has
                          read anything on an invitation. */}
                      <td className="px-2 py-1.5 text-right text-muted-foreground">—</td>
                      <td className="px-2 py-1.5 text-right text-muted-foreground">—</td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => handleResend(inv.id)}
                            disabled={resendingId === inv.id}
                          >
                            {resendingId === inv.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <RefreshCw className="h-3 w-3" />}
                            {/* Same route either way; the word tracks what the
                                admin thinks they are doing to a live invitation
                                versus a dead one. */}
                            {inv.live ? "Resend" : "Re-invite"}
                          </Button>
                          {inv.live ? (
                            <Button
                              variant="ghost"
                              size="xs"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => handleRevoke(inv.id)}
                              disabled={revokingId === inv.id}
                            >
                              {revokingId === inv.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <X className="h-3 w-3" />}
                              Revoke
                            </Button>
                          ) : (
                            // No confirmation, matching Revoke's immediacy next to
                            // it: the invitation is already dead, and Re-invite on
                            // the same row rebuilds it if this was a mistake.
                            <Button
                              variant="ghost"
                              size="xs"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteInvitation(inv.id)}
                              disabled={deletingId === inv.id}
                            >
                              {deletingId === inv.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Trash2 className="h-3 w-3" />}
                              Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
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
            Couldn&apos;t load this project&apos;s invitations. Don&apos;t re-invite anyone until
            this loads. There may already be an invitation waiting.
          </p>
          <Button variant="outline" size="xs" className="shrink-0 gap-1.5" onClick={loadInvitations}>
            <RefreshCw className="h-3 w-3" /> Retry
          </Button>
        </div>
      )}

      </div>

      {/* Read-only profile: everyone can open everyone. Nothing here is a
          control, so no tier check has to be made about what to hide. */}
      <Dialog
        open={profileMember !== null}
        onOpenChange={(open) => {
          if (!open) { setProfileMember(null); setError(""); }
        }}
      >
        {/* `gap-2`: the content is a list of one-line facts, and the grid's
            default gap-4 opened a gap under the title wider than the rows it
            separates. `aria-describedby={undefined}` tells Radix there is
            deliberately no description element, instead of it warning about one. */}
        <DialogContent className="gap-2 sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Avatar className="h-7 w-7">
                <AvatarFallback className={`${getAvatarColor(profileMember?.email ?? "")} text-[0.6875rem] font-medium`}>
                  {getInitials(profileMember?.email ?? "")}
                </AvatarFallback>
              </Avatar>
              {profileMember?.email.split("@")[0]}
              <Badge
                variant={tierBadgeVariant[profileMember?.permission_tier ?? ""] ?? "outline"}
                className="text-[0.6875rem] capitalize"
              >
                {profileMember?.permission_tier}
              </Badge>
            </DialogTitle>
          </DialogHeader>
          {profileMember && (
            <div className="space-y-1.5 pt-1 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-foreground" title={profileMember.email}>{profileMember.email}</span>
              </div>
              {profileMember.github_username && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Github className="h-3.5 w-3.5 shrink-0" />
                  <a
                    href={`https://github.com/${profileMember.github_username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground hover:underline"
                  >
                    @{profileMember.github_username}
                  </a>
                </div>
              )}
              <div className="flex items-center gap-2 text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Joined{" "}
                  {new Date(profileMember.joined_at).toLocaleDateString(undefined, {
                    year: "numeric", month: "long", day: "numeric",
                  })}
                </span>
              </div>
              {/* Same reason the table shows a placeholder for them: a developer
                  has no approvals to report, and "0 sections approved" reads as
                  a shortfall rather than a role. */}
              {profileMember.permission_tier !== "developer" && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <FileCheck2 className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {profileMember.sections_reviewed} section{profileMember.sections_reviewed === 1 ? "" : "s"} approved
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 text-muted-foreground">
                <BookOpenCheck className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {profileMember.sections_read} section{profileMember.sections_read === 1 ? "" : "s"} marked read
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Management modal: only ever opened from a row whose Manage button
          `canManageMember` already gated, so it carries no fallback branch. */}
      <Dialog
        open={manageMember !== null}
        onOpenChange={(open) => {
          if (!open) { setManageMember(null); setError(""); }
        }}
      >
        <DialogContent className="gap-2 sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-sm">Manage member</DialogTitle>
          </DialogHeader>
          {manageMember && (
            <div className="space-y-3 pt-1">
              {/* The same icon row the profile dialog uses for an address: a bare
                  grey line here read as a caption on the title rather than as
                  the member this dialog is about. */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-foreground" title={manageMember.email}>
                  {manageMember.email}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="member-tier" className="text-xs">Permission tier</Label>
                  <Select value={editTier} onValueChange={setEditTier} disabled={!isOwner}>
                    <SelectTrigger id="member-tier" className="h-8 w-full text-[0.8125rem]">
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
                  <Label htmlFor="member-role" className="text-xs">Developer role</Label>
                  <Select value={editRole} onValueChange={setEditRole}>
                    <SelectTrigger id="member-role" className="h-8 w-full text-[0.8125rem]">
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
              {error && <ErrorBanner>{error}</ErrorBanner>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setManageMember(null); setError(""); }}>Cancel</Button>
                <Button size="sm" onClick={handleUpdateMember} disabled={savingMember}>
                  {savingMember && <Loader2 className="h-3 w-3 animate-spin" />}
                  Save
                </Button>
              </div>
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
          {error && <ErrorBanner>{error}</ErrorBanner>}
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

      {/* Type-to-confirm: afterwards the caller is an admin and only the new owner
          can hand it back, so this is the one action here they cannot undo. */}
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

      {/* Plain confirm rather than type-to-confirm: nothing is destroyed and the
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
          {error && <ErrorBanner>{error}</ErrorBanner>}
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
