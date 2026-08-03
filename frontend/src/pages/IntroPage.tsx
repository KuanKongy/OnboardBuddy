import { ClosingSection } from "@/components/intro/ClosingSection";
import { HeroSection } from "@/components/intro/HeroSection";
import { IntroFooter } from "@/components/intro/IntroFooter";
import { IntroHeader } from "@/components/intro/IntroHeader";
import { LivingBackground } from "@/components/intro/LivingBackground";
import { StatStrip } from "@/components/intro/StatStrip";
import { SkipToContent } from "@/components/SkipToContent";
import { MAIN_REGION_ID } from "@/hooks/usePageChrome";

/**
 * The public landing page. Signed-in visitors are NOT auto-redirected — the
 * page stays readable and the header, hero and closing band offer the way
 * into the app instead (bug #59, M4).
 *
 * Copy rules the tests enforce: no em dashes anywhere, no "any codebase"
 * claims, and every number or phase label is imported from the module that
 * defines it, never retyped.
 */
export function IntroPage() {
  return (
    <div className="relative isolate min-h-screen bg-background text-foreground">
      <SkipToContent />
      <LivingBackground />
      <IntroHeader />
      <main id={MAIN_REGION_ID} tabIndex={-1} className="outline-none">
        <HeroSection />
        <StatStrip />
        <ClosingSection />
      </main>
      <IntroFooter />
    </div>
  );
}
