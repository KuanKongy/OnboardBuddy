import { autoDrillEnabled, setAutoDrillEnabled } from "./graphPrefs";

/**
 * The default decides what a click does on two graphs, so it is worth pinning:
 * anything other than the exact stored "on" has to read as off, or a
 * half-written value silently brings back the gesture the copy says is gone.
 */
describe("graph auto-drill preference", () => {
  beforeEach(() => localStorage.clear());

  it("is off unless the surface's own key says on", () => {
    expect(autoDrillEnabled("dependencies")).toBe(false);

    setAutoDrillEnabled("dependencies", true);
    expect(localStorage.getItem("onboardbuddy:graph-auto-drill:dependencies")).toBe("on");
    expect(autoDrillEnabled("dependencies")).toBe(true);
    // Two independent toggles, not one shared flag.
    expect(autoDrillEnabled("architecture")).toBe(false);

    setAutoDrillEnabled("dependencies", false);
    expect(autoDrillEnabled("dependencies")).toBe(false);
  });

  it("fails safe on a value it did not write", () => {
    localStorage.setItem("onboardbuddy:graph-auto-drill:architecture", "true");
    expect(autoDrillEnabled("architecture")).toBe(false);
  });
});
