import { pageTitleFor } from "./usePageChrome";

// The map is the part that rots: a new route in App.tsx reads "Page not found" in the
// tab while rendering perfectly. One test per route SHAPE, not per route.
describe("pageTitleFor", () => {
  it("names each shape of route", () => {
    expect(pageTitleFor("/")).toBe("OnboardBuddy");
    expect(pageTitleFor("/login")).toBe("Log in · OnboardBuddy");
    expect(pageTitleFor("/privacy")).toBe("Privacy & AI transparency · OnboardBuddy");
    expect(pageTitleFor("/terms")).toBe("Terms of Service · OnboardBuddy");
    expect(pageTitleFor("/import")).toBe("Import repository · OnboardBuddy");
    expect(pageTitleFor("/projects/abc-123")).toBe("Project overview · OnboardBuddy");
    expect(pageTitleFor("/projects/abc-123/onboarding")).toBe("Your onboarding · OnboardBuddy");
    // The retired path still routes, so it must still be labelled.
    expect(pageTitleFor("/projects/abc-123/walkthrough")).toBe("Tutorials · OnboardBuddy");
    expect(pageTitleFor("/projects/abc-123/")).toBe("Project overview · OnboardBuddy");
    expect(pageTitleFor("/nope")).toBe("Page not found · OnboardBuddy");
  });
});
