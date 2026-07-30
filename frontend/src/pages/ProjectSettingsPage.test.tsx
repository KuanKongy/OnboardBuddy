import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
    render(
      <MemoryRouter initialEntries={["/projects/p1/settings"]}>
        <Routes>
          <Route path="/projects/:id/settings" element={<ProjectSettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );

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
