import { Github, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export function AccountSettingsPage() {
  const { user, signOut, connectGithub } = useAuth();

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

  return (
    <div className="max-w-xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-foreground">Account Settings</h1>
        <p className="text-xs text-muted-foreground">
          Your profile, GitHub connection, and account access.
        </p>
      </div>

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
          <h2 className="mb-2 text-xs font-medium text-foreground">GitHub Connection</h2>
          {githubIdentity ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Github className="h-3.5 w-3.5 text-foreground" />
                <span className="text-xs font-medium text-foreground">
                  Connected as{" "}
                  {(githubIdentity.identity_data as Record<string, string>)
                    ?.user_name ?? "GitHub User"}
                </span>
              </div>
              <Button variant="outline" size="xs" onClick={() => connectGithub()}>
                Authorize GitHub App
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="xs" onClick={() => connectGithub()}>
              <Github className="h-3 w-3" />
              Authorize GitHub App
            </Button>
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
  );
}
