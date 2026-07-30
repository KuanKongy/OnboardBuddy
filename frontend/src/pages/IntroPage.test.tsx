import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

// The showcase card was MOVED into the hero, not copied. Two copies a page scroll
// apart would read fine in isolation, which is why the count is asserted.

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: false, signOut: vi.fn() }),
}));

const { IntroPage } = await import("./IntroPage");

describe("IntroPage hero (#74/V18)", () => {
  it("renders the showcase card exactly once, in the hero", () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <IntroPage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    expect(screen.getAllByText(/Package section · Backend architecture/)).toHaveLength(1);
    // Nothing was deleted to make room: "See what you get" keeps a card of its own.
    expect(screen.getByText("See what you get")).toBeInTheDocument();
    expect(screen.getAllByText(/Tutorial · 3 of 6 in the package/)).toHaveLength(1);

    // Above the features anchor, so it really was hoisted rather than just deduped.
    const showcase = screen.getByText(/Package section · Backend architecture/);
    const features = document.getElementById("features");
    expect(features).not.toBeNull();
    expect(showcase.compareDocumentPosition(features!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
