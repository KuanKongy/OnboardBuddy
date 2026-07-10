import { useEffect, useState } from "react";

/**
 * Tracks whether the `dark` class is present on `<html>`, re-rendering when
 * `ThemeToggle` flips it. Needed for the few spots (react-flow canvas props)
 * that require a resolved color string rather than a Tailwind class.
 */
export function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(
    () => document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
