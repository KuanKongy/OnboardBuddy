import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ImportPage } from "./ImportPage";
import type { PreflightPreviewData } from "@/components/PreflightPreview";

/** A preview whose repo is big enough that the server demands acknowledgment. */
const OVERSIZED_PREVIEW: PreflightPreviewData = {
  languageInventory: { supportedFileCount: 4100, unsupportedFileCount: 900, unsupported: { python: 900 } },
  privacy: { mode: "full_ai", codeSnippetsLeaveSystem: true, llmCallsPlanned: true, evidenceSentToLlm: [] },
  estimates: {
    files: 5000, supportedFiles: 4100, symbols: 38000,
    symbolsSelectedForLlm: 2400, llmCalls: 2600, estimatedUsd: 9.4, costTier: "high",
  },
  depth: "full",
  warnings: ["This is a large scope."],
  confirmationsRequired: [
    "File count 5000 exceeds 3000",
    "Estimated cost tier is high",
  ],
  limitations: "coarse by design",
};

const REPOS = Array.from({ length: 137 }, (_, i) => ({
  full_name: `acme/service-${String(i).padStart(3, "0")}`,
  owner: "acme",
  name: `service-${String(i).padStart(3, "0")}`,
  default_branch: "main",
}));

const BRANCHES = ["main", "develop", "release/2026-07", "feature/graph-search"].map((name) => ({ name }));

vi.mock("@/components/PreflightPreview", async () => {
  const actual = await vi.importActual<typeof import("@/components/PreflightPreview")>(
    "@/components/PreflightPreview",
  );
  const { useState, useCallback } = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    // The REAL card is rendered (the frozen checkbox lives in it); only the
    // preflight job round-trip is faked, so the gate is exercised end to end.
    usePreflight: () => {
      const [preview, setPreview] = useState<PreflightPreviewData | null>(null);
      return {
        preview,
        previewing: false,
        error: "",
        run: useCallback(() => setPreview(OVERSIZED_PREVIEW), []),
        reset: useCallback(() => setPreview(null), []),
      };
    },
  };
});

/**
 * Server state the tests drive. GET and POST /projects are DIFFERENT calls with
 * different shapes — one mock answering both makes the page's cross-reference read
 * `undefined`.
 */
const SINGLE_INSTALLATION = [{ id: 42, account: { login: "acme" } }];

const apiState: {
  projects: Array<Record<string, unknown>>;
  conflictProjectId: string | null;
  projectRow: Record<string, unknown> | null;
  installations: Array<{ id: number; account: { login: string } }>;
  githubConnected: boolean;
  installationsFailure: "reconnect" | null;
} = {
  projects: [],
  conflictProjectId: null,
  projectRow: null,
  installations: SINGLE_INSTALLATION,
  githubConnected: true,
  installationsFailure: null,
};

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;
    body: Record<string, unknown>;
    constructor(message: string, status: number, body: Record<string, unknown>) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }
  return {
    ApiError,
    apiFetch: vi.fn(async (path: string, options?: RequestInit) => {
      const method = options?.method ?? "GET";
      if (path === "/github/app") return { name: "OnboardBuddy", install_url: "https://github.test/install" };
      if (path === "/github/installations") {
        if (apiState.installationsFailure === "reconnect") {
          throw new ApiError(
            "Authorize the GitHub App from Account Settings, then refresh installations.",
            403,
            { code: "github_reconnect_required" },
          );
        }
        return {
          github_connected: apiState.githubConnected,
          github_username: apiState.githubConnected ? "acme-bot" : null,
          installations: apiState.installations,
        };
      }
      if (path.startsWith("/github/repos?")) return { repos: REPOS };
      if (path.includes("/branches")) return { branches: BRANCHES };
      if (path === "/projects") {
        if (method === "GET") return { projects: apiState.projects };
        if (apiState.conflictProjectId) {
          throw new ApiError("Project already exists for this repo", 409, {
            project_id: apiState.conflictProjectId,
          });
        }
        return { project: { id: "proj-1", branch: "main" } };
      }
      if (path.endsWith("/settings")) return {};
      if (path.endsWith("/analyze")) { analyzeCalls.push(path); return { analysis: { id: "job-1" } }; }
      if (path.startsWith("/projects/")) return { project: apiState.projectRow };
      return {};
    }),
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ connectGithub: vi.fn(), user: { id: "user-1" } }),
}));

