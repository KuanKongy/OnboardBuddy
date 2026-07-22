import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

const AFTER_OAUTH_KEY = "onboardbuddy.github.after_oauth";

/**
 * GitHub reports an authorization denial by redirecting back with `error`/
 * `error_description` query params instead of `code`/`state` — read them, or
 * declining shows a raw "did not return code and state" message instead of
 * an understandable cancellation notice (mirrors AuthCallbackPage bug #37).
 */
function readOAuthError(params: URLSearchParams): string {
  const code = params.get("error");
  if (!code) return "";
  if (code === "access_denied") return "You cancelled the GitHub connection.";
  return params.get("error_description")?.replace(/\+/g, " ") ?? code;
}

export function GitHubOAuthCallbackPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const requestedRef = useRef(false);

  useEffect(() => {
    const oauthError = readOAuthError(params);
    if (oauthError) {
      setError(oauthError);
      return;
    }

    const code = params.get("code");
    const state = params.get("state");

    if (!code || !state) {
      setError("GitHub did not return code and state.");
      return;
    }

    // Guard against React StrictMode's dev double-invoke re-firing this
    // single-use code/state pair, which would otherwise flip a successful
    // connection into an error state on the second (failing) attempt.
    if (requestedRef.current) return;
    requestedRef.current = true;

    apiFetch("/github/oauth/complete", {
      method: "POST",
      body: JSON.stringify({ code, state }),
    })
      .then(async () => {
        const afterOAuth = sessionStorage.getItem(AFTER_OAUTH_KEY);
        sessionStorage.removeItem(AFTER_OAUTH_KEY);

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
    const cameFromImport = sessionStorage.getItem(AFTER_OAUTH_KEY) === "install";
    return (
      <div className="mx-auto max-w-sm">
        <Card>
          <CardContent className="p-4 text-center">
            <h1 className="text-sm font-semibold text-foreground">GitHub connection failed</h1>
            <p className="mt-1 text-xs text-destructive">{error}</p>
            <Button variant="link" size="sm" className="mt-2" asChild>
              <Link to={cameFromImport ? "/import" : "/settings"}>
                {cameFromImport ? "Back to import" : "Back to settings"}
              </Link>
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
