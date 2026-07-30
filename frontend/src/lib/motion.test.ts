import { prefersReducedMotion, scrollBehavior } from "./motion";

// A matchMedia returning `undefined` reads as "no preference", so the app animates
// for the one reader who asked it not to and nothing looks wrong.
function mockMatchMedia(matches: boolean | undefined) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue({ matches }),
  });
}

describe("prefersReducedMotion", () => {
  it("reports the OS setting and jumps instead of gliding when it is on", () => {
    mockMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe("auto");
  });

  it("defaults to full motion when the setting is off", () => {
    mockMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("treats a non-boolean `matches` as no preference rather than as reduced", () => {
    mockMatchMedia(undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});