vi.mock("@/lib/tourState", () => ({
  consumeTourRequest: () => false,
  dismissTour: vi.fn(),
  tourDismissed: () => true,
}));

// AnalyzeConfigForm fetches commits for the picker; stub it to a static form so
// this suite is about the gate, not the config editor.
vi.mock("@/components/AnalyzeConfigForm", () => ({
  DEFAULT_ANALYZE_CONFIG: { branch: "", commit: "", scopePath: "", depth: "standard", role: "" },
  analyzeRequestBody: (c: unknown) => c as Record<string, string>,
  AnalyzeConfigForm: ({ onChange, config }: { onChange: (c: unknown) => void; config: unknown }) => (
    <button type="button" onClick={() => onChange({ ...(config as object), depth: "cheap" })}>
      Change depth
    </button>
  ),
}));

const analyzeCalls: string[] = [];

/**
 * Radix's Select uses Pointer Events capture and `scrollIntoView`, neither of
 * which jsdom implements — without these the trigger never opens and every
 * assertion below fails on a missing `option`. Scoped to this file rather than
 * the shared setup so no other suite inherits a fake pointer API.
 */
beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

/** MemoryRouter keeps its URL to itself; this is how the tests read it. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="url">{`${location.pathname}${location.search}`}</span>;
}

function renderImportPage(entry = "/import") {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[entry]}>
        <ImportPage />
        <LocationProbe />
      </MemoryRouter>
    </TooltipProvider>,
  );
}

/**
 * A single installation auto-selects (the repo list follows without any
 * click) but stays a real, choosable picker. This helper waits for that
 * settled state.
 */
async function awaitAccountReady() {
  renderImportPage();
  await waitFor(() => expect(screen.getByLabelText("Filter repositories")).toBeInTheDocument());
  expect(screen.getByRole("combobox", { name: "GitHub account" })).toHaveTextContent("acme");
}

/** Walk step 1 (repo → Import; no branch step anymore) into step 2. */
async function reachConfigureStep(user: ReturnType<typeof userEvent.setup>) {
  await awaitAccountReady();

  await user.click(screen.getByRole("combobox", { name: "Repository" }));
  await user.click(await screen.findByRole("option", { name: "acme/service-000" }));
  // Role appears beside the repository once one is picked.
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Role" })).toBeInTheDocument());

  await user.click(screen.getByRole("button", { name: /import repository/i }));
  await waitFor(() => expect(screen.getByText(/Configure the first analysis/i)).toBeInTheDocument());
}

beforeEach(async () => {
  // Call history only (not the implementation): capture-style assertions must
  // never match a previous test's requests.
  const { apiFetch } = await import("@/lib/api");
  vi.mocked(apiFetch).mockClear();
  analyzeCalls.length = 0;
  apiState.projects = [];
  apiState.conflictProjectId = null;
  apiState.projectRow = null;
  apiState.installations = SINGLE_INSTALLATION;
  apiState.githubConnected = true;
  apiState.installationsFailure = null;
});

/**
 * Bug #67(2) — "large accounts cannot find their repository".
 *
 * Backend pagination (lib/github.ts) makes all 137 repos REACH the picker; a
 * 137-item dropdown then makes them unfindable a second way. The filter is the
 * client half of the same defect.
 */
