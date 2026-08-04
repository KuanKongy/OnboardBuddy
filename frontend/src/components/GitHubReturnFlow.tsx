import { CheckCircle2, Github, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useGitHubReturn } from "@/hooks/useGitHubReturn";

/**
 * The one screen for every GitHub round trip's return leg. Rendered by both
 * /github/oauth/callback and /github/setup (see useGitHubReturn for why both
 * URLs must handle every arrival shape).
 */
export function GitHubReturnFlow() {
  const { phase, error, next } = useGitHubReturn();
  const { connectGithub } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  const backLabel = next === "/settings" ? "Back to settings" : "Back to import";

  if (phase === "error") {
    return (
      <Shell>
        <h1 className="text-sm font-semibold text-foreground">GitHub connection failed</h1>
        <p className="mt-1 text-xs text-destructive">{error}</p>
        <Button variant="link" size="sm" className="mt-2" asChild>
          <Link to={next}>{backLabel}</Link>
        </Button>
      </Shell>
    );
  }

  if (phase === "pending") {
    return (
      <Shell>
        <CheckCircle2 className="mx-auto h-5 w-5 text-primary" aria-hidden="true" />
        <h1 className="mt-2 text-sm font-semibold text-foreground">Installation requested</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          An organization owner needs to approve installing the GitHub App before you can import
          its repositories.
        </p>
        <Button variant="link" size="sm" className="mt-2" asChild>
          <Link to={next}>{backLabel}</Link>
        </Button>
      </Shell>
    );
  }

  if (phase === "updated") {
    return (
      <Shell>
        <CheckCircle2 className="mx-auto h-5 w-5 text-success" aria-hidden="true" />
        <h1 className="mt-2 text-sm font-semibold text-foreground">GitHub installation updated</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Your repository access changed on GitHub; the import page picks it up automatically.
        </p>
        <Button variant="link" size="sm" className="mt-2" asChild>
          <Link to={next}>{next === "/settings" ? "Back to settings" : "Continue to import"}</Link>
        </Button>
      </Shell>
    );
  }

  if (phase === "needsConnect") {
    return (
      <Shell>
        <Github className="mx-auto h-5 w-5 text-foreground" aria-hidden="true" />
        <h1 className="mt-2 text-sm font-semibold text-foreground">One more step</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          The app is installed, but your GitHub account isn't connected yet, so the installation
          can't be verified as yours. Connecting finishes in one hop.
        </p>
        {connectError && <p className="mt-1 text-xs text-destructive">{connectError}</p>}
        <Button
          size="sm"
          className="mt-3"
          disabled={connecting}
          onClick={async () => {
            setConnecting(true);
            setConnectError("");
            try {
              await connectGithub(next);
            } catch (err) {
              setConnectError(err instanceof Error ? err.message : "Failed to start GitHub connection");
              setConnecting(false);
            }
          }}
        >
          {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Github className="h-3.5 w-3.5" />}
          Connect GitHub
        </Button>
      </Shell>
    );
  }

  return (
    <Shell role="status">
      <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" aria-hidden="true" />
      <p className="mt-3 text-xs text-muted-foreground">Completing GitHub connection...</p>
    </Shell>
  );
}

function Shell({ children, role }: { children: React.ReactNode; role?: string }) {
  return (
    <div className="mx-auto max-w-sm">
      <Card>
        <CardContent className="p-4 text-center" role={role}>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
