/**
 * Per-graph "clicking a box opens it" preference.
 *
 * The default everywhere is select-first: a click selects the box, highlights
 * its edges and explains it in the side panel, and the Open button on the card
 * (or in the panel) is what navigates. Owner I1 asked for that split on the
 * Architecture map — "You may add the button, to allow drilling down, it
 * shouldn't by default" — and the Dependencies canvas now follows it. Readers
 * who preferred the old one-click drill can turn it back on, per surface,
 * because the two maps are used differently: one is browsed, one is read.
 *
 * Two keys rather than one, because the toggles are independent. The Classes
 * tab rides the "dependencies" key — it is the same page and the same gesture.
 */

export type GraphSurface = "dependencies" | "architecture";

const PREFERENCE_KEY_PREFIX = "onboardbuddy:graph-auto-drill:";

/**
 * Whether a click on a group/component box should open it immediately. Only
 * the explicit string "on" enables it, so an absent or half-written value
 * fails safe to the select-first model the copy on screen describes. Read per
 * click rather than held in state, which is what makes the toggle take effect
 * in every open tab with no reload and nothing to subscribe to.
 */
export function autoDrillEnabled(surface: GraphSurface): boolean {
  try {
    return localStorage.getItem(`${PREFERENCE_KEY_PREFIX}${surface}`) === "on";
  } catch {
    // Storage blocked (private mode, embedded webview) — keep the default,
    // where every route into a level still has a visible button.
    return false;
  }
}

export function setAutoDrillEnabled(surface: GraphSurface, enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(`${PREFERENCE_KEY_PREFIX}${surface}`, "on");
    else localStorage.removeItem(`${PREFERENCE_KEY_PREFIX}${surface}`);
  } catch {
    // Best-effort only; nothing to fall back to.
  }
}