describe("ImportPage — finding a repository in a large account (bug #67)", () => {
  it("filters a long repository list down to the typed query", async () => {
    const user = userEvent.setup();
    await awaitAccountReady();

    // Every paginated repo reached the picker — the old backend stopped at 100.
    expect(screen.getByText("137 repositories available")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Filter repositories"), "service-119");

    expect(screen.getByText('1 of 137 match "service-119"')).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Repository" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["acme/service-119"]);
  });

  it("says so instead of showing an empty dropdown when nothing matches", async () => {
    const user = userEvent.setup();
    await awaitAccountReady();

    await user.type(screen.getByLabelText("Filter repositories"), "no-such-repo");

    expect(screen.getByText(/0 of 137 match/)).toBeInTheDocument();
    expect(screen.getByText(/no match\. Check the App is installed on it\./)).toBeInTheDocument();
  });
});

/**
 * Bug #67(1) — "the cost/size safety gate is bypassable".
 *
 * `PreflightPreviewCard`'s acknowledgment checkbox is a CONTROLLED input. The
 * import wizard rendered it with neither `acknowledged` nor
 * `onAcknowledgedChange`, so `checked` was pinned to false and onChange was
 * undefined — a box that could never be ticked — while Start analysis was gated
 * only on `startingAnalysis`. The warning was therefore silently bypassable on
 * the exact first-run flow where oversized-repo costs matter most.
 */
describe("ImportPage — the oversized-repo cost gate (bug #67)", () => {
  it("blocks Start until the acknowledgment is ticked, and the box can actually be ticked", async () => {
    const user = userEvent.setup();
    await reachConfigureStep(user);

    // Before a preview there is nothing to acknowledge: Start is live.
    expect(screen.getByRole("button", { name: /start analysis/i })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /preview first/i }));
    await waitFor(() => expect(screen.getByText(/Requires acknowledgment before starting/i)).toBeInTheDocument());

    const start = screen.getByRole("button", { name: /start analysis/i });
    expect(start, "an unacknowledged oversized repo must not be startable").toBeDisabled();

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    // The frozen-control half of the bug: this used to stay false forever.
    expect(checkbox, "the acknowledgment must be tickable").toBeChecked();

    expect(screen.getByRole("button", { name: /start analysis/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /start analysis/i }));
    await waitFor(() => expect(analyzeCalls).toHaveLength(1));
  });

  it("drops the acknowledgment when the configuration it described changes", async () => {
    const user = userEvent.setup();
    await reachConfigureStep(user);

    await user.click(screen.getByRole("button", { name: /preview first/i }));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeInTheDocument());
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: /start analysis/i })).toBeEnabled();

    // A preview describes ONE configuration. Editing it must invalidate both
    // the preview and the tick — otherwise a cheap scope's acknowledgment
    // carries over to an expensive one, which is the same bypass by another
    // route.
    await user.click(screen.getByRole("button", { name: "Change depth" }));
    await waitFor(() => expect(screen.queryByRole("checkbox")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /preview first/i }));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeInTheDocument());
    expect(screen.getByRole("checkbox"), "a stale tick must not carry over").not.toBeChecked();
    expect(screen.getByRole("button", { name: /start analysis/i })).toBeDisabled();
  });

  it("leaves the always-visible scope notice as the only pre-preview guidance", async () => {
    const user = userEvent.setup();
    await reachConfigureStep(user);

    // M5 shipped this notice; the gate builds on it rather than duplicating it.
    const notice = screen.getByText("What gets analysed").closest("div")!;
    expect(within(notice).getByText(/TypeScript and JavaScript are parsed all the way down/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /preview first/i }));
    await waitFor(() => expect(screen.getByText(/analyzable files/)).toBeInTheDocument());
    // Once the real numbers exist the generic notice steps aside.
    expect(screen.queryByText("What gets analysed")).not.toBeInTheDocument();
  });
});

