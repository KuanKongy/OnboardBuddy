import { CheckCircle, Loader2, Trash2, Users, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageSpinner } from "@/components/ui/page-spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BackLink } from "@/components/BackLink";
import { PageHeader } from "@/components/PageHeader";
import { apiFetch } from "@/lib/api";
import { FALLBACK_ROLE, ROLE_OPTIONS, roleLabel } from "@/lib/roles";

interface Invitation {
  id: string;
  project_id: string;
  repo_owner: string;
  repo_name: string;
  permission_tier: string;
  developer_role: string | null;
  invited_by_email: string;
  /** 'pending' | 'accepted' | 'revoked' | 'expired' | 'declined'. */
  status: string;
  /**
   * Server-computed "still acceptable": pending AND not past its TTL. Expiry
   * cannot be derived from `status` — an untouched invitation stays 'pending'
   * forever — and this is the accept route's own predicate, so it is what
   * decides whether Accept is offered at all.
   */
  live: boolean;
  created_at?: string;
}

/**
 * The word on the badge. `status` alone cannot say "expired": nothing rewrites
 * a pending row when its TTL passes, so the live flag is what separates an
 * invitation you can still take from one that quietly ran out.
 */
function statusWord(inv: Invitation): string {
  if (inv.live) return "Pending";
  if (inv.status === "pending") return "Expired";
  return inv.status;
}

/** What the pane says where the buttons would be, once nothing can be done. */
function closedStateLine(inv: Invitation): string {
  if (inv.status === "accepted") return "You already accepted this invitation. The project is on your dashboard.";
  if (inv.status === "declined") return "You declined this invitation. Ask an owner or admin to send a new one.";
  if (inv.status === "revoked") return "This invitation was revoked. Ask an owner or admin to send a new one.";
  return "This invitation has expired. Ask an owner or admin to send a new one.";
}

