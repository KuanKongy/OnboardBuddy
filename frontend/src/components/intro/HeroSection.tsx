import { ArrowRight, CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LogoMark } from "@/components/BrandLogo";
import { Reveal } from "@/components/intro/Reveal";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

/**
 * The centered hero: claim, proof line, CTAs, and the product-story window as
 * the centerpiece (the old layout was two columns around a dead gap). The h1
 * must keep the contiguous phrase "Onboard developers": App.test pins it.
 */
export function HeroSection() {
  const { user } = useAuth();

  return (
    <section aria-labelledby="hero-title" className="px-4 pb-10 pt-16 sm:px-6 sm:pb-14 sm:pt-24">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <p className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-card/60 px-3.5 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm dark:border-white/10">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
              Deterministic first. AI second. Receipts always.
            </p>
          </Reveal>
          <Reveal index={1}>
            <h1
              id="hero-title"
              className="mt-6 text-balance text-4xl font-bold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-6xl"
            >
              Onboard developers with a handbook{" "}
              <span className="bg-gradient-to-r from-[#2659f4] via-[#7c66f0] to-[color:var(--node-ui)] bg-clip-text text-transparent">
                built from the code itself
              </span>
            </h1>
          </Reveal>
          <Reveal index={2}>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-[0.9375rem] leading-relaxed text-muted-foreground sm:text-base">
              OnboardBuddy analyzes a GitHub repository and writes role-based onboarding: architecture,
              traced workflows, tutorials, and a dependency map. Every claim cites the file and line it
              came from.
            </p>
          </Reveal>
          <Reveal index={3}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" asChild>
                {user ? (
                  <Link to="/dashboard">
                    Go to dashboard
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <Link to="/signup">
                    Get started
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#how">See how it works</a>
              </Button>
            </div>
            <p className="mt-5 text-[0.8125rem] leading-relaxed text-muted-foreground">
              TypeScript and JavaScript are parsed into symbols and call graphs; every other file is
              read and cited as evidence. Repositories connect through the read-only GitHub App.
            </p>
          </Reveal>
        </div>

        <Reveal index={2} className="mt-14 sm:mt-16">
          <StoryWindow>
            <StoryPlaceholder />
          </StoryWindow>
        </Reveal>
      </div>
    </section>
  );
}

/**
 * The app-window frame around the hero story: brand mark, the real project
 * tab names, and the fictional repo it analyzes. The tabs are plain spans on
 * purpose: nothing inside the frame may be a censusable control (the e2e
 * audit probe hard-fails on census drift while the story plays).
 */
export function StoryWindow({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto max-w-4xl">
      <div
        aria-hidden="true"
        className="absolute -inset-x-10 -bottom-8 -top-12 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 65% 60% at 50% 45%, color-mix(in oklab, #2659f4 14%, transparent), transparent 72%)",
        }}
      />
      <div className="overflow-hidden rounded-2xl border border-foreground/10 bg-card/85 shadow-2xl shadow-[#2659f4]/10 backdrop-blur-sm dark:border-white/10 dark:bg-card/70">
        <div className="flex items-center gap-3 border-b border-foreground/10 px-4 py-2.5 dark:border-white/10">
          <LogoMark className="h-4 w-4" />
          <div aria-hidden="true" className="flex items-center gap-1">
            {["Overview", "Dependencies", "Tutorials"].map((tab, i) => (
              <span
                key={tab}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[0.6875rem] font-medium",
                  i === 0 ? "bg-accent/70 text-foreground" : "text-muted-foreground",
                )}
              >
                {tab}
              </span>
            ))}
          </div>
          <span className="ml-auto hidden font-mono text-[0.6875rem] text-muted-foreground sm:block">
            acme/storefront @ main
          </span>
        </div>
        <div className="relative aspect-[16/10] sm:aspect-[16/9]">{children}</div>
      </div>
    </div>
  );
}

/**
 * Static stand-in until the animated story lands: the analysis checklist as a
 * finished still, inside the same frame the story will use.
 */
function StoryPlaceholder() {
  const stages = [
    "Cloning repository",
    "Parsing TypeScript",
    "Building the dependency graph",
    "Tracing workflows",
    "Generating the onboarding handbook",
  ];
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Analyzing acme/storefront
        </p>
        <div className="space-y-2.5">
          {stages.map((stage) => (
            <div key={stage} className="flex items-center gap-2.5 text-[0.8125rem] text-foreground">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              {stage}
            </div>
          ))}
        </div>
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-full rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
}
