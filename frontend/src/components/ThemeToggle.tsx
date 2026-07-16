import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const THEME_KEY = "onboardbuddy:theme";

export type ThemeMode = "system" | "light" | "dark";

/** system → light → dark → system. */
const NEXT_MODE: Record<ThemeMode, ThemeMode> = { system: "light", light: "dark", dark: "system" };

const MODE_LABEL: Record<ThemeMode, string> = {
  system: "System (follows your browser)",
  light: "Light",
  dark: "Dark",
};

function readMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  } catch {
    return true;
  }
}

/** Resolve the mode to a concrete class on <html>; persist the MODE (not the result). */
export function applyThemeMode(mode: ThemeMode): void {
  const dark = mode === "dark" || (mode === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // Best-effort only; nothing to fall back to.
  }
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(() => readMode());

  // While in system mode, follow live OS/browser theme changes.
  useEffect(() => {
    if (mode !== "system") return;
    let media: MediaQueryList | undefined;
    try {
      media = window.matchMedia?.("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    if (!media?.addEventListener) return;
    const onChange = () => applyThemeMode("system");
    media.addEventListener("change", onChange);
    return () => media?.removeEventListener("change", onChange);
  }, [mode]);

  const cycle = () => {
    const next = NEXT_MODE[mode];
    applyThemeMode(next);
    setMode(next);
  };

  const Icon = mode === "system" ? Monitor : mode === "light" ? Sun : Moon;
  const label = `Theme: ${MODE_LABEL[mode]} — click for ${MODE_LABEL[NEXT_MODE[mode]].toLowerCase()}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" onClick={cycle} aria-label={label}>
          <Icon className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
