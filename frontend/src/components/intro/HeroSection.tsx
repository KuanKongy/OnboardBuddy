import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { HeroStory } from "@/components/intro/HeroStory";
import { Reveal } from "@/components/intro/Reveal";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

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
                <Link to="/#how">See how it works</Link>
              </Button>
            </div>
            <p className="mt-5 text-[0.8125rem] leading-relaxed text-muted-foreground">
              TypeScript and JavaScript are parsed into symbols and call graphs; every other file is
              read and cited as evidence. Repositories connect through the read-only GitHub App.
            </p>
          </Reveal>
        </div>

        <Reveal index={2} className="mt-14 sm:mt-16">
          <HeroStory />
        </Reveal>
      </div>
    </section>
  );
}
