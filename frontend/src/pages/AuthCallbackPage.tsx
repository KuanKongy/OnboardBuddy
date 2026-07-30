import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { readOAuthError } from "@/lib/authErrors";
import { supabase } from "@/lib/supabase";

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

    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        setError("Sign in is taking longer than expected. Please try again.");
      }
    }, 10000);

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
        window.clearTimeout(timeoutId);
        navigate(next, { replace: true });
        return;
      }

      if (event === "SIGNED_OUT") {
        window.clearTimeout(timeoutId);
        setError("Could not complete sign in. Please try again.");
      }
    });

    void supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
      if (cancelled) return;
      if (sessionError) {
        window.clearTimeout(timeoutId);
        setError(sessionError.message);
        return;
      }
      if (session) {
        window.clearTimeout(timeoutId);
        navigate(next, { replace: true });
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [navigate, error, next]);

  const isProviderProfileError = /user profile from external provider/i.test(error);
  // GoTrue's own error text when this GitHub account's email already
  // resolves to more than one existing Supabase user (e.g. an email/
  // password account plus a separate GitHub-created one with the same
  // address) — automatic identity linking refuses to guess which one to
  // sign into. Known GoTrue limitation (supabase/auth#1242), not something
  // this app can resolve automatically, so at least name it plainly instead
  // of surfacing GoTrue's raw "linking domain" wording as-is.
  const isDuplicateEmailError = /multiple accounts with the same email address/i.test(error);

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
            {isDuplicateEmailError && (
              <p className="mt-2 text-xs text-muted-foreground">
                An OnboardBuddy account already exists for this email address under a
                different sign-in method. Sign in that original way instead, then link
                GitHub afterwards from Account Settings.
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
