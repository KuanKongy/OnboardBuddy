import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProjectCard, type Project } from "./ProjectCard";
import { apiFetch } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}));

const PROJECT: Project = {
  id: "12345678-1234-1234-1234-123456789012",
  repo_owner: "acme",
  repo_name: "rocket",
  branch: "main",
  status: "complete",
  permission_tier: "owner",
  developer_role: "backend",
  stale_count: 0,
  created_at: "2026-07-01T00:00:00.000Z",
  last_analyzed_at: "2026-07-10T00:00:00.000Z",
  repo_description: "A reusable launch vehicle control plane.",
  primary_language: "TypeScript",
  repo_pushed_at: "2026-07-14T00:00:00.000Z",
};

function renderCard(project: Project = PROJECT, onDeleted?: (id: string) => void) {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/dashboard" element={<ProjectCard project={project} onDeleted={onDeleted} />} />
          <Route path="/projects/:id" element={<div>PROJECT PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe("ProjectCard", () => {
  afterEach(() => vi.clearAllMocks());

  it("shows description, primary language and updated time (no branch)", () => {
    renderCard();

    expect(screen.getByText("A reusable launch vehicle control plane.")).toBeInTheDocument();
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
    expect(screen.getByText(/^Updated /)).toBeInTheDocument();
    expect(screen.queryByText("main")).not.toBeInTheDocument();
  });

  // The repo name is the card's one real link: without a real href, middle-click
  // and the browser's context menu have nothing to open in a new tab.
  it("makes the repo name a real link to the project", () => {
    renderCard();

    expect(screen.getByRole("link", { name: "Open acme/rocket" })).toHaveAttribute(
      "href",
      `/projects/${PROJECT.id}`,
    );
  });

  it("opens the project when the card body is clicked", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByText("rocket"));

    expect(screen.getByText("PROJECT PAGE")).toBeInTheDocument();
  });

  // Dropping the type-to-confirm gate leaves a dialog that still looks like a
  // confirmation, so the guard is what gets asserted.
  it("owner: deletes only after the repo name is typed, and without navigating", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    renderCard(PROJECT, onDeleted);

    // No hover needed — the trigger is permanently rendered.
    await user.click(screen.getByRole("button", { name: "Project actions" }));
    await user.click(await screen.findByText("Delete project"));

    const confirm = await screen.findByRole("button", { name: /Delete permanently/ });
    expect(confirm).toBeDisabled();
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Type rocket to confirm"), "rocket");
    await user.click(confirm);

    expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(`/projects/${PROJECT.id}`, { method: "DELETE" });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(PROJECT.id));
    // stopPropagation kept us on the dashboard.
    expect(screen.queryByText("PROJECT PAGE")).not.toBeInTheDocument();
  });

  // `DELETE /api/projects/:id` is owner-only, so an admin's menu item could only ever
  // 403. Delete is the menu's one item, so the trigger goes with it.
  it.each(["admin", "developer"])("offers no delete to an %s", (tier) => {
    renderCard({ ...PROJECT, permission_tier: tier });

    expect(screen.queryByRole("button", { name: "Project actions" })).not.toBeInTheDocument();
  });
});
