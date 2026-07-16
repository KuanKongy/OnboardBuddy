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
