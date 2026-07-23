const KEY = "onboardbuddy:font-size";

export type FontSizeChoice = "default" | "large" | "xlarge";

const PCT: Record<FontSizeChoice, string> = {
  default: "100%",
  large: "112.5%",
  xlarge: "125%",
};

/**
 * User-chosen base font size, scaling the ROOT font size so all rem-based
 * Tailwind sizing scales uniformly (browser-zoom semantics — spacing scales
 * too, which is intended). Mirrors ThemeToggle's read/apply/persist pattern;
 * `index.html`'s boot script applies the same mapping before first paint so
 * there's no flash on load.
 */
export function readStoredFontSize(): FontSizeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "large" || stored === "xlarge" ? stored : "default";
  } catch {
    return "default";
  }
}

export function applyFontSize(choice: FontSizeChoice): void {
  document.documentElement.style.fontSize = PCT[choice];
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Best-effort only; nothing to fall back to.
  }
}
