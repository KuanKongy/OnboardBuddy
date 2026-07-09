import { Loader2, Mail, Settings2, Trash2, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
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
  DialogTrigger,
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

interface Member {
  user_id: string;
  email: string;
  permission_tier: string;
  developer_role: string;
  joined_at: string;
}

interface PendingInvitation {
  id: string;
  email: string;
  permission_tier: string;
  developer_role: string | null;
  invited_by_email: string | null;
  created_at: string;
}

const roleOptions = [
  { value: "backend", label: "Backend" },
  { value: "frontend", label: "Frontend" },
  { value: "devops", label: "DevOps" },
  { value: "qa", label: "QA" },
  { value: "general", label: "General" },
];

const avatarColors = [
  "bg-blue-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-purple-500",
  "bg-rose-500",
  "bg-cyan-500",
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
  return avatarColors[Math.abs(hash) % avatarColors.length] ?? "bg-blue-500";
}

const tierBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  owner: "default",
  admin: "secondary",
  developer: "outline",
};

export function TeamPage() {
  const { project } = useProject();
  const { id } = useParams<{ id: string }>();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTier, setInviteTier] = useState("developer");
  const [inviteRole, setInviteRole] = useState("general");
  const [inviting, setInviting] = useState(false);

  const [manageMember, setManageMember] = useState<Member | null>(null);
  const [editTier, setEditTier] = useState("developer");
  const [editRole, setEditRole] = useState("general");
  const [savingMember, setSavingMember] = useState(false);

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
  useEffect(() => {
    if (!id || !canManage) return;
    apiFetch(`/projects/${id}/members/invitations`)
      .then((data: { invitations: PendingInvitation[] }) => setInvitations(data.invitations))
      .catch(() => {/* non-critical: leave invitations empty */});
  }, [id, canManage]);

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
    try {
      await apiFetch(`/projects/${id}/members/invitations/${invitationId}`, {
        method: "PATCH",
      });
      setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to revoke invitation");
    }
  }

  function openManage(member: Member) {
    setManageMember(member);
    setEditTier(member.permission_tier);
    setEditRole(member.developer_role);
  }

  async function handleUpdateMember() {
    if (!manageMember) return;
    setSavingMember(true);
    setError("");
    try {
      await apiFetch(`/projects/${id}/members/members/${manageMember.user_id}`, {
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

  async function handleRemove(userId: string) {
    try {
      await apiFetch(`/projects/${id}/members/members/${userId}`, { method: "DELETE" });
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
      setManageMember(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
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
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Team</h1>
          <p className="text-xs text-muted-foreground">
            Who has access to {project.repo_name} and their permissions
            {!loading && ` · ${members.length} member${members.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        {canManage && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <UserPlus className="h-3.5 w-3.5" />
                Invite
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-sm">Invite a team member</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-1">
                <div className="space-y-1">
                  <Label className="text-xs">Email address</Label>
                  <Input
                    type="email"
                    placeholder="colleague@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="h-8 text-[13px]"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Permission tier</Label>
                    <Select value={inviteTier} onValueChange={setInviteTier}>
                      <SelectTrigger className="h-8 text-[13px]">
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
                      <SelectTrigger className="h-8 text-[13px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roleOptions.map((r) => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => setInviteOpen(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                    {inviting && <Loader2 className="h-3 w-3 animate-spin" />}
                    Send
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {members.map((member) => (
            <Card key={member.user_id} className="group relative">
              <CardContent className="flex flex-col items-center p-3 text-center">
                {canManageMember(member) && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="absolute right-1 top-1 text-muted-foreground opacity-0 group-hover:opacity-100"
                    onClick={() => openManage(member)}
                    aria-label="Manage member"
                  >
                    <Settings2 className="h-3 w-3" />
                  </Button>
                )}
                <Avatar className="mb-1.5 h-8 w-8">
                  <AvatarFallback className={`${getAvatarColor(member.email)} text-xs font-medium text-white`}>
                    {getInitials(member.email)}
                  </AvatarFallback>
                </Avatar>
                <p className="w-full truncate text-xs font-medium text-foreground">
                  {member.email.split("@")[0]}
                </p>
                <p className="w-full truncate text-xs capitalize text-muted-foreground">
                  {member.developer_role}
                </p>
                <Badge
                  variant={tierBadgeVariant[member.permission_tier] ?? "outline"}
                  className="mt-1.5 text-[11px] capitalize"
                >
                  {member.permission_tier}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pending invitations (owner/admin) */}
      {canManage && invitations.length > 0 && (
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
                      <p className="truncate text-xs text-foreground">{inv.email}</p>
                      <p className="truncate text-xs capitalize text-muted-foreground">
                        {inv.permission_tier}
                        {inv.developer_role ? ` · ${inv.developer_role}` : ""}
                        {inv.invited_by_email ? ` · invited by ${inv.invited_by_email}` : ""}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRevoke(inv.id)}
                  >
                    <X className="h-3 w-3" />
                    Revoke
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Manage member dialog */}
      <Dialog open={manageMember !== null} onOpenChange={(open) => !open && setManageMember(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Manage {manageMember?.email.split("@")[0]}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Permission tier</Label>
                <Select value={editTier} onValueChange={setEditTier} disabled={!isOwner}>
                  <SelectTrigger className="h-8 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="developer">Developer</SelectItem>
                  </SelectContent>
                </Select>
                {!isOwner && (
                  <p className="text-[11px] text-muted-foreground">Only the owner can change tiers.</p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Developer role</Label>
                <Select value={editRole} onValueChange={setEditRole}>
                  <SelectTrigger className="h-8 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => manageMember && handleRemove(manageMember.user_id)}
              >
                <Trash2 className="h-3 w-3" />
                Remove
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setManageMember(null)}>Cancel</Button>
                <Button size="sm" onClick={handleUpdateMember} disabled={savingMember}>
                  {savingMember && <Loader2 className="h-3 w-3 animate-spin" />}
                  Save
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
