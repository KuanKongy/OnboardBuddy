import { Github, LogOut, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { BackLink } from "@/components/BackLink";
import { PageHeader } from "@/components/PageHeader";

export function AccountSettingsPage() {
  const { user, signOut, connectGithub, disconnectGithub } = useAuth();

  const [appConnected, setAppConnected] = useState(false);
  const [appUsername, setAppUsername] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    (meta.full_name as string) || (meta.name as string) || "—";

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";

  const githubIdentity = user?.identities?.find(
    (id) => id.provider === "github",
  );

  useEffect(() => {
    apiFetch("/auth/me")
      .then((data: { user: { github_connected: boolean; github_username: string | null } }) => {
        setAppConnected(data.user.github_connected);
        setAppUsername(data.user.github_username);
      })
      .catch(() => {});
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await disconnectGithub();
      setAppConnected(false);
      setAppUsername(null);
    } catch {
      // swallow
    } finally {
      setDisconnecting(false);
    }
  }

  // Back returns to wherever the settings gear was clicked (carried in
  // location.state by AccountCard); direct visits fall back to the dashboard.
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  return (
    <div>
      {/* Header spans the full page like every other tab; only the card
          column below is centered and narrow. */}
      <PageHeader
        title="Account Settings"
        subtitle="Your profile, GitHub connection, and account access."
        actions={<BackLink to={from ?? "/dashboard"} label={from ? "Back" : "Back to dashboard"} />}
      />
      <div className="mx-auto max-w-xl">

      <Card className="mb-3">
        <CardContent className="p-3">
          <h2 className="mb-2 text-xs font-medium text-foreground">Profile</h2>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Full name</span>
              <span className="font-medium text-foreground">{fullName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium text-foreground">{user?.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Member since</span>
              <span className="font-medium text-foreground">{memberSince}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-3">
        <CardContent className="p-3">
          <h2 className="mb-2 text-xs font-medium text-foreground">GitHub Login</h2>
          {githubIdentity ? (
            <div className="flex items-center gap-2 text-xs">
              <Github className="h-3.5 w-3.5 text-foreground" />
              <span className="font-medium text-foreground">
                Signed in as{" "}
                {(githubIdentity.identity_data as Record<string, string>)?.user_name ?? "GitHub User"}
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Signed in with email/password</span>
          )}
        </CardContent>
      </Card>

      <Card className="mb-3">
        <CardContent className="p-3">
          <h2 className="mb-2 text-xs font-medium text-foreground">GitHub App (Repo Import)</h2>
          {appConnected ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                <Github className="h-3.5 w-3.5 text-foreground" />
                <span className="font-medium text-foreground">
                  Connected as @{appUsername}
                </span>
              </div>
              <div className="flex gap-1">
                <Button variant="outline" size="xs" onClick={() => connectGithub()}>
                  Re-authorize
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                >
                  <Unplug className="h-3 w-3" />
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Not connected — required for repo import</span>
              <Button variant="outline" size="xs" onClick={() => connectGithub()}>
                <Github className="h-3 w-3" />
                Authorize GitHub App
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardContent className="p-3">
          <h2 className="mb-2 text-xs font-medium text-destructive">Danger Zone</h2>
          <Separator className="mb-2" />
          <Button variant="destructive" size="sm" onClick={() => signOut()}>
            <LogOut className="h-3 w-3" />
            Sign Out
          </Button>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
