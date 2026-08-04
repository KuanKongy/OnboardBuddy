import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * Per-route document title + a focus reset on navigation. Without both, a route
 * change in a single-page app is invisible to anyone not watching the pixels.
 */

const APP_NAME = "OnboardBuddy";

/** The id both shells put on their `<main>`; the skip link targets it. */
export const MAIN_REGION_ID = "main";

/** Exact paths. The landing page maps to "" so its title is just the product. */
const PATH_TITLES: Record<string, string> = {
  "/": "",
  "/login": "Log in",
  "/signup": "Sign up",
  "/forgot-password": "Reset your password",
  "/reset-password": "Choose a new password",
  "/auth/callback": "Signing you in",
  "/help": "Help & FAQ",
  "/privacy": "Privacy & AI transparency",
  "/terms": "Terms of Service",
  "/dashboard": "Dashboard",
  "/github/oauth/callback": "Connecting GitHub",
  "/github/setup": "Connecting GitHub",
  "/list": "Your projects",
  "/import": "Import repository",
  "/invitations": "Invitations",
  "/settings": "Account settings",
};

/** Keyed by the segment after /projects/:id — "" is the index route. */
const PROJECT_TAB_TITLES: Record<string, string> = {
  "": "Project overview",
  onboarding: "Your onboarding",
  architecture: "Architecture",
  dependencies: "Dependencies",
  capabilities: "Capabilities",
  workflows: "Workflows",
  tutorials: "Tutorials",
  // The old path still routes (ProjectLayout's `alias`), so it needs the label.
  walkthrough: "Tutorials",
  team: "Team",
  settings: "Project settings",
};

export function pageTitleFor(pathname: string): string {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  let page = PATH_TITLES[clean];

  if (page === undefined) {
    const project = /^\/projects\/[^/]+(?:\/([^/]*))?$/.exec(clean);
    if (project) page = PROJECT_TAB_TITLES[project[1] ?? ""];
  }
  // An unmatched path is the 404 route, which needs a tab title like any other.
  if (page === undefined) page = "Page not found";

  return page ? `${page} · ${APP_NAME}` : APP_NAME;
}

export function usePageChrome(): void {
  const { pathname } = useLocation();
  // A path rather than a boolean "first render" flag: StrictMode mounts effects
  // twice, and a flag would be spent on the discarded pass.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    document.title = pageTitleFor(pathname);

    const previous = handled.current;
    handled.current = pathname;
    // Initial load only sets the title. The browser has already put focus at
    // the top of the document, and a deep-linked page may have autofocused
    // something of its own (the reset-password field) — taking focus back
    // would undo both.
    if (previous === null || previous === pathname) return;

    // preventScroll: the region starts at the top of the new page anyway, and
    // scrolling to it fights the router's own scroll restoration.
    document.getElementById(MAIN_REGION_ID)?.focus({ preventScroll: true });
  }, [pathname]);
}
