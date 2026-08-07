import { Eye, EyeOff, Github, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { LogoMark } from "@/components/BrandLogo";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function SignupPage() {
  const { user, loading: authLoading, signUp, signInWithGithub } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);

  // Already signed in → straight to the app.
  if (!authLoading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const session = await signUp(email, password);
      if (session) {
        navigate("/dashboard");
      } else {
        setInfo("Check your email to confirm your account. The link signs you in and continues.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  // The OAuth redirect takes a second or two, during which the page must stop
  // inviting a second click and a form submit — same shape as LoginPage.
  async function handleGithub() {
    setError("");
    setGithubLoading(true);
    try {
      await signInWithGithub();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "GitHub sign up failed");
    } finally {
      setGithubLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link to="/" className="mx-auto mb-3 inline-block">
                <LogoMark className="h-10 w-10" />
              </Link>
            </TooltipTrigger>
            <TooltipContent>Homepage</TooltipContent>
          </Tooltip>
          <h1 className="text-lg font-semibold text-foreground">Create an account</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Get started with OnboardBuddy</p>
        </div>

        <Card>
          <CardContent className="p-4">
            {error && (
              <ErrorBanner className="mb-3">{error}</ErrorBanner>
            )}
            {info && (
              <div role="status" className="mb-3 rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-xs text-primary">
                {info}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
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
              <div className="space-y-1">
                <Label htmlFor="password" className="text-xs">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-8 pr-8 text-[0.8125rem]"
                    autoComplete="new-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="absolute right-0.5 top-1/2 -translate-y-1/2"
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    <span className="sr-only">{showPassword ? "Hide password" : "Show password"}</span>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Minimum 8 characters</p>
              </div>
              <Button type="submit" className="w-full" size="sm" disabled={loading || githubLoading}>
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                Create account
              </Button>
            </form>

            <div className="relative my-4">
              <Separator />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                or
              </span>
            </div>

            <Button variant="outline" className="w-full" size="sm" onClick={handleGithub} disabled={loading || githubLoading}>
              {githubLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Github className="h-3.5 w-3.5" />}
              Sign up with GitHub
            </Button>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
