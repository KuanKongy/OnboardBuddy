import { CheckCircle, Loader2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BackLink } from "@/components/BackLink";
import { PageHeader } from "@/components/PageHeader";
import { apiFetch } from "@/lib/api";
import { FALLBACK_ROLE, ROLE_OPTIONS } from "@/lib/roles";

interface Invitation {
  id: string;
  project_id: string;
  repo_owner: string;
  repo_name: string;
  permission_tier: string;
  developer_role: string | null;
  invited_by_email: string;
  status: string;
}

export function InvitationsPage() {
  const navigate = useNavigate();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>(FALLBACK_ROLE);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    apiFetch("/invitations")
      .then((data: { invitations: Invitation[] }) => {
        setInvitations(data.invitations);
        const first = data.invitations[0];
        if (first) setSelectedId(first.id);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const selected = invitations.find((inv) => inv.id === selectedId);

  function selectInvitation(inv: Invitation) {
    setSelectedId(inv.id);
    if (inv.developer_role) setSelectedRole(inv.developer_role);
  }

  async function handleAccept(invitation: Invitation) {
    setAccepting(true);
    try {
      await apiFetch(`/invitations/${invitation.id}/accept`, {
        method: "POST",
        body: JSON.stringify({ developer_role: selectedRole }),
      });
      navigate(`/projects/${invitation.project_id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to accept invitation");
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Pending Invitations"
        subtitle="Project invitations from teammates, waiting for you to accept."
        actions={<BackLink />}
      />

      {error && (
        <div className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {invitations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <Users className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">No pending invitations</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            New invitations from project owners will appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[280px_1fr]">
          {/* Left panel */}
          <div className="space-y-2">
            <p className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
              Active Invitations ({invitations.length})
            </p>
            {invitations.map((inv) => (
              <Card
                key={inv.id}
                role="button"
                tabIndex={0}
                aria-pressed={selectedId === inv.id}
                className={`cursor-pointer transition-colors ${
                  selectedId === inv.id
                    ? "border-primary bg-primary/5"
                    : "hover:border-border/80"
                }`}
                onClick={() => selectInvitation(inv)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectInvitation(inv);
                  }
                }}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[0.8125rem] font-medium text-foreground">{inv.repo_name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Invited by {inv.invited_by_email || "a team member"}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-[0.6875rem] capitalize">
                      {inv.permission_tier}
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[0.6875rem]">Pending</Badge>
                    <Badge variant="outline" className="text-[0.6875rem] capitalize">
                      {inv.developer_role
                        ? `${inv.developer_role} role`
                        : "Role not selected"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Right panel */}
          {selected && (
            <Card>
              <CardContent className="p-4">
                <h2 className="text-sm font-semibold text-foreground">
                  Join {selected.repo_name}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Select your role to continue.
                </p>

                <div className="mt-3 flex gap-3">
                  <div className="flex-1 rounded-md border border-border bg-card p-2">
                    <p className="text-[0.6875rem] text-muted-foreground">Permission</p>
                    <p className="text-xs font-medium capitalize text-foreground">
                      {selected.permission_tier}
                    </p>
                  </div>
                  <div className="flex-1 rounded-md border border-border bg-card p-2">
                    <p className="text-[0.6875rem] text-muted-foreground">Organization</p>
                    <p className="text-xs font-medium text-foreground">{selected.repo_owner}</p>
                  </div>
                </div>

                <Separator className="my-3" />
                {selected.developer_role ? (
                  // Inviter preassigned the role — show it read-only (design: "read-only or omitted").
                  <>
                    <p className="mb-2 text-xs font-medium text-foreground">Developer Role</p>
                    {(() => {
                      const role = ROLE_OPTIONS.find((r) => r.value === selected.developer_role);
                      return (
                        <div className="flex w-full items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
                          <span className="text-xs font-medium capitalize text-foreground">
                            {role?.title ?? selected.developer_role}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {role?.description ?? "Assigned by inviter"}
                          </span>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <>
                    <p className="mb-2 text-xs font-medium text-foreground">Select Developer Role</p>
                    <div className="space-y-1.5">
                      {ROLE_OPTIONS.map((role) => (
                        <button
                          key={role.value}
                          type="button"
                          onClick={() => setSelectedRole(role.value)}
                          className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ${
                            selectedRole === role.value
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-border/80 hover:bg-accent/50"
                          }`}
                        >
                          <span className="text-xs font-medium text-foreground">{role.title}</span>
                          <span className="text-xs text-muted-foreground">{role.description}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div className="mt-4 flex justify-end gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0} className="inline-flex">
                        <Button variant="outline" size="sm" disabled>
                          Decline
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64">
                      Declining isn't supported yet — this invitation stays pending. Ask the
                      inviter to cancel it if you don't want to join.
                    </TooltipContent>
                  </Tooltip>
                  <Button size="sm" disabled={accepting} onClick={() => handleAccept(selected)}>
                    {accepting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <CheckCircle className="h-3 w-3" />
                    )}
                    Join Project
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
