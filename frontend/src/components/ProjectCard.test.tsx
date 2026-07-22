import { render, screen } from "@testing-library/react";
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

  it("opens the project when the card body is clicked", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByText("rocket"));

    expect(screen.getByText("PROJECT PAGE")).toBeInTheDocument();
  });

  it("always renders the actions menu for managers and deletes without navigating", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    renderCard(PROJECT, onDeleted);

    // No hover needed — the trigger is permanently rendered.
    await user.click(screen.getByRole("button", { name: "Project actions" }));
    await user.click(await screen.findByText("Delete project"));

    // Confirm dialog gates the actual delete call.
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(`/projects/${PROJECT.id}`, { method: "DELETE" });
    expect(onDeleted).toHaveBeenCalledWith(PROJECT.id);
    // stopPropagation kept us on the dashboard.
    expect(screen.queryByText("PROJECT PAGE")).not.toBeInTheDocument();
  });

  it("hides the actions menu for plain developers", () => {
    renderCard({ ...PROJECT, permission_tier: "developer" });

    expect(screen.queryByRole("button", { name: "Project actions" })).not.toBeInTheDocument();
  });
});
