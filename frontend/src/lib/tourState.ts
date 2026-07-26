/**
 * Per-account tour dismissal state. Keys include the user id: a browser-global
 * flag survives DB wipes and account deletion, so a genuinely new user on the
 * same browser would never see a tour again (bug #49).
 *
 * Key prefixes are fixed per tour and must not change — changing one re-shows
 * that tour to every existing account.
 */

const TOUR_PREFIXES = {
  dashboard: "onboardbuddy:tour-dismissed",
  project: "onboardbuddy:project-tour-dismissed",
  onboardingLifecycle: "onboardbuddy:onboarding-tour-dismissed",
  onboardingReader: "onboardbuddy:reader-tour-dismissed",
  // The import wizard kept this key privately and browser-globally, so it was
  // the one tour still carrying bug #49: a genuinely new account on a browser
  // that had ever dismissed it never saw it again.
  import: "onboardbuddy:import-tour-dismissed",
} as const;

export type TourName = keyof typeof TOUR_PREFIXES;

function key(tour: TourName, userId: string): string {
  return `${TOUR_PREFIXES[tour]}:${userId}`;
}

export function tourDismissed(tour: TourName, userId: string): boolean {
  try {
    return localStorage.getItem(key(tour, userId)) === "1";
  } catch {
    // localStorage unavailable (private browsing, disabled storage) — treat as
    // dismissed so tours never auto-start in a loop.
    return true;
  }
}

export function dismissTour(tour: TourName, userId: string): void {
  try {
    localStorage.setItem(key(tour, userId), "1");
  } catch {
    // Best-effort only.
  }
}

export function resetTour(tour: TourName, userId: string): void {
  try {
    localStorage.removeItem(key(tour, userId));
  } catch {
    // Best-effort only.
  }
}

// ── Tour picker requests ────────────────────────────────────────────────
// The Help page's tour picker can request a tour on a page the user isn't
// on yet (e.g. "Start the reader tour" from /help navigates to a package
// reader). sessionStorage — not localStorage — so a stale request can't
// fire a tour days later if the tab is reused; it dies with the tab.
const REQUEST_KEY = "onboardbuddy:tour-request";

export function requestTour(tour: TourName): void {
  try {
    sessionStorage.setItem(REQUEST_KEY, tour);
  } catch {
    // Best-effort only.
  }
}

/** True (and consumes the request) when a pending request matches `tour`. */
export function consumeTourRequest(tour: TourName): boolean {
  try {
    if (sessionStorage.getItem(REQUEST_KEY) !== tour) return false;
    sessionStorage.removeItem(REQUEST_KEY);
    return true;
  } catch {
    return false;
  }
}
