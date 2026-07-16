import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeToggle, applyThemeMode } from "./ThemeToggle";

function stubMatchMedia(prefersDark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: prefersDark && query.includes("prefers-color-scheme: dark"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("ThemeToggle (3-state)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("applyThemeMode resolves system from the browser preference", () => {
    stubMatchMedia(true);
    applyThemeMode("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("onboardbuddy:theme")).toBe("system");

    stubMatchMedia(false);
    applyThemeMode("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("explicit light/dark override the browser preference", () => {
    stubMatchMedia(true);
    applyThemeMode("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("onboardbuddy:theme")).toBe("light");

    stubMatchMedia(false);
    applyThemeMode("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("onboardbuddy:theme")).toBe("dark");
  });

  it("cycles system → light → dark → system and persists each mode", () => {
    stubMatchMedia(true);
    render(
      <TooltipProvider>
        <ThemeToggle />
      </TooltipProvider>,
    );
    const button = screen.getByRole("button", { name: /theme: system/i });

    fireEvent.click(button); // system → light
    expect(localStorage.getItem("onboardbuddy:theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /theme: light/i })); // light → dark
    expect(localStorage.getItem("onboardbuddy:theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /theme: dark/i })); // dark → system
    expect(localStorage.getItem("onboardbuddy:theme")).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true); // browser prefers dark
  });
});
