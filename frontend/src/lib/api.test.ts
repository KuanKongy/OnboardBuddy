import { apiFetch } from "./api";

/**
 * Bug #7: `apiFetch` set `Content-Type: application/json` on every request,
 * including GETs that have no body. Silent against our own Express server, so
 * a regression here is invisible until something downstream is stricter — or
 * until the header quietly makes every cross-origin read a preflighted
 * request. Pinned because nothing else would notice.
 */

/**
 * Held outside the factory so the same function objects survive
 * `vi.resetModules()` — the 401 tests need a fresh `api` module (its sign-out
 * latch is module state) while still asserting on one `signOut` spy.
 */
const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("./supabase", () => ({ supabase: { auth: authMocks } }));

vi.mock("./runtimeConfig", () => ({ runtimeConfig: { apiUrl: "http://api.test" } }));

const fetchMock = vi.fn();

function headersOf(call: number): Record<string, string> {
  return (fetchMock.mock.calls[call]![1] as RequestInit).headers as Record<string, string>;
}

describe("apiFetch headers (#7)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    authMocks.getSession.mockResolvedValue({ data: { session: null } });
  });

  it("omits Content-Type on a bodyless GET and sends it when there is a body", async () => {
    await apiFetch("/projects");
    await apiFetch("/projects", { method: "POST", body: JSON.stringify({ a: 1 }) });

    expect(headersOf(0)).not.toHaveProperty("Content-Type");
    expect(headersOf(1)["Content-Type"]).toBe("application/json");
  });

  it("lets an explicit caller header win", async () => {
    await apiFetch("/upload", {
      method: "POST",
      body: "raw",
      headers: { "Content-Type": "text/plain" },
    });

    expect(headersOf(0)["Content-Type"]).toBe("text/plain");
  });
});

// Exactly one signOut: a page load fires several requests and they all 401 together.
describe("apiFetch on a final 401 (#74/H3)", () => {
  /** Fresh module = fresh latch, same spies. */
  async function freshApiFetch() {
    vi.resetModules();
    return (await import("./api")).apiFetch;
  }

  const unauthorized = { ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    authMocks.getSession.mockResolvedValue({ data: { session: { access_token: "stale-token" } } });
    authMocks.refreshSession.mockReset();
    authMocks.signOut.mockReset().mockResolvedValue({ error: null });
  });

  it("signs out exactly once when two concurrent requests both hit a dead session", async () => {
    authMocks.refreshSession.mockResolvedValue({ error: { message: "Invalid Refresh Token" } });
    fetchMock.mockResolvedValue(unauthorized);
    const request = await freshApiFetch();

    const results = await Promise.allSettled([request("/projects"), request("/auth/me")]);

    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(authMocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out when the refresh succeeds but the retried request is still 401", async () => {
    authMocks.refreshSession.mockResolvedValue({ error: null });
    fetchMock.mockResolvedValue(unauthorized);
    const request = await freshApiFetch();

    await expect(request("/projects")).rejects.toMatchObject({ status: 401 });
    expect(authMocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("does not sign out when the refresh recovers the session", async () => {
    authMocks.refreshSession.mockResolvedValue({ error: null });
    fetchMock
      .mockResolvedValueOnce(unauthorized)
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    const request = await freshApiFetch();

    await expect(request("/projects")).resolves.toEqual({ projects: [] });
    expect(authMocks.signOut).not.toHaveBeenCalled();
  });
});
