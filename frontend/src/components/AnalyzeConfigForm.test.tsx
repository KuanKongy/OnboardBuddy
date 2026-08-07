import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api";
import { AnalyzeConfigForm, DEFAULT_ANALYZE_CONFIG, analyzeRequestBody } from "./AnalyzeConfigForm";

/**
 * Import bug A, the client half.
 *
 * When the GitHub connection is dead, the branch and commit pickers fall back
 * to "only this branch / branch head" — the Bug #68 warnings already stop that
 * from reading as the truth about the repository, but "couldn't be loaded" is
 * a dead end when the user is the one who can fix it. These two cases pin the
 * split: a reconnect-required failure names the fix and routes to it; anything
 * else keeps the generic warning and offers no link to a page that would not
 * help.
 */

// Partial mock: the REAL ApiError class must flow through, because the
// component's classifier is an `instanceof` check. A hand-rolled stub class
// passes every assertion here and none in the browser.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});

const mockApi = vi.mocked(apiFetch);

/** How the API reports a stored GitHub connection that can no longer be used. */
const RECONNECT_ERROR = () =>
  new ApiError("Authorize the GitHub App from Account Settings, then refresh installations.", 403, {
    code: "github_reconnect_required",
  });

/**
 * Routes the three lists the form loads. `githubError` is what the two
 * GitHub-backed calls reject with; scopes come from our own API and always
 * answer, so a scope warning appearing would be this test's own noise.
 */
function respondWith(githubError: Error) {
  mockApi.mockImplementation(async (path: string) => {
    if (path.includes("/branches") || path.includes("/commits")) throw githubError;
    if (path.endsWith("/scopes")) return { scopes: [] };
    return {};
  });
}

function renderForm() {
  return render(
    <MemoryRouter>
      <AnalyzeConfigForm
        projectId="proj-1"
        repoOwner="acme"
        repoName="rocket"
        installationId="42"
        defaultBranch="main"
        config={DEFAULT_ANALYZE_CONFIG}
        onChange={() => {}}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockApi.mockReset();
});

describe("AnalyzeConfigForm — a dead GitHub connection names its own fix", () => {
  it("offers reconnect on both GitHub-backed lists when the connection is gone", async () => {
    respondWith(RECONNECT_ERROR());
    renderForm();

    expect(
      await screen.findByText(/needs to be re-authorized, so only main is offered/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/needs to be re-authorized, so recent commits can't be listed/),
    ).toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: "Reconnect GitHub in Account settings" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "/settings");

    // The generic copy would tell the user their request failed and stop there.
    expect(screen.queryByText(/Branch list couldn't be loaded/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Commit history couldn't be loaded/)).not.toBeInTheDocument();
  });

  it("keeps the generic warning, and no link, for a failure reconnecting cannot fix", async () => {
    respondWith(new Error("Network request failed"));
    renderForm();

    expect(
      await screen.findByText(/Branch list couldn't be loaded, so only main is offered/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Commit history couldn't be loaded/)).toBeInTheDocument();

    // Sending someone to re-authorize a connection that is fine is a wrong
    // instruction, not a harmless extra one.
    expect(screen.queryByRole("link", { name: /Reconnect GitHub/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/needs to be re-authorized/)).not.toBeInTheDocument();
  });
});

/**
 * The commit subject is the one thing about a run the API cannot look up for
 * itself, so the form carries it. It is only meaningful next to the sha it came
 * from: sent on its own it would label the run with a commit it did not
 * analyze, which is exactly what the branch-head case would do with a stale
 * message left in the config.
 */
describe("analyzeRequestBody — commit subject", () => {
  it("forwards the subject alongside a pinned sha", () => {
    const body = analyzeRequestBody({
      ...DEFAULT_ANALYZE_CONFIG,
      commit: "abc1234def5678",
      commitMessage: "Add refresh-token rotation",
    });
    expect(body.commit).toBe("abc1234def5678");
    expect(body.commit_message).toBe("Add refresh-token rotation");
  });

  it("omits it on the branch head, even with a message still in the config", () => {
    const body = analyzeRequestBody({
      ...DEFAULT_ANALYZE_CONFIG,
      commit: "",
      commitMessage: "Add refresh-token rotation",
    });
    expect(body).not.toHaveProperty("commit_message");
    expect(body).not.toHaveProperty("commit");
  });

  it("omits it for a sha the picker never supplied a message for", () => {
    const body = analyzeRequestBody({ ...DEFAULT_ANALYZE_CONFIG, commit: "abc1234def5678" });
    expect(body.commit).toBe("abc1234def5678");
    expect(body).not.toHaveProperty("commit_message");
  });
});
