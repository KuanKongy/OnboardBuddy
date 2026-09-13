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
    // One frame later, not immediately: on a cross-page navigation this child
    // effect fires before usePageChrome's (parent effects run after children),
    // whose focus(#main) call follows in the same flush. Deferring one frame
    // starts the scroll after that focus and after layout settles, so the two
    // can never interact. (When verifying this in an automated browser, note
    // that Chromium suspends SMOOTH scrolling in occluded windows entirely,
    // landing anchors included; the jsdom test pins the behavior instead.)
    const frame = requestAnimationFrame(() => {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash, key]);
}
