import { AlertTriangle, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { readAuthErrorCode, readOAuthError } from "@/lib/authErrors";
import { supabase } from "@/lib/supabase";
import { LogoMark } from "@/components/BrandLogo";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Landing page of the Supabase recovery link: the link's hash tokens create a
 * session automatically (PASSWORD_RECOVERY / SIGNED_IN), after which the user
 * sets a new password via auth.updateUser.
 */

/** GoTrue's code for a recovery link past its TTL (`#error_code=otp_expired`). */
const EXPIRED_LINK_MESSAGE = "This reset link has expired — request a new one.";
/**
 * #74/F6: a link that produces neither a session nor an error param (already
 * consumed, opened on a different device, hash stripped by a mail client) left
 * this page on the "Waiting for your reset link…" line forever. Same 10s guard
 * as AuthCallbackPage — long enough for a real recovery round-trip, short
 * enough that a dead link stops pretending to be in progress.
 */
const LINK_TIMEOUT_MESSAGE =
  "This reset link didn't sign you in — it may have already been used, or been opened on another device.";

/** Reads the failure Supabase redirected back with, "" when the URL is clean. */
function readResetLinkError(): string {
  const description = readOAuthError();
  if (!description) return "";
  return readAuthErrorCode() === "otp_expired" ? EXPIRED_LINK_MESSAGE : description;
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [linkError, setLinkError] = useState(() => readResetLinkError());

  useEffect(() => {
    // A URL that already carries the failure has nothing to wait for.
    if (linkError) return;
    let cancelled = false;

    const timeoutId = window.setTimeout(() => {
      if (!cancelled) setLinkError(LINK_TIMEOUT_MESSAGE);
    }, 10000);

    function markReady() {
      window.clearTimeout(timeoutId);
      setReady(true);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) markReady();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION"))) {
        markReady();
      }
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      sub.subscription.unsubscribe();
    };
  }, [linkError]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);
      navigate("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update the password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <LogoMark className="mx-auto mb-3 h-10 w-10" />
          <h1 className="text-lg font-semibold text-foreground">Choose a new password</h1>
        </div>

        <Card>
          <CardContent className="p-4">
            {linkError ? (
              <ErrorBanner className="flex items-start gap-2 py-2.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {linkError}{" "}
                  <Link to="/forgot-password" className="font-medium text-destructive underline">
                    Request a reset email
                  </Link>
                  .
                </span>
              </ErrorBanner>
            ) : !ready ? (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                <span>
                  Waiting for your reset link… Open the link from the email on this device.
                  Don't have one?{" "}
                  <Link to="/forgot-password" className="font-medium text-primary hover:underline">
                    Request a reset email
                  </Link>
                  .
                </span>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                {error && (
                  <ErrorBanner>{error}</ErrorBanner>
                )}
                <div className="space-y-1">
                  <Label htmlFor="new-password" className="text-xs">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-8 text-[0.8125rem]"
                    autoComplete="new-password"
                  />
                  <p className="text-[0.65625rem] text-muted-foreground">Minimum 8 characters</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="confirm-new" className="text-xs">Confirm new password</Label>
                  <Input
                    id="confirm-new"
                    type="password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    className="h-8 text-[0.8125rem]"
                    autoComplete="new-password"
                  />
                </div>
                <Button type="submit" className="w-full" size="sm" disabled={saving}>
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                  Set new password
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
