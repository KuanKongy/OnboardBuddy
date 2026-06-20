import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

export function GitHubOAuthCallbackPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");

    if (!code || !state) {
      setError("GitHub did not return code and state.");
      return;
    }

    apiFetch("/github/oauth/complete", {
      method: "POST",
      body: JSON.stringify({ code, state }),
    })
      .then(async () => {
        const afterOAuth = sessionStorage.getItem("onboardbuddy.github.after_oauth");
        sessionStorage.removeItem("onboardbuddy.github.after_oauth");

        if (afterOAuth === "install") {
          const appInfo = await apiFetch("/github/app") as { install_url: string };
          window.location.href = appInfo.install_url;
          return;
        }

        navigate("/import", { replace: true });
      })
      .catch((err) => setError(err.message));
  }, [navigate, params]);

  if (error) {
    return (
      <div className="mx-auto max-w-sm">
        <Card>
          <CardContent className="p-4 text-center">
            <h1 className="text-sm font-semibold text-foreground">GitHub connection failed</h1>
            <p className="mt-1 text-xs text-destructive">{error}</p>
            <Button variant="link" size="sm" className="mt-2" asChild>
              <Link to="/settings">Back to settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm">
      <Card>
        <CardContent className="p-4 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
          <p className="mt-3 text-xs text-muted-foreground">Completing GitHub connection...</p>
        </CardContent>
      </Card>
    </div>
  );
}
