/**
 * Per-graph, per-project "clicking a box opens it" preference.
 *
 * The default everywhere is select-first: a click selects the box, highlights
 * its edges and explains it in the side panel, and the Open button in that
 * panel is what navigates. Owner I1 asked for that split on the Architecture
 * map — "You may add the button, to allow drilling down, it shouldn't by
 * default" — and the Dependencies canvas follows it. Readers who preferred the
 * old one-click drill can turn it back on, per surface, because the two maps
 * are used differently: one is browsed, one is read.
 *
 * Two keys rather than one, because the toggles are independent. The Classes
 * tab rides the "dependencies" key — it is the same page and the same gesture.
 *
 * The project id is part of the key: the same reader browses a familiar repo
 * one way and a new one another, so the choice belongs to the pair, and the
 * toggles live in Project settings → Viewing rather than in the account page.
 * No migration off the old project-less key — the pref is a browser-local
 * convenience, and the cost of a stale one is a single click.
 */

export type GraphSurface = "dependencies" | "architecture";

const PREFERENCE_KEY_PREFIX = "onboardbuddy:graph-auto-drill:";

const key = (surface: GraphSurface, projectId: string) =>
  `${PREFERENCE_KEY_PREFIX}${surface}:${projectId}`;

/**
 * Whether a click on a group/component box should open it immediately. Only
 * the explicit string "on" enables it, so an absent or half-written value
 * fails safe to the select-first model the copy on screen describes. Read per
 * click rather than held in state, which is what makes the toggle take effect
 * in every open tab with no reload and nothing to subscribe to.
 */
export function autoDrillEnabled(surface: GraphSurface, projectId: string): boolean {
  try {
    return localStorage.getItem(key(surface, projectId)) === "on";
  } catch {
    // Storage blocked (private mode, embedded webview) — keep the default,
    // where every route into a level still has a visible button.
    return false;
  }
}

export function setAutoDrillEnabled(
  surface: GraphSurface,
  projectId: string,
  enabled: boolean,
): void {
  try {
    if (enabled) localStorage.setItem(key(surface, projectId), "on");
    else localStorage.removeItem(key(surface, projectId));
  } catch {
    // Best-effort only; nothing to fall back to.
  }
}
