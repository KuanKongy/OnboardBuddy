import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

export function GitHubSetupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    const installationId = params.get("installation_id");
    const state = params.get("state");

    if (!installationId || !state) {
      setError("GitHub did not return installation_id and state.");
      return;
    }

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
