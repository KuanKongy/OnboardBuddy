import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

/**
 * GitHub reports a cancelled/failed App install by redirecting back with
 * `error`/`error_description` query params instead of `installation_id`/
 * `state` — read them, or a decline shows a raw "did not return
 * installation_id and state" message instead of an understandable notice
 * (mirrors AuthCallbackPage bug #37).
 */
function readOAuthError(params: URLSearchParams): string {
  const code = params.get("error");
  if (!code) return "";
  if (code === "access_denied") return "You cancelled the GitHub App installation.";
  return params.get("error_description")?.replace(/\+/g, " ") ?? code;
}

export function GitHubSetupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const requestedRef = useRef(false);

  useEffect(() => {
    const oauthError = readOAuthError(params);
    if (oauthError) {
      setError(oauthError);
      return;
    }

    // A member without install permission can only *request* the app; an
    // org owner must approve. There's no installation yet — not a failure.
    if (params.get("setup_action") === "request") {
      setPending(true);
      return;
    }

    const installationId = params.get("installation_id");
    const state = params.get("state");

    if (!installationId || !state) {
      setError("GitHub did not return installation_id and state.");
      return;
    }

    // Guard against React StrictMode's dev double-invoke re-firing this
    // single-use installation_id/state pair, which would otherwise flip a
    // successful link into an error state on the second (failing) attempt.
    if (requestedRef.current) return;
    requestedRef.current = true;

    apiFetch("/github/installations/link", {
      method: "POST",
      body: JSON.stringify({
        installation_id: installationId,
        state,
      }),
    })
      .then(() => navigate("/import", { replace: true }))
      .catch((err) => setError(err.message));
  }, [navigate, params]);

  if (error) {
    return (
      <div className="mx-auto max-w-sm">
        <Card>
          <CardContent className="p-4 text-center">
            <h1 className="text-sm font-semibold text-foreground">GitHub setup failed</h1>
            <p className="mt-1 text-xs text-destructive">{error}</p>
            <Button variant="link" size="sm" className="mt-2" asChild>
              <Link to="/import">Back to import</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="mx-auto max-w-sm">
        <Card>
          <CardContent className="p-4 text-center">
            <CheckCircle2 className="mx-auto h-5 w-5 text-primary" />
            <h1 className="mt-2 text-sm font-semibold text-foreground">Installation requested</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              An organization owner needs to approve installing the GitHub App before you
              can import its repositories.
            </p>
            <Button variant="link" size="sm" className="mt-2" asChild>
              <Link to="/import">Back to import</Link>
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
          <p className="mt-3 text-xs text-muted-foreground">Linking GitHub installation...</p>
        </CardContent>
      </Card>
    </div>
  );
}