describe("ImportPage — already-imported repositories (#74/F4)", () => {
  it("badges and disables a repo the user already owns a project for", async () => {
    apiState.projects = [
      { id: "p-000", repo_owner: "acme", repo_name: "service-000", permission_tier: "owner" },
      // Someone else's project: the UNIQUE is per owner, so this stays importable.
      { id: "p-001", repo_owner: "acme", repo_name: "service-001", permission_tier: "viewer" },
    ];
    const user = userEvent.setup();
    await awaitAccountReady();

    await user.type(screen.getByLabelText("Filter repositories"), "service-00");
    await user.click(screen.getByRole("combobox", { name: "Repository" }));

    const imported = await screen.findByRole("option", { name: /service-000 \(already imported\)/ });
    expect(imported).toHaveAttribute("aria-disabled", "true");
    const invitedTo = screen.getByRole("option", { name: "acme/service-001" });
    expect(invitedTo, "a repo owned by someone else stays importable").not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("names the all-imported dead end and keeps the chooser openable", async () => {
    // Nothing left to import: every option is disabled. The picker used to be
    // the only thing on screen, and it looked broken rather than finished.
    apiState.projects = REPOS.map((r, i) => ({
      id: `p-${i}`,
      repo_owner: r.owner,
      repo_name: r.name,
      permission_tier: "owner",
    }));
    const user = userEvent.setup();
    await awaitAccountReady();

    await waitFor(() =>
      expect(
        screen.getByText(/Every repository shared with the app is already imported\./),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "Open your dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );

    // The list still opens with every row disabled. jsdom cannot reproduce the
    // real failure (item-aligned positioning needs layout, which jsdom has
    // none of), so this pins the markup only — the popper fix is a live check.
    await user.click(screen.getByRole("combobox", { name: "Repository" }));
    const options = await screen.findAllByRole("option");
    expect(options.length).toBe(REPOS.length);
    for (const option of options) {
      expect(option).toHaveAttribute("aria-disabled", "true");
      expect(option).toHaveTextContent("(already imported)");
    }
  });

  it("links to the existing project when create comes back 409", async () => {
    apiState.conflictProjectId = "already-there-9";
    const user = userEvent.setup();
    await awaitAccountReady();

    await user.click(screen.getByRole("combobox", { name: "Repository" }));
    await user.click(await screen.findByRole("option", { name: "acme/service-000" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Role" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /import repository/i }));

    expect(await screen.findByText(/Project already exists for this repo/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /already imported/i })).toHaveAttribute(
      "href",
      "/projects/already-there-9",
    );
  });
});

describe("ImportPage — streamlined step 1", () => {
  it("auto-selects a single installation but keeps it a choosable picker", async () => {
    await awaitAccountReady();
    // Still a combobox (the account list can grow), pre-filled with the only
    // option; the links row keeps the escape hatches.
    expect(screen.getByRole("combobox", { name: "GitHub account" })).toHaveTextContent("acme");
    expect(screen.getByRole("link", { name: /configure repositories/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("does not auto-select when several installations exist", async () => {
    apiState.installations = [
      { id: 42, account: { login: "acme" } },
      { id: 43, account: { login: "acme-labs" } },
    ];
    const user = userEvent.setup();
    renderImportPage();

    const picker = await screen.findByRole("combobox", { name: "GitHub account" });
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: "acme-labs" }));
    await waitFor(() => expect(screen.getByLabelText("Filter repositories")).toBeInTheDocument());
  });

  it("renders an expired connection as the connect state, not an error banner", async () => {
    apiState.installationsFailure = "reconnect";
    renderImportPage();

    expect(
      await screen.findByText(/Your GitHub connection expired\. Connecting again takes one click\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeInTheDocument();
    // The 403 must not surface as a red banner; the connect box IS the fix.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refetches repositories on Refresh and keeps a still-valid selection", async () => {
    const user = userEvent.setup();
    await awaitAccountReady();
    await user.click(screen.getByRole("combobox", { name: "Repository" }));
    await user.click(await screen.findByRole("option", { name: "acme/service-000" }));

    const { apiFetch } = await import("@/lib/api");
    const repoCallsBefore = vi
      .mocked(apiFetch)
      .mock.calls.filter(([path]) => String(path).startsWith("/github/repos?")).length;

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      const repoCallsAfter = vi
        .mocked(apiFetch)
        .mock.calls.filter(([path]) => String(path).startsWith("/github/repos?")).length;
      // The old page refetched installations only; the repo list (the thing
      // "Configure repositories" changes) never reloaded without a page reload.
      expect(repoCallsAfter).toBeGreaterThan(repoCallsBefore);
    });
    expect(screen.getByRole("combobox", { name: "Repository" })).toHaveTextContent(
      "acme/service-000",
    );
  });

  it("omits branch from the create request; the server resolves the repo default", async () => {
    const user = userEvent.setup();
    await reachConfigureStep(user);

    const { apiFetch } = await import("@/lib/api");
    const createCall = vi
      .mocked(apiFetch)
      .mock.calls.find(
        ([path, options]) => path === "/projects" && (options as RequestInit | undefined)?.method === "POST",
      );
    expect(createCall).toBeDefined();
    const body = JSON.parse((createCall![1] as { body: string }).body) as Record<string, unknown>;
    expect(body).not.toHaveProperty("branch");
    expect(body.default_developer_role).toBe("general");
  });

  it("persists exactly the ignored list it showed, including edits to the defaults", async () => {
    const user = userEvent.setup();
    await awaitAccountReady();
    await user.click(screen.getByRole("combobox", { name: "Repository" }));
    await user.click(await screen.findByRole("option", { name: "acme/service-000" }));

    // The four column defaults render as removable chips from the start.
    await user.click(screen.getByRole("button", { name: "Remove dist" }));
    await user.type(screen.getByPlaceholderText("e.g. fixtures/"), "fixtures/");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await user.click(screen.getByRole("button", { name: /import repository/i }));
    await waitFor(() => expect(screen.getByText(/Configure the first analysis/i)).toBeInTheDocument());

    const { apiFetch } = await import("@/lib/api");
    const settingsCall = vi
      .mocked(apiFetch)
      .mock.calls.find(([path]) => String(path).endsWith("/settings"));
    expect(settingsCall).toBeDefined();
    const body = JSON.parse((settingsCall![1] as { body: string }).body) as { ignored_paths: string[] };
    // The old only-when-nonempty rule silently dropped the defaults the
    // moment one custom path was added.
    expect(body.ignored_paths).toEqual(["node_modules", ".git", ".env", "fixtures/"]);
  });

  it("splits the empty state by whether GitHub is connected at all", async () => {
    apiState.installations = [];
    apiState.githubConnected = false;
    const { unmount } = renderImportPage();
    expect(await screen.findByText(/GitHub isn't connected yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeInTheDocument();
    unmount();

    apiState.githubConnected = true;
    renderImportPage();
    expect(await screen.findByText(/No repositories are shared with the app yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install OnboardBuddy" })).toBeInTheDocument();
  });

  it("shows ignored paths without a toggle: defaults as chips below the input", async () => {
    const user = userEvent.setup();
    await awaitAccountReady();
    await user.click(screen.getByRole("combobox", { name: "Repository" }));
    await user.click(await screen.findByRole("option", { name: "acme/service-000" }));

    // No "+ Show" toggle: the block is always visible once a repo is picked,
    // prefilled with the real column defaults.
    const input = screen.getByPlaceholderText("e.g. fixtures/");
    const removeDefault = screen.getByRole("button", { name: "Remove node_modules" });
    // Input row first, chips below.
    expect(
      input.compareDocumentPosition(removeDefault) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.type(input, "docs/");
    await user.click(screen.getByRole("button", { name: "Add" }));
    const removeAdded = screen.getByRole("button", { name: "Remove docs/" });
    await user.click(removeAdded);
    expect(screen.queryByRole("button", { name: "Remove docs/" })).not.toBeInTheDocument();
    // The always-on engine exclusions are stated, not hidden.
    expect(screen.getByText(/always excluded, even if removed here/)).toBeInTheDocument();
  });
});

describe("ImportPage — step 2 survives a reload (#74/F5)", () => {
  it("restores the configure step from ?project= without re-running step 1", async () => {
    apiState.projectRow = {
      id: "proj-7",
      repo_owner: "acme",
      repo_name: "service-042",
      branch: "release/2026-07",
      github_installation_id: 42,
    };
    renderImportPage("/import?project=proj-7");

    expect(
      await screen.findByText(/acme\/service-042 is imported; nothing runs until you press Start/),
    ).toBeInTheDocument();
    // The picker is gone: this is step 2, not step 1 with a banner.
    expect(screen.queryByRole("combobox", { name: "Repository" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start analysis/i })).toBeInTheDocument();
  });

  it("writes the created project id into the URL when step 2 begins", async () => {
    const user = userEvent.setup();
    await reachConfigureStep(user);
    // The id in the URL is what makes step 2 reachable again after a reload.
    expect(screen.getByTestId("url")).toHaveTextContent("/import?project=proj-1");
  });
});
