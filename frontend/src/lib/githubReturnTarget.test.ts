import {
  clearGithubReturnTarget,
  setGithubReturnTarget,
  takeGithubReturnTarget,
} from "./githubReturnTarget";

const KEY = "onboardbuddy.github.next";

beforeEach(() => {
  sessionStorage.clear();
  clearGithubReturnTarget();
});

describe("githubReturnTarget", () => {
  it("is single-use: the first take clears storage, repeats return the cached value", () => {
    setGithubReturnTarget("/settings");
    expect(takeGithubReturnTarget()).toBe("/settings");
    expect(sessionStorage.getItem(KEY)).toBeNull();
    // StrictMode's second mount re-takes and must see the same target.
    expect(takeGithubReturnTarget()).toBe("/settings");
  });

  it("rejects non-local targets and defaults to /import", () => {
    setGithubReturnTarget("//evil.example");
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(takeGithubReturnTarget()).toBe("/import");

    clearGithubReturnTarget();
    sessionStorage.setItem(KEY, "https://evil.example");
    expect(takeGithubReturnTarget()).toBe("/import");
  });

  it("set replaces any stale value; clear forgets everything", () => {
    setGithubReturnTarget("/settings");
    setGithubReturnTarget(undefined);
    expect(takeGithubReturnTarget()).toBe("/import");

    setGithubReturnTarget("/settings");
    clearGithubReturnTarget();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(takeGithubReturnTarget()).toBe("/import");
  });
});
