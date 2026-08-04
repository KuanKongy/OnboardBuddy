import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ClosingSection } from "@/components/intro/ClosingSection";
import { CostSection } from "@/components/intro/CostSection";
import { HeroSection } from "@/components/intro/HeroSection";
import { HowItWorks } from "@/components/intro/HowItWorks";
import { IntroFooter } from "@/components/intro/IntroFooter";
import { IntroHeader } from "@/components/intro/IntroHeader";
import { LivingBackground } from "@/components/intro/LivingBackground";
import { PillarGrid } from "@/components/intro/PillarGrid";
import { PipelineSection } from "@/components/intro/PipelineSection";
import { PrivacySection } from "@/components/intro/PrivacySection";
import { ShowcaseSection } from "@/components/intro/ShowcaseSection";
import { StatStrip } from "@/components/intro/StatStrip";
import { SkipToContent } from "@/components/SkipToContent";
import { MAIN_REGION_ID } from "@/hooks/usePageChrome";
import { scrollBehavior } from "@/lib/motion";

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
  const { hash, key } = useLocation();

  // React Router never scrolls on hash navigation, and on a full load the
  // browser resolves the fragment before these sections exist. Keyed on the
  // location key as well, so clicking "Pipeline" again while already on "/"
  // scrolls again instead of being a no-op.
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  }, [hash, key]);

  return (
    <div className="relative isolate min-h-screen bg-background text-foreground">
      <SkipToContent />
      <LivingBackground />
      <IntroHeader />
      <main id={MAIN_REGION_ID} tabIndex={-1} className="outline-none">
        <HeroSection />
        <StatStrip />
        <PillarGrid />
        <HowItWorks />
        <PrivacySection />
        <PipelineSection />
        <ShowcaseSection />
        <CostSection />
        <ClosingSection />
      </main>
      <IntroFooter />
    </div>
  );
}
