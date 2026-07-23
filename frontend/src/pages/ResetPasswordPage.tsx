import { KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { LogoMark } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Landing page of the Supabase recovery link: the link's hash tokens create a
 * session automatically (PASSWORD_RECOVERY / SIGNED_IN), after which the user
 * sets a new password via auth.updateUser. Field labels deliberately avoid a
 * second bare "Password" label ("Confirm new") so getByLabelText(/password/i)
 * stays unambiguous in tests.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION"))) {
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two entries don't match.");
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
            {!ready ? (
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
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {error}
                  </div>
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
                  />
                  <p className="text-[0.65625rem] text-muted-foreground">Minimum 8 characters</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="confirm-new" className="text-xs">Confirm new</Label>
                  <Input
                    id="confirm-new"
                    type="password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    className="h-8 text-[0.8125rem]"
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
