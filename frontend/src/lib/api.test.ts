import { apiFetch } from "./api";

/**
 * Bug #7: `apiFetch` set `Content-Type: application/json` on every request,
 * including GETs that have no body. Silent against our own Express server, so
 * a regression here is invisible until something downstream is stricter — or
 * until the header quietly makes every cross-origin read a preflighted
 * request. Pinned because nothing else would notice.
 */

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      refreshSession: vi.fn(),
    },
  },
}));

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
