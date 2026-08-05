import { autoDrillEnabled, setAutoDrillEnabled } from "./graphPrefs";

/**
 * The default decides what a click does on two graphs, so it is worth pinning:
 * anything other than the exact stored "on" has to read as off, or a
 * half-written value silently brings back the gesture the copy says is gone.
 * The project id in the key is pinned for the same reason — the toggle is
 * offered inside one project's settings, so leaking into every other project
 * would change a gesture the reader never touched there.
 */
describe("graph auto-drill preference", () => {
  beforeEach(() => localStorage.clear());

  it("is off unless the surface's own key says on", () => {
    expect(autoDrillEnabled("dependencies", "proj-1")).toBe(false);

    setAutoDrillEnabled("dependencies", "proj-1", true);
    expect(localStorage.getItem("onboardbuddy:graph-auto-drill:dependencies:proj-1")).toBe("on");
    expect(autoDrillEnabled("dependencies", "proj-1")).toBe(true);
    // Two independent toggles, not one shared flag.
    expect(autoDrillEnabled("architecture", "proj-1")).toBe(false);

    setAutoDrillEnabled("dependencies", "proj-1", false);
    expect(autoDrillEnabled("dependencies", "proj-1")).toBe(false);
  });

  it("keeps one project's choice out of another's", () => {
    setAutoDrillEnabled("dependencies", "proj-1", true);
    setAutoDrillEnabled("architecture", "proj-2", true);

    expect(autoDrillEnabled("dependencies", "proj-2")).toBe(false);
    expect(autoDrillEnabled("architecture", "proj-1")).toBe(false);

    // Turning one off leaves the other project's stored value alone.
    setAutoDrillEnabled("dependencies", "proj-1", false);
    expect(autoDrillEnabled("architecture", "proj-2")).toBe(true);
  });

  it("fails safe on a value it did not write", () => {
    localStorage.setItem("onboardbuddy:graph-auto-drill:architecture:proj-1", "true");
    expect(autoDrillEnabled("architecture", "proj-1")).toBe(false);
  });
});
