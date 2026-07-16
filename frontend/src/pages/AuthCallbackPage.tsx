import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";

/**
 * Supabase reports OAuth failures by redirecting back with error params in
 * the query string and/or URL hash instead of a session — read both, or the
 * page spins forever (bug #37).
 */
function readOAuthError(): string {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const description = hash.get("error_description") ?? query.get("error_description");
  const code = hash.get("error") ?? query.get("error");
  if (!description && !code) return "";
  return description?.replace(/\+/g, " ") ?? code ?? "";
}

/**
 * Optional in-app destination (e.g. identity linking sends ?next=/settings so
 * the user lands back where they clicked "Link"). Only local paths are
 * honored — anything not starting with a single "/" falls back to /dashboard.
 */
function readNextParam(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState(() => readOAuthError());
  const [next] = useState(() => readNextParam());

  useEffect(() => {
    if (error) return;
    let cancelled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;

      // Password-recovery links must land on the set-new-password form, not
      // the dashboard (safety net for links pointed at this generic callback).
      if (event === "PASSWORD_RECOVERY") {
        navigate("/reset-password", { replace: true });
        return;
      }

      if (event === "SIGNED_IN" && session) {
        navigate(next, { replace: true });
        return;
      }

      if (event === "SIGNED_OUT") {
        setError("Could not complete sign in. Please try again.");
      }
    });

    void supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
      if (cancelled) return;
      if (sessionError) {
        setError(sessionError.message);
        return;
      }
      if (session) {
        navigate(next, { replace: true });
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [navigate, error, next]);

  const isProviderProfileError = /user profile from external provider/i.test(error);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="max-w-sm">
          <CardContent className="p-4 text-center">
            <h1 className="text-sm font-semibold text-foreground">Sign in failed</h1>
            <p className="mt-1 text-xs text-destructive">{error}</p>
            {isProviderProfileError && (
              <p className="mt-2 text-xs text-muted-foreground">
                GitHub sign-in couldn't read your profile. You can still sign up
                with email and password, and connect GitHub afterwards from
                Account Settings.
              </p>
            )}
            <Button variant="link" size="sm" className="mt-2" asChild>
              <Link to="/login">Back to login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
        <p className="mt-3 text-xs text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  );
}
