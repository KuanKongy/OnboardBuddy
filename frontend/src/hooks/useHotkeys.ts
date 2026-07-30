import { useEffect, useRef } from "react";

/**
 * App-wide keyboard shortcuts, hand-rolled (no hotkey dependency). Bindings
 * are keyed by `e.key` ("[", "]", "1".."9", "ArrowLeft", "Escape", "?", …).
 * Every binding is suppressed while the user is typing, while any modifier
 * is held, and while an overlay is open (tours, Radix dialogs, the receipt
 * modal — anything carrying role="dialog" or data-tour-overlay).
 */

const PREFERENCE_KEY = "onboardbuddy:hotkeys";

/**
 * Whether the reader wants single-key shortcuts at all. Absent means on; only the
 * explicit string "off" disables, so a partly-written value fails safe. Read per
 * keypress rather than held in state, which is what makes the toggle take effect in
 * every open tab with no reload and nothing to subscribe to.
 */
export function hotkeysEnabled(): boolean {
  try {
    return localStorage.getItem(PREFERENCE_KEY) !== "off";
  } catch {
    // Storage blocked (private mode, embedded webview) — keep the shortcuts.
    return true;
  }
}

export function setHotkeysEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(PREFERENCE_KEY);
    else localStorage.setItem(PREFERENCE_KEY, "off");
  } catch {
    // Best-effort only; nothing to fall back to.
  }
}

export function shouldIgnoreHotkey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return true;
  if (!hotkeysEnabled()) return true;
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const target = e.target as HTMLElement | null;
  if (target) {
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return true;
  }
  if (document.querySelector('[data-tour-overlay], [role="dialog"]')) return true;
  return false;
}

export function useHotkeys(
  bindings: Record<string, (e: KeyboardEvent) => void>,
  enabled = true,
): void {
  // Keep the latest bindings without re-subscribing on every render.
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      const handler = bindingsRef.current[e.key];
      if (!handler || shouldIgnoreHotkey(e)) return;
      e.preventDefault();
      handler(e);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
