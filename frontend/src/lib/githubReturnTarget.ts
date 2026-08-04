/**
 * Where the next GitHub round trip should land afterwards, stored in
 * sessionStorage (the target is meaningful only to the tab that left).
 *
 * The target is SINGLE-USE by design: it is consumed by the first arrival at
 * a GitHub return page, whatever that arrival's outcome. A stale "/settings"
 * written by an earlier Settings visit once survived an errored flow and
 * routed a brand-new registration to Account Settings.
 */
const KEY = "onboardbuddy.github.next";

/**
 * Module-level cache so StrictMode's second dev mount (whose state
 * initializers re-run after the storage copy is consumed) sees the same
 * target. Every real return from GitHub is a full page load and gets a
 * fresh module.
 */
let taken: string | null = null;

function isLocalPath(value: string | null | undefined): value is string {
  return !!value && value.startsWith("/") && !value.startsWith("//");
}

/** Record the target; clears first so an abandoned earlier attempt can never
 *  redirect a later, unrelated return. */
export function setGithubReturnTarget(next?: string): void {
  taken = null;
  sessionStorage.removeItem(KEY);
  if (isLocalPath(next)) sessionStorage.setItem(KEY, next);
}

/** Consume the target (default /import). Storage is cleared on first read;
 *  repeat calls in the same page load return the cached value. */
export function takeGithubReturnTarget(): string {
  if (taken !== null) return taken;
  const raw = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  taken = isLocalPath(raw) ? raw : "/import";
  return taken;
}

/** Forget any pending target (all sign-out paths call this). */
export function clearGithubReturnTarget(): void {
  taken = null;
  sessionStorage.removeItem(KEY);
}
