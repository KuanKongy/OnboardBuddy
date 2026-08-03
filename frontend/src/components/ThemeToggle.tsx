import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const THEME_KEY = "onboardbuddy:theme";

export type ThemeMode = "light" | "dark";

/**
 * Two-state switch seeded from the OS: with nothing stored the app shows the
 * system's theme (and keeps following live OS flips); the first click pins an
 * explicit light/dark choice and the OS stops mattering. (The index.html
 * bootstrap resolves the same way, so there's no flash on load.)
 */
function readStoredMode(): ThemeMode | null {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    // Anything else — including the legacy "system" value — means "not pinned".
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  } catch {
    return true;
  }
}

/** Apply an explicit choice: set the class and pin it in storage. */
export function applyThemeMode(mode: ThemeMode): void {
  document.documentElement.classList.toggle("dark", mode === "dark");
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // Best-effort only; nothing to fall back to.
  }
}

export function ThemeToggle() {
  const [pinned, setPinned] = useState<boolean>(() => readStoredMode() !== null);
  const [mode, setMode] = useState<ThemeMode>(
    () => readStoredMode() ?? (systemPrefersDark() ? "dark" : "light"),
  );

  // Until the user picks explicitly, follow live OS/browser theme changes.
  useEffect(() => {
    if (pinned) return;
    let media: MediaQueryList | undefined;
    try {
      media = window.matchMedia?.("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    if (!media?.addEventListener) return;
    const onChange = (e: MediaQueryListEvent) => {
      const next: ThemeMode = e.matches ? "dark" : "light";
      document.documentElement.classList.toggle("dark", next === "dark");
      setMode(next);
    };
    media.addEventListener("change", onChange);
    return () => media?.removeEventListener("change", onChange);
  }, [pinned]);

  const toggle = () => {
    const next: ThemeMode = mode === "dark" ? "light" : "dark";
    applyThemeMode(next);
    setMode(next);
    setPinned(true);
  };

  const Icon = mode === "dark" ? Moon : Sun;
  const label = `Theme: ${mode === "dark" ? "Dark" : "Light"}. Click for ${mode === "dark" ? "light" : "dark"}.`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" onClick={toggle} aria-label={label}>
          <Icon className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
