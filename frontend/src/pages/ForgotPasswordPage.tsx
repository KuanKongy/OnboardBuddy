import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { LogoMark } from "@/components/BrandLogo";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Start of the password-reset loop: email → Supabase sends a recovery link
 * that lands on /reset-password (the redirect URL must be allow-listed in
 * Supabase Auth settings — doc/DEVOPS.md). Copy stays neutral either way so
 * the form can't be used to probe which emails exist.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      // Rate-limit errors are worth surfacing; "user not found" style errors
      // are not (Supabase doesn't return those anyway).
      if (resetError && resetError.status === 429) throw new Error(resetError.message);
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send the reset email");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <LogoMark className="mx-auto mb-3 h-10 w-10" />
          <h1 className="text-lg font-semibold text-foreground">Reset your password</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            We'll email you a link to choose a new one
          </p>
        </div>

        <Card>
          <CardContent className="p-4">
            {sent ? (
              <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success-soft px-3 py-2.5 text-xs text-foreground">
                <MailCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                <span>
                  If an account exists for <strong>{email}</strong>, a reset link is on its way.
                  Open it on this device to set a new password.
                </span>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                {error && (
                  <ErrorBanner>{error}</ErrorBanner>
                )}
                <div className="space-y-1">
                  <Label htmlFor="email" className="text-xs">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="h-8 text-[0.8125rem]"
                    autoComplete="email"
                  />
                </div>
                <Button type="submit" className="w-full" size="sm" disabled={loading}>
                  {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                  Send reset link
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-4 text-center">
          <Link to="/login" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
