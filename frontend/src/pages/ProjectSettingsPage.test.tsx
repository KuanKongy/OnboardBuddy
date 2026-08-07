import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
import { ProjectSettingsPage } from "./ProjectSettingsPage";

// The dialog overlay covers the page-level banner, so a delete error reported there
// is invisible — and the screenshot still looks fine, which is why this is pinned.

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("@/contexts/ProjectContext", () => ({
  useProject: () => ({
    project: {
      id: "p1",
      repo_owner: "acme",
      repo_name: "rocket",
      permission_tier: "owner",
      developer_role: "backend",
      status: "complete",
      settings: null,
    },
    loading: false,
    error: "",
    refetch: vi.fn(),
  }),
}));

vi.mock("@/contexts/PackagesContext", () => ({
  usePackages: () => ({ registerSessionJob: vi.fn() }),
}));

const mockApi = vi.mocked(apiFetch);

// App mounts one TooltipProvider around the whole tree; the weight-signal
// tooltips throw without it when this page is rendered bare.
function renderPage() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/projects/p1/settings"]}>
        <Routes>
          <Route path="/projects/:id/settings" element={<ProjectSettingsPage />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

const callsWithMethod = (method: string) =>
  mockApi.mock.calls.filter(([, init]) => init?.method === method);

describe("ProjectSettingsPage delete failure (#74/H1)", () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockImplementation((path: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? Promise.reject(new Error("Project has running analyses"))
        : Promise.resolve({ key: { exists: false }, usage_by_key_source: [], roles: [] }),
    );
  });

  it("shows the failure inside the still-open confirm dialog", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /^Delete$/ }));
    await user.type(await screen.findByLabelText("Type rocket to confirm"), "rocket");
    await user.click(screen.getByRole("button", { name: /Delete permanently/ }));

    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent("Project has running analyses"),
    );
    // Still open, and the action is retryable rather than lost.
    expect(within(dialog).getByRole("button", { name: /Delete permanently/ })).toBeEnabled();
  });
});

/**
 * The save bar used to render only once the form was dirty, so someone reading
 * the page had no way to tell that edits here are staged rather than applied on
 * change — and the buttons appearing under the cursor mid-edit moved the page.
 * It is mounted for anyone who can edit and disabled until there is something
 * to save. The project mock carries `settings: null`, which is exactly the
 * baseline the form seeds itself from, so a freshly loaded page is clean.
 */
describe("ProjectSettingsPage save bar", () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockResolvedValue({ key: { exists: false }, usage_by_key_source: [], roles: [] });
    localStorage.clear();
  });

  it("shows Save and Cancel disabled until an edit, beside the Viewing section", async () => {
    const user = userEvent.setup();
    renderPage();

    const save = await screen.findByRole("button", { name: /Save changes/ });
    const cancel = screen.getByRole("button", { name: /^Cancel$/ });
    expect(save).toBeDisabled();
    expect(cancel).toBeDisabled();

    // The personal, per-project click model lives here now rather than in
    // account settings.
    expect(screen.getByRole("heading", { name: "Viewing" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/node_modules/), "dist/");

    expect(save).toBeEnabled();
    expect(cancel).toBeEnabled();
  });
});

/**
 * A configured key used to render as a strip with one unguarded Remove and no
 * way to replace it: swapping a key meant removing it first, running the
 * project on the server key in between, and hoping nobody analysed meanwhile.
 */
describe("ProjectSettingsPage configured LLM key", () => {
  const configured = {
    key: {
      exists: true,
      provider: "openrouter",
      created_by: "a@b.c",
      created_at: "2026-08-01T00:00:00Z",
    },
    usage_by_key_source: [],
    roles: [],
  };

  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockResolvedValue(configured);
  });

  it("names who configured it and keeps the input hidden until Replace", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/Key configured by a@b\.c on /)).toBeInTheDocument();
    expect(screen.queryByLabelText("Project LLM API key")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Replace key" }));
    await user.type(screen.getByLabelText("Project LLM API key"), "sk-or-replacement");
    await user.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() =>
      expect(
        callsWithMethod("PUT").filter(([path]) => path === "/projects/p1/llm-key"),
      ).toHaveLength(1),
    );
  });

  it("removes only after the inline confirm", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Remove" }));
    // The first click must be a question, not the deletion.
    expect(callsWithMethod("DELETE")).toHaveLength(0);
    expect(screen.getByText(/Remove the key\?/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm remove" }));
    await waitFor(() =>
      expect(callsWithMethod("DELETE").map(([path]) => path)).toEqual(["/projects/p1/llm-key"]),
    );
  });
});

/**
 * Revert was gated on `customized` — a server persistence flag — so sliders
 * moved on a role that had never been saved could not be put back, and Save
 * happily wrote an override row identical to the defaults.
 */
describe("ProjectSettingsPage ranking weights gating", () => {
  const defaults = {
    critical_for_runtime: 0.25,
    critical_for_business: 0.15,
    critical_for_onboarding: 0.15,
    critical_for_role: 0.15,
    critical_for_change_risk: 0.1,
    critical_for_architecture: 0.1,
    critical_for_workflow: 0.1,
  };

  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockResolvedValue({
      key: { exists: false },
      usage_by_key_source: [],
      roles: [{ role: "backend", weights: { ...defaults }, defaults: { ...defaults }, customized: false }],
    });
  });

  it("enables Revert on any edit and resets locally when nothing is persisted", async () => {
    const user = userEvent.setup();
    renderPage();

    const revert = await screen.findByRole("button", { name: /Revert to built-in weights/ });
    const save = screen.getByRole("button", { name: /Save weights/ });
    expect(revert).toBeDisabled();
    expect(save).toBeDisabled();

    const runtime = screen.getByLabelText("Runtime weight") as HTMLInputElement;
    fireEvent.change(runtime, { target: { value: "0.5" } });
    expect(runtime.value).toBe("0.5");
    expect(revert).toBeEnabled();
    expect(save).toBeEnabled();

    await user.click(revert);
    await waitFor(() => expect(runtime.value).toBe("0.25"));
    expect(revert).toBeDisabled();
    expect(save).toBeDisabled();
    // No override row exists, so there is nothing to DELETE.
    expect(callsWithMethod("DELETE")).toHaveLength(0);
  });
});
