import { render, screen, fireEvent, act } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeToggle, applyThemeMode } from "./ThemeToggle";

type MediaListener = (e: { matches: boolean }) => void;

/** matchMedia stub that can also fire live preference changes. */
function stubMatchMedia(prefersDark: boolean) {
  const listeners: MediaListener[] = [];
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: prefersDark && query.includes("prefers-color-scheme: dark"),
    media: query,
    addEventListener: (_: string, fn: MediaListener) => listeners.push(fn),
    removeEventListener: (_: string, fn: MediaListener) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  })) as unknown as typeof window.matchMedia;
  return { fireChange: (matches: boolean) => listeners.forEach((fn) => fn({ matches })) };
}

function renderToggle() {
  return render(
    <TooltipProvider>
      <ThemeToggle />
    </TooltipProvider>,
  );
}

describe("ThemeToggle (2-state, OS-seeded)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("seeds from a dark OS without pinning anything to storage", () => {
    stubMatchMedia(true);
    renderToggle();

    expect(screen.getByRole("button", { name: /theme: dark/i })).toBeInTheDocument();
    expect(localStorage.getItem("onboardbuddy:theme")).toBeNull();
  });

  it("one click flips dark OS to light and pins the choice", () => {
    stubMatchMedia(true);
    renderToggle();

    fireEvent.click(screen.getByRole("button", { name: /theme: dark/i }));

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("onboardbuddy:theme")).toBe("light");
    expect(screen.getByRole("button", { name: /theme: light/i })).toBeInTheDocument();
  });

  it("a stored choice beats the OS preference", () => {
    stubMatchMedia(true);
    localStorage.setItem("onboardbuddy:theme", "light");
    renderToggle();

    expect(screen.getByRole("button", { name: /theme: light/i })).toBeInTheDocument();
  });

  it("follows a live OS flip until pinned, then stops following", () => {
    const media = stubMatchMedia(false);
    renderToggle();
    expect(screen.getByRole("button", { name: /theme: light/i })).toBeInTheDocument();

    // Unpinned: OS flip to dark is mirrored.
    act(() => media.fireChange(true));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByRole("button", { name: /theme: dark/i })).toBeInTheDocument();

    // Pin light explicitly; a later OS flip must be ignored.
    fireEvent.click(screen.getByRole("button", { name: /theme: dark/i }));
    expect(localStorage.getItem("onboardbuddy:theme")).toBe("light");
    act(() => media.fireChange(true));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("treats the legacy 'system' stored value as unset", () => {
    stubMatchMedia(true);
    localStorage.setItem("onboardbuddy:theme", "system");
    renderToggle();

    // Seeded from the (dark) OS, not from the legacy value.
    expect(screen.getByRole("button", { name: /theme: dark/i })).toBeInTheDocument();
    // Still unpinned: storage untouched until a click.
    expect(localStorage.getItem("onboardbuddy:theme")).toBe("system");
  });

  it("applyThemeMode sets the class and persists the explicit mode", () => {
    applyThemeMode("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("onboardbuddy:theme")).toBe("dark");

    applyThemeMode("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("onboardbuddy:theme")).toBe("light");
  });
});