export function InvitationsPage() {
  const navigate = useNavigate();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    apiFetch("/invitations")
      .then((data: { invitations: Invitation[] }) => {
        setInvitations(data.invitations);
        // The list is history, newest first, so row 0 can easily be something
        // already dealt with. Open on the one there is a decision to make about,
        // and only fall back to the newest row when there is none.
        const first = data.invitations.find((inv) => inv.live) ?? data.invitations[0];
        if (first) setSelectedId(first.id);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const selected = invitations.find((inv) => inv.id === selectedId);

  // Bug #14: the error banner is scoped to ONE operation, so anything that
  // starts a new one has to clear it. A failed accept used to leave "You are
  // already a member of this project" pinned above the page while the user
  // picked a different invitation — the banner then described an invitation
  // that was no longer on screen, and after a successful accept of the second
  // one the last thing they saw was still a failure.
  function selectInvitation(inv: Invitation) {
    setError("");
    setSelectedId(inv.id);
  }

  // The declined row stays listed and stays selected. Declining it away deleted
  // the only record that the invitation ever existed — a user who declined by
  // mistake had nothing left on screen to explain where it went. That still
  // holds; clearing the row is now a separate, deliberate act (handleDelete).
  async function handleDecline(invitation: Invitation) {
    setDeclining(true);
    setError("");
    try {
      await apiFetch(`/invitations/${invitation.id}/decline`, { method: "POST" });
      setInvitations((prev) =>
        prev.map((inv) =>
          inv.id === invitation.id ? { ...inv, status: "declined", live: false } : inv,
        ),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to decline invitation");
    } finally {
      setDeclining(false);
    }
  }

  // Only offered on a row nothing can be done about any more: the route refuses
  // a live invitation (409, "decline it instead") so that a misfired click here
  // cannot silently throw away an invitation the user could still accept.
  async function handleDelete(invitation: Invitation) {
    setDeleting(true);
    setError("");
    try {
      await apiFetch(`/invitations/${invitation.id}`, { method: "DELETE" });
      const remaining = invitations.filter((inv) => inv.id !== invitation.id);
      setInvitations(remaining);
      // Same rule the initial load uses: re-open on the row there is a decision
      // to make about, and only fall back to the newest one when there is none.
      // Without this the pane keeps pointing at the id that was just deleted and
      // goes blank with nothing to say why.
      const next = remaining.find((i) => i.live) ?? remaining[0];
      setSelectedId(next?.id ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete invitation");
    } finally {
      setDeleting(false);
    }
  }

  // The role is the inviter's, not the invitee's: it is shown, not chosen. The
  // fallback covers invitations written before the inviter picked one, and it is
  // the same value the pane displays, so nobody is joined under a role they were
  // not shown.
  async function handleAccept(invitation: Invitation) {
    setAccepting(true);
    setError("");
    try {
      await apiFetch(`/invitations/${invitation.id}/accept`, {
        method: "POST",
        body: JSON.stringify({ developer_role: invitation.developer_role ?? FALLBACK_ROLE }),
      });
      navigate(`/projects/${invitation.project_id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to accept invitation");
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <PageSpinner className="py-16" iconClassName="h-4 w-4" label="Loading your invitations" />
    );
  }

  return (
    <div>
      <PageHeader
        title="Invitations"
        subtitle="Invitations from teammates, current and past."
        actions={<BackLink />}
      />

      {error && (
        <ErrorBanner className="mb-3">{error}</ErrorBanner>
      )}

      {invitations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <Users className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">No invitations yet.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            New invitations from project owners will appear here.
          </p>
        </div>
      ) : (
        // `items-start`: the details pane is a short card, and stretching it to
        // the height of a long history left a tall box of empty space under the
        // buttons. It takes its own height now and the list scrolls beside it.
        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[280px_1fr]">
          {/* Left panel */}
          <div className="space-y-2">
            <p className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
              Invitations ({invitations.length})
            </p>
            {/* Every row opens, including the ones nothing can be done about:
                the pane is where "what happened to that invitation?" is
                answered, so a closed row has to be inspectable.

                Bounded and scrolled from `lg` up, where the pane sits beside the
                list and a long history pushed it off screen. Below `lg` the pane
                is under the list, so a scroller here would be a second scrollbar
                inside the page's own. */}
            <div className="space-y-2 overflow-y-auto pr-0.5 lg:max-h-[calc(100vh-14rem)]">
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
                          Invited by {inv.invited_by_email || "a teammate"}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-[0.6875rem] capitalize">
                        {inv.permission_tier}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Badge
                        variant={inv.live ? "secondary" : "outline"}
                        className="text-[0.6875rem] capitalize"
                      >
                        {statusWord(inv)}
                      </Badge>
                      {/* The role the accept will send, fallback included, so this
                          chip and the pane never name two different roles. */}
                      <Badge variant="outline" className="text-[0.6875rem]">
                        {roleLabel(inv.developer_role || FALLBACK_ROLE)} role
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Right panel */}
          {selected && (
            <Card>
              <CardContent className="p-3">
                <h2 className="text-sm font-semibold text-foreground">
                  Join {selected.repo_name}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Invited by {selected.invited_by_email || "a teammate"}.
                </p>

                <div className="mt-2.5 flex gap-3">
                  <div className="flex-1 rounded-md border border-border bg-card p-2">
                    <p className="text-[0.6875rem] text-muted-foreground">Permission</p>
                    <p className="text-sm font-medium capitalize text-foreground">
                      {selected.permission_tier}
                    </p>
                  </div>
                  <div className="flex-1 rounded-md border border-border bg-card p-2">
                    <p className="text-[0.6875rem] text-muted-foreground">Organization</p>
                    <p className="text-sm font-medium text-foreground">{selected.repo_owner}</p>
                  </div>
                </div>

                {/* Read-only, always: the inviter chose the role, and offering a
                    chooser here let an invitee overwrite that choice on the way
                    in. TITLE register — this line names the person joining.

                    Labelled like Permission and Organization above it, then
                    title and description on one row: the description is a short
                    sentence that reads as an aside to the title, not as a line
                    of its own. Without the label the whole box read as a stray
                    caption — nothing said this was the role you would be joining
                    under. */}
                {(() => {
                  const role = ROLE_OPTIONS.find(
                    (r) => r.value === (selected.developer_role || FALLBACK_ROLE),
                  );
                  return (
                    <div className="mt-2 w-full rounded-md border border-border bg-card p-2">
                      <p className="text-[0.6875rem] text-muted-foreground">Joining as</p>
                      {/* flex-wrap + min-w-0: a long title pushes the description
                          onto its own line instead of colliding with it. */}
                      <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <p className="text-sm font-medium capitalize text-foreground">
                          {role?.title ?? selected.developer_role}
                        </p>
                        <p className="min-w-0 text-right text-xs text-muted-foreground">
                          {role?.description ?? "Assigned by the inviter"}
                        </p>
                      </div>
                    </div>
                  );
                })()}

                {selected.live ? (
                  <div className="mt-3 flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={declining || accepting}
                      onClick={() => handleDecline(selected)}
                    >
                      {declining ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <XCircle className="h-3 w-3" />
                      )}
                      Decline
                    </Button>
                    <Button size="sm" disabled={accepting || declining} onClick={() => handleAccept(selected)}>
                      {accepting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CheckCircle className="h-3 w-3" />
                      )}
                      Accept invitation
                    </Button>
                  </div>
                ) : (
                  // No accept or decline rather than disabled ones: both would be
                  // refused by the route, and the reason is worth more than a dead
                  // control. Delete is the one thing still on offer, because the
                  // row is now nothing but the user's own record of what happened.
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="flex-1 min-w-0 text-xs text-muted-foreground">
                      {closedStateLine(selected)}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={deleting}
                      onClick={() => handleDelete(selected)}
                    >
                      {deleting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      Delete invitation
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
