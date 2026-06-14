import {
  ArrowRight,
  Code2,
  GitBranch,
  RefreshCw,
  Search,
  Shield,
  Users,
} from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function IntroPage() {
  const { user, loading } = useAuth();

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
              OB
            </div>
            <span className="text-sm font-semibold text-foreground">OnboardBuddy</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/login">Log In</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/signup">Sign Up</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="px-4 pb-16 pt-14 sm:pb-20 sm:pt-16">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl">
            Onboard developers to any codebase&nbsp;&mdash; automatically
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            OnboardBuddy analyzes your repository, extracts critical workflows, and
            generates role-specific onboarding packages grounded in real code evidence.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button size="sm" asChild>
              <Link to="/signup">
                Get Started
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="#features">Learn More</a>
            </Button>
          </div>
        </div>
      </section>

      <section id="features" className="border-t border-border bg-card px-4 py-14">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-8 text-center text-xl font-bold text-foreground sm:text-2xl">
            Built for engineering teams
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<Code2 className="h-4 w-4" />}
              title="Deterministic Analysis"
              description="AST-powered extraction — not AI-guessed. Reliable, reproducible results every time."
            />
            <FeatureCard
              icon={<Users className="h-4 w-4" />}
              title="Role-Based Onboarding"
              description="Tailored paths for Backend, Frontend, DevOps, and QA engineers."
            />
            <FeatureCard
              icon={<Search className="h-4 w-4" />}
              title="Source-Grounded"
              description="Every claim is linked to real code. No hallucinated documentation."
            />
            <FeatureCard
              icon={<RefreshCw className="h-4 w-4" />}
              title="Always Current"
              description="Incremental updates when code changes. Never stale onboarding."
            />
          </div>
        </div>
      </section>

      <section className="px-4 py-14">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-8 text-center text-xl font-bold text-foreground sm:text-2xl">
            How it works
          </h2>
          <div className="grid gap-6 sm:grid-cols-3">
            <StepCard
              step={1}
              icon={<GitBranch className="h-4 w-4" />}
              title="Connect your GitHub repo"
              description="Install the OnboardBuddy GitHub App and select repositories to analyze."
            />
            <StepCard
              step={2}
              icon={<Shield className="h-4 w-4" />}
              title="We analyze & extract workflows"
              description="Our deterministic pipeline parses your code, maps dependencies, and identifies critical paths."
            />
            <StepCard
              step={3}
              icon={<Users className="h-4 w-4" />}
              title="Your team gets personalized onboarding"
              description="Each developer receives a role-specific package with walkthroughs and architecture context."
            />
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-4 py-6">
        <div className="mx-auto max-w-5xl text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} OnboardBuddy. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </div>
        <h3 className="mb-1 text-[13px] font-semibold text-foreground">{title}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function StepCard({
  step,
  icon,
  title,
  description,
}: {
  step: number;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
        Step {step}
      </div>
      <h3 className="mb-1 text-[13px] font-semibold text-foreground">{title}</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
