import { Eye, EyeOff, Github, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, type Location } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { LogoMark } from "@/components/BrandLogo";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Where ProtectedRoute wanted the user, as a path GitHub can be asked to come back
 * to. ProtectedRoute hands over a Location and other callers a plain string — accept
 * both rather than putting "[object Object]" in a redirect URL.
 */
function nextPathOf(from: Location | string | undefined): string | undefined {
  if (!from) return undefined;
  if (typeof from === "string") return from;
  return `${from.pathname}${from.search ?? ""}`;
}

export function LoginPage() {
  const { user, loading: authLoading, signIn, signInWithGithub } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const from = (location.state as { from?: Location } | null)?.from;

  // Already signed in → straight to the app (the intro page never redirects;
  // this page is the "I want in" signal).
  if (!authLoading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
      navigate(from ?? "/dashboard", { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGithub() {
    setError("");
    setGithubLoading(true);
    try {
      await signInWithGithub(nextPathOf(from));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "GitHub sign in failed");
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
          <h1 className="text-lg font-semibold text-foreground">Welcome back</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Sign in to OnboardBuddy</p>
        </div>

        <Card>
          <CardContent className="p-4">
            {error && (
              <ErrorBanner className="mb-3">{error}</ErrorBanner>
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-xs">Password</Label>
                  <Link to="/forgot-password" className="text-[0.6875rem] font-medium text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-8 pr-8 text-[0.8125rem]"
                    autoComplete="current-password"
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
              </div>
              <Button type="submit" className="w-full" size="sm" disabled={loading || githubLoading}>
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                Sign in
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
              Sign in with GitHub
            </Button>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link to="/signup" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
