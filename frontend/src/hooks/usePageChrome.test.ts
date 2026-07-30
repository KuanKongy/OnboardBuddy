import { pageTitleFor } from "./usePageChrome";

/**
 * The map is the part that rots: a new route gets added to App.tsx and its tab
 * silently reads "Page not found" — the page renders perfectly, so nothing else
 * catches it. One test over the shapes (top-level, project tab, index route,
 * landing, unmatched) rather than one per route.
 */
describe("pageTitleFor", () => {
  it("names each shape of route", () => {
    expect(pageTitleFor("/")).toBe("OnboardBuddy");
    expect(pageTitleFor("/login")).toBe("Log in · OnboardBuddy");
    expect(pageTitleFor("/import")).toBe("Import repository · OnboardBuddy");
    expect(pageTitleFor("/projects/abc-123")).toBe("Project overview · OnboardBuddy");
    expect(pageTitleFor("/projects/abc-123/onboarding")).toBe("Your onboarding · OnboardBuddy");
    // The retired path still routes, so it must still be labelled.
    expect(pageTitleFor("/projects/abc-123/walkthrough")).toBe("Tutorials · OnboardBuddy");
    expect(pageTitleFor("/projects/abc-123/")).toBe("Project overview · OnboardBuddy");
    expect(pageTitleFor("/nope")).toBe("Page not found · OnboardBuddy");
  });
});
