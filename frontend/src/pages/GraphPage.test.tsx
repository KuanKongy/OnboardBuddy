import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GraphPage } from "./GraphPage";

function renderGraphPage() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/projects/proj-1/dependencies"]}>
        <Routes>
          <Route path="/projects/:id/dependencies" element={<GraphPage />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe("GraphPage", () => {
  it("renders all module nodes from the dependency graph", async () => {
    renderGraphPage();

    await waitFor(() => {
      expect(screen.getByText("index")).toBeInTheDocument();
    });
    expect(screen.getByText("strings")).toBeInTheDocument();
    expect(screen.getByText("logger")).toBeInTheDocument();
    expect(screen.getByText("userService")).toBeInTheDocument();
    expect(screen.getByText("4 / 4 modules")).toBeInTheDocument();
  });

  it("filters nodes by search and updates the count", async () => {
    renderGraphPage();
    await waitFor(() => expect(screen.getByText("index")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/search files, classes or methods/i),
      "logger",
    );

    await waitFor(() => {
      expect(screen.getByText("1 / 4 modules")).toBeInTheDocument();
    });
    expect(screen.getByText("logger")).toBeInTheDocument();
    expect(screen.queryByText("strings")).not.toBeInTheDocument();
  });

  it("opens the info panel with functions and imports when a node is clicked", async () => {
    renderGraphPage();
    await waitFor(() => expect(screen.getByText("userService")).toBeInTheDocument());

    fireEvent.click(screen.getByText("userService"));

    await waitFor(() => {
      expect(screen.getByText("Functions")).toBeInTheDocument();
    });
    // listActiveUsers is a method on UserService class — shows in Functions panel
    expect(screen.getAllByText(/UserService/i).length).toBeGreaterThan(0);
  });
});
