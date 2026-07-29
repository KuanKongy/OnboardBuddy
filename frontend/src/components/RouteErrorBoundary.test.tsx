import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

/**
 * Bug #24. The claim being pinned is the one that distinguishes this from the
 * 404 route: a page that *matched* and then threw must not take the shell down
 * with it. The 404 route cannot help here — it only handles URLs no route
 * matched — and the app-level boundary in App.tsx replaces the entire tree.
 */

function Boom(): never {
  throw new Error("payload had no nodes");
}

/** Stands in for the sidebar / tab strip that must survive a broken page. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav>
        Project navigation
        <Link to="/fine">Go to a working tab</Link>
      </nav>
      {children}
    </div>
  );
}

function renderWithBoundary(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Shell>
        <RouteErrorBoundary scope="test">
          <Routes>
            <Route path="/broken" element={<Boom />} />
            <Route path="/fine" element={<p>A working tab</p>} />
          </Routes>
        </RouteErrorBoundary>
      </Shell>
    </MemoryRouter>,
  );
}

describe("RouteErrorBoundary (#24)", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React logs the caught error itself; the boundary logs the component
    // stack on purpose. Neither is the assertion.
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  it("keeps the surrounding shell mounted when a routed page throws", () => {
    renderWithBoundary("/broken");

    expect(screen.getByRole("alert")).toHaveTextContent(/this page failed to render/i);
    expect(screen.getByText("payload had no nodes")).toBeInTheDocument();
    // The whole point of scoping it: navigation is still there to escape with.
    expect(screen.getByText("Project navigation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try this page again/i })).toBeInTheDocument();
  });

  it("clears the error when the route changes, instead of poisoning every later page", async () => {
    renderWithBoundary("/broken");
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Navigating out via the surviving shell — the recovery this fix exists
    // to make possible. React never resets a boundary on its own, so without
    // the pathname resetKey the working tab renders the previous page's error.
    await userEvent.click(screen.getByRole("link", { name: /go to a working tab/i }));

    expect(await screen.findByText("A working tab")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("retries the same page on demand", async () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("transient render failure");
      return <p>Recovered content</p>;
    }
    render(
      <MemoryRouter initialEntries={["/flaky"]}>
        <RouteErrorBoundary scope="test">
          <Routes>
            <Route path="/flaky" element={<Flaky />} />
          </Routes>
        </RouteErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    shouldThrow = false;
    await userEvent.click(screen.getByRole("button", { name: /try this page again/i }));

    expect(screen.getByText("Recovered content")).toBeInTheDocument();
  });
});
