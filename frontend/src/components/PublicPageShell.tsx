import type { ReactNode } from "react";
import { IntroFooter } from "@/components/intro/IntroFooter";
import { IntroHeader } from "@/components/intro/IntroHeader";
import { LivingBackground } from "@/components/intro/LivingBackground";
import { SkipToContent } from "@/components/SkipToContent";
import { MAIN_REGION_ID } from "@/hooks/usePageChrome";
import { useScrollToHash } from "@/hooks/useScrollToHash";

/**
 * Chrome for public content pages (/help signed-out, /privacy, /terms): the
 * landing page's header and footer around a calm, readable column. The shared
 * intro background renders behind it, but with the aurora lights off, so
 * content pages get the base mesh (dot grid + vignette) and stay quiet. The
 * title block is left-aligned like every in-app tab, the column centered like
 * the reader. Hash deep links (/privacy#modes from the landing page) scroll to
 * their section via useScrollToHash.
 */
export function PublicPageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  useScrollToHash();

  return (
    <div className="relative isolate flex min-h-screen flex-col bg-background text-foreground">
      <SkipToContent />
      <LivingBackground showLights={false} />
      <IntroHeader />
      <main id={MAIN_REGION_ID} tabIndex={-1} className="flex-1 px-4 py-8 outline-none sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="page-header">
            <div className="min-w-0">
              <h1 className="page-title">{title}</h1>
              {subtitle ? <div className="page-subtitle">{subtitle}</div> : null}
            </div>
          </div>
          {children}
        </div>
      </main>
      <IntroFooter />
    </div>
  );
}
