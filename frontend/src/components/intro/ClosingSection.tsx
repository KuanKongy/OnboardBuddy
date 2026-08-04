import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Reveal } from "@/components/intro/Reveal";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

/**
 * The second conversion point (the old page had exactly one CTA in 507
 * lines). Auth-aware like the hero: signed-in visitors go to the dashboard.
 */
export function ClosingSection() {
  const { user } = useAuth();

  return (
    <section aria-labelledby="closing-title" className="px-4 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <div className="relative overflow-hidden rounded-2xl border border-foreground/10 px-6 py-14 text-center dark:border-white/10 sm:px-12 sm:py-16">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10"
              style={{
                background:
                  "radial-gradient(ellipse 80% 120% at 50% 130%, color-mix(in oklab, #2659f4 20%, transparent), transparent 70%)",
              }}
            />
            <h2 id="closing-title" className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Give the next developer a real map
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-muted-foreground">
              Import a repository, preview the cost before anything runs, and get a handbook where
              every claim carries a receipt.
            </p>
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
                <Link to="/faq">Read the FAQ</Link>
              </Button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
