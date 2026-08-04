import type { ReactNode } from "react";
import { IntroFooter } from "@/components/intro/IntroFooter";
import { IntroHeader } from "@/components/intro/IntroHeader";
import { SkipToContent } from "@/components/SkipToContent";
import { MAIN_REGION_ID } from "@/hooks/usePageChrome";

/**
 * Chrome for public content pages (/help signed-out, /privacy, /terms): the
 * landing page's header and footer around a calm, readable column. No aurora
 * background here; content pages stay quiet. The title block is left-aligned
 * like every in-app tab, the column centered like the reader.
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
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SkipToContent />
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
