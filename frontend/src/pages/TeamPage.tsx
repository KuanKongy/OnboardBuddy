import { Loader2, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useProject } from "@/contexts/ProjectContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { apiFetch } from "@/lib/api";

interface Member {
  user_id: string;
  email: string;
  permission_tier: string;
  developer_role: string;
  joined_at: string;
}

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

export function TeamPage() {
  const { project } = useProject();
  const { id } = useParams<{ id: string }>();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTier, setInviteTier] = useState("developer");
  const [inviteRole, setInviteRole] = useState("general");
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (!id) return;
    apiFetch(`/projects/${id}/members`)
      .then((data: { members: Member[] }) => setMembers(data.members))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const canManage =
    project?.permission_tier === "owner" || project?.permission_tier === "admin";

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await apiFetch(`/projects/${id}/members/invitations`, {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail,
          permission_tier: inviteTier,
          developer_role: inviteRole,
        }),
      });
      setInviteEmail("");
      setInviteOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to invite");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(userId: string) {
    try {
      await apiFetch(`/projects/${id}/members/members/${userId}`, { method: "DELETE" });
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  if (!project) return null;

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Team</h1>
          <p className="text-xs text-muted-foreground">
            {project.repo_name}
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
                        <SelectItem value="backend">Backend</SelectItem>
                        <SelectItem value="frontend">Frontend</SelectItem>
                        <SelectItem value="devops">DevOps</SelectItem>
                        <SelectItem value="qa">QA</SelectItem>
                        <SelectItem value="general">General</SelectItem>
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
            <Card key={member.user_id} className="group">
              <CardContent className="flex flex-col items-center p-3 text-center">
                <Avatar className="mb-1.5 h-8 w-8">
                  <AvatarFallback className={`${getAvatarColor(member.email)} text-[11px] font-medium text-white`}>
                    {getInitials(member.email)}
                  </AvatarFallback>
                </Avatar>
                <p className="w-full truncate text-xs font-medium text-foreground">
                  {member.email.split("@")[0]}
                </p>
                <p className="w-full truncate text-[11px] capitalize text-muted-foreground">
                  {member.developer_role}
                </p>
                {canManage && member.permission_tier !== "owner" && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="mt-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemove(member.user_id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
