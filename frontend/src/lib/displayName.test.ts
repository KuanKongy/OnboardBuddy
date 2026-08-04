import { displayName } from "./displayName";

type Userish = Parameters<typeof displayName>[0];

function makeUser(overrides: Partial<NonNullable<Userish>>): Userish {
  return { user_metadata: {}, identities: [], email: undefined, ...overrides } as Userish;
}

describe("displayName", () => {
  it("prefers the profile full name", () => {
    expect(
      displayName(makeUser({ user_metadata: { full_name: "Nam Le", name: "x" }, email: "a@b.c" })),
    ).toBe("Nam Le");
  });

  it("falls back to the GitHub username when GitHub sent no profile name", () => {
    // The real shape GoTrue stores for a GitHub account with no public name:
    // user_name/preferred_username only.
    expect(
      displayName(
        makeUser({
          email: "ldnkoff@gmail.com",
          identities: [
            { provider: "github", identity_data: { user_name: "OnboardBuddy455" } },
          ] as unknown as NonNullable<Userish>["identities"],
        }),
      ),
    ).toBe("OnboardBuddy455");
  });

  it("falls back to the email local part, then a constant", () => {
    expect(displayName(makeUser({ email: "ldnkoff@gmail.com" }))).toBe("ldnkoff");
    expect(displayName(makeUser({}))).toBe("Account");
    expect(displayName(null)).toBe("Account");
  });
});
