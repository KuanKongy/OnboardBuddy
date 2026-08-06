import { act, render } from "@testing-library/react";

/**
 * The GitHub avatar re-sync. GoTrue copies the picture into user_metadata once,
 * when the identity is first created, so an account that linked GitHub later
 * (or whose GitHub picture changed) renders initials forever. Two ways this
 * fix can go wrong without failing loudly: it writes on every TOKEN_REFRESHED
 * (a PUT to GoTrue every hour, per tab), or it overwrites an avatar URL the
 * user set by hand in Account settings.
 *
 * The latch is module-level, so every case resets the module registry and
 * re-imports the provider rather than sharing one instance.
 */

type AuthChangeCallback = (event: string, session: unknown) => void;

const mocks = vi.hoisted(() => ({
  authCallback: null as AuthChangeCallback | null,
  updateUser: vi.fn(async () => ({ data: { user: null }, error: null })),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn((cb: AuthChangeCallback) => {
        mocks.authCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      updateUser: mocks.updateUser,
    },
  },
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({})),
  ApiError: class ApiError extends Error {},
}));

const GITHUB_AVATAR = "https://avatars.githubusercontent.com/u/1?v=4";

function sessionWith(metadataAvatar?: string) {
  return {
    user: {
      id: "u1",
      user_metadata: metadataAvatar === undefined ? {} : { avatar_url: metadataAvatar },
      identities: [{ provider: "github", identity_data: { avatar_url: GITHUB_AVATAR } }],
    },
  };
}

/** Fresh module (fresh latch) + a mounted provider listening for auth events. */
async function mountProvider() {
  vi.resetModules();
  mocks.authCallback = null;
  const { AuthProvider } = await import("./AuthContext");
  await act(async () => {
    render(
      <AuthProvider>
        <div />
      </AuthProvider>,
    );
  });
}

async function fire(event: string, session: unknown) {
  await act(async () => {
    mocks.authCallback?.(event, session);
  });
}

beforeEach(() => {
  mocks.updateUser.mockClear();
});

describe("AuthProvider GitHub avatar sync", () => {
  it("copies the GitHub avatar into user metadata when there is none", async () => {
    await mountProvider();

    await fire("SIGNED_IN", sessionWith(undefined));

    expect(mocks.updateUser).toHaveBeenCalledTimes(1);
    expect(mocks.updateUser).toHaveBeenCalledWith({ data: { avatar_url: GITHUB_AVATAR } });
  });

  it("writes once per page load, however many auth events arrive", async () => {
    await mountProvider();

    await fire("SIGNED_IN", sessionWith(undefined));
    await fire("TOKEN_REFRESHED", sessionWith(undefined));
    await fire("SIGNED_IN", sessionWith(undefined));

    expect(mocks.updateUser).toHaveBeenCalledTimes(1);
  });

  it("never overwrites an avatar URL the user set themselves", async () => {
    await mountProvider();

    // On the app's own allowlist, so this is a URL the profile form accepts —
    // it is not GitHub's, which is the only reason it must survive.
    await fire("SIGNED_IN", sessionWith("https://gravatar.com/avatar/abc"));

    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("writes nothing when the stored avatar is already the GitHub one", async () => {
    await mountProvider();

    await fire("SIGNED_IN", sessionWith(GITHUB_AVATAR));

    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});
