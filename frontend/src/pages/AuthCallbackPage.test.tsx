import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

type AuthChangeCallback = (event: string, session: unknown) => void;
let authCallback: AuthChangeCallback | null = null;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn((cb: AuthChangeCallback) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
  },
}));

const { AuthCallbackPage } = await import("./AuthCallbackPage");

function renderCallback(search: string) {
  // The page reads window.location.search directly (Supabase controls the
  // real URL), so the query must live on the window, not just the router.
  window.history.pushState({}, "", `/auth/callback${search}`);
  return render(
    <MemoryRouter initialEntries={[`/auth/callback${search}`]}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/import" element={<div>IMPORT PAGE</div>} />
        <Route path="/dashboard" element={<div>DASHBOARD PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authCallback = null;
});

afterEach(() => {
  window.history.pushState({}, "", "/");
});

describe("AuthCallbackPage next handling", () => {
  it("honors a local ?next= target on sign-in (the signup-to-import path)", async () => {
    renderCallback("?next=/import");
    await act(async () => {
      authCallback?.("SIGNED_IN", { user: { id: "u1" } });
    });
    await screen.findByText("IMPORT PAGE");
  });

  it("rejects non-local next values and falls back to the dashboard", async () => {
    renderCallback("?next=//evil.example");
    await act(async () => {
      authCallback?.("SIGNED_IN", { user: { id: "u1" } });
    });
    await screen.findByText("DASHBOARD PAGE");
  });
});
