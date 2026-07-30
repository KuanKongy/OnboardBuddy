import { fireEvent, render, screen } from "@testing-library/react";
import { GraphFirstVisitHint } from "./GraphFirstVisitHint";

describe("GraphFirstVisitHint", () => {
  beforeEach(() => localStorage.clear());

  it("describes classes without promising a GitHub link", () => {
    render(<GraphFirstVisitHint variant="classes" />);

    expect(screen.getByText(/classes and interfaces/i)).toBeInTheDocument();
    expect(screen.queryByText(/GitHub/)).not.toBeInTheDocument();
    expect(screen.queryByText(/entry point/i)).not.toBeInTheDocument();
  });

  it("dismisses each variant separately", () => {
    const { unmount } = render(<GraphFirstVisitHint variant="files" />);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText("What am I looking at?")).not.toBeInTheDocument();
    unmount();

    // Different copy nobody has dismissed yet, under its own key.
    render(<GraphFirstVisitHint variant="classes" />);
    expect(screen.getByText("What am I looking at?")).toBeInTheDocument();
    expect(localStorage.getItem("onboardbuddy:graph-hint-dismissed")).toBe("1");
  });
});
