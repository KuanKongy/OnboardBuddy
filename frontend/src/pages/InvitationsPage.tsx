import { CheckCircle, Loader2, Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { apiFetch } from "@/lib/api";

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

const roleOptions = [
  { value: "backend", label: "Backend Developer", tech: "Node.js, PostgreSQL" },
  { value: "frontend", label: "Frontend Developer", tech: "React, Tailwind" },
  { value: "devops", label: "DevOps Engineer", tech: "AWS, CI/CD" },
  { value: "qa", label: "QA Automation", tech: "Jest, Playwright" },
  { value: "general", label: "General / Fullstack", tech: "End to end" },
];

export function InvitationsPage() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>("general");
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

  async function handleAccept(id: string) {
    setAccepting(true);
    try {
      await apiFetch(`/invitations/${id}/accept`, {
        method: "POST",
        body: JSON.stringify({ developer_role: selectedRole }),
      });
      setInvitations((prev) => prev.filter((inv) => inv.id !== id));
      setSelectedId(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to accept invitation");
    } finally {
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
      <div className="mb-3 flex items-center gap-2">
        <Button variant="ghost" size="xs" className="text-muted-foreground" asChild>
          <a href="/dashboard">&larr; Back</a>
        </Button>
        <h1 className="text-lg font-semibold text-foreground">Pending Invitations</h1>
      </div>

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
            Sync with your organization to find more
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[280px_1fr]">
          {/* Left panel */}
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Active Invitations ({invitations.length})
            </p>
            {invitations.map((inv) => (
              <Card
                key={inv.id}
                className={`cursor-pointer transition-colors ${
                  selectedId === inv.id
                    ? "border-primary bg-primary/5"
                    : "hover:border-border/80"
                }`}
                onClick={() => {
                  setSelectedId(inv.id);
                  if (inv.developer_role) setSelectedRole(inv.developer_role);
                }}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[13px] font-medium text-foreground">{inv.repo_name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Invited by {inv.invited_by_email || "a team member"}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-[10px] capitalize">
                      {inv.permission_tier}
                    </Badge>
                  </div>
                  <Badge variant="outline" className="mt-1.5 text-[10px]">Pending</Badge>
                </CardContent>
              </Card>
            ))}

            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center p-3 text-center">
                <Plus className="mb-0.5 h-4 w-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Looking for more?</p>
                <p className="text-[11px] text-muted-foreground">Sync with your org</p>
              </CardContent>
            </Card>
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
                    <p className="text-[10px] text-muted-foreground">Permission</p>
                    <p className="text-xs font-medium capitalize text-foreground">
                      {selected.permission_tier}
                    </p>
                  </div>
                  <div className="flex-1 rounded-md border border-border bg-card p-2">
                    <p className="text-[10px] text-muted-foreground">Organization</p>
                    <p className="text-xs font-medium text-foreground">{selected.repo_owner}</p>
                  </div>
                </div>

                {!selected.developer_role && (
                  <>
                    <Separator className="my-3" />
                    <p className="mb-2 text-xs font-medium text-foreground">Select Developer Role</p>
                    <div className="space-y-1.5">
                      {roleOptions.map((role) => (
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
                          <span className="text-xs font-medium text-foreground">{role.label}</span>
                          <span className="text-[11px] text-muted-foreground">{role.tech}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setInvitations((prev) => prev.filter((inv) => inv.id !== selected.id));
                      setSelectedId(null);
                    }}
                  >
                    Decline
                  </Button>
                  <Button size="sm" disabled={accepting} onClick={() => handleAccept(selected.id)}>
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
