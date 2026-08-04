import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GITHUB_NEXT_KEY } from "@/hooks/useGitHubReturn";

const apiFetch = vi.fn();
vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const connectGithub = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ connectGithub }),
}));

const { GitHubReturnFlow } = await import("./GitHubReturnFlow");

function renderAt(query: string, { strict = false } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[`/github/oauth/callback${query}`]}>
      <Routes>
        <Route path="/github/oauth/callback" element={<GitHubReturnFlow />} />
        <Route path="/import" element={<div>IMPORT PAGE</div>} />
        <Route path="/settings" element={<div>SETTINGS PAGE</div>} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

function callsTo(path: string) {
  return apiFetch.mock.calls.filter((call) => call[0] === path);
}

beforeEach(() => {
  apiFetch.mockReset().mockResolvedValue({});
  connectGithub.mockReset();
  sessionStorage.clear();
});

describe("GitHubReturnFlow", () => {
  it("handles the combined install: completes OAuth BEFORE linking, then lands on import", async () => {
    renderAt("?code=c1&state=s1&installation_id=42&setup_action=install");
    await screen.findByText("IMPORT PAGE");

    expect(apiFetch.mock.calls[0]![0]).toBe("/github/oauth/complete");
    expect(JSON.parse((apiFetch.mock.calls[0]![1] as { body: string }).body)).toEqual({
      code: "c1",
      state: "s1",
    });
    expect(apiFetch.mock.calls[1]![0]).toBe("/github/installations/link");
    expect(JSON.parse((apiFetch.mock.calls[1]![1] as { body: string }).body)).toEqual({
      installation_id: "42",
      state: "s1",
    });
  });

  it("handles a pure re-authorize (code+state, no installation) and honors the stored next", async () => {
    sessionStorage.setItem(GITHUB_NEXT_KEY, "/settings");
    renderAt("?code=c1&state=s1");
    await screen.findByText("SETTINGS PAGE");

    expect(callsTo("/github/oauth/complete")).toHaveLength(1);
    expect(callsTo("/github/installations/link")).toHaveLength(0);
    expect(sessionStorage.getItem(GITHUB_NEXT_KEY)).toBeNull();
  });

  it("handles a legacy install arrival (state without code) by linking only", async () => {
    renderAt("?installation_id=42&state=s1");
    await screen.findByText("IMPORT PAGE");

    expect(callsTo("/github/oauth/complete")).toHaveLength(0);
    expect(callsTo("/github/installations/link")).toHaveLength(1);
  });

  it("shows a success card for GitHub-initiated updates (no state) without calling the API", async () => {
    renderAt("?installation_id=42&setup_action=update");
    await screen.findByText("GitHub installation updated");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("shows the pending card for setup_action=request", async () => {
    renderAt("?setup_action=request");
    await screen.findByText("Installation requested");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("names a cancellation instead of surfacing raw params", async () => {
    renderAt("?error=access_denied");
    await screen.findByText("You cancelled on GitHub.");
  });

  it("surfaces backend errors (e.g. an expired state token)", async () => {
    apiFetch.mockRejectedValueOnce(new Error("Installation state expired"));
    renderAt("?code=c1&state=s1");
    await screen.findByText("Installation state expired");
    await screen.findByText("GitHub connection failed");
  });

  it("offers the connect hop when a legacy link fails for a never-connected user", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === "/github/installations/link") return Promise.reject(new Error("403"));
      if (path === "/github/installations") return Promise.resolve({ github_connected: false });
      return Promise.resolve({});
    });
    renderAt("?installation_id=42&state=s1");
    await screen.findByText("One more step");

    await userEvent.setup().click(screen.getByRole("button", { name: /connect github/i }));
    expect(connectGithub).toHaveBeenCalledWith("/import");
  });

  it("fires the single-use OAuth code exactly once under StrictMode", async () => {
    renderAt("?code=c1&state=s1&installation_id=42", { strict: true });
    await screen.findByText("IMPORT PAGE");
    expect(callsTo("/github/oauth/complete")).toHaveLength(1);
    expect(callsTo("/github/installations/link")).toHaveLength(1);
  });
});
