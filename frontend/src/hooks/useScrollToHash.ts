import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { scrollBehavior } from "@/lib/motion";

/**
 * Scroll the element named by the URL hash into view. React Router never
 * scrolls on hash navigation, and on a full load the browser resolves the
 * fragment before lazy sections exist. Keyed on the location key as well, so
 * clicking the same anchor again scrolls again instead of being a no-op.
 * Used by IntroPage (landing anchors) and PublicPageShell (deep links like
 * /privacy#modes). usePageChrome already skips its scroll-to-top whenever a
 * hash is present, so the two never fight.
 */
export function useScrollToHash(): void {
  const { hash, key } = useLocation();

  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  }, [hash, key]);
}
