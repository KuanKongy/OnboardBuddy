import { fireEvent, render, screen } from "@testing-library/react";
import { GraphFirstVisitHint } from "./GraphFirstVisitHint";

/**
 * Bug #74 (F21): the Classes view showed the Files copy, promising a GitHub
 * link its panel does not have.
 */
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

    // The classes hint is different copy nobody has dismissed yet.
    render(<GraphFirstVisitHint variant="classes" />);
    expect(screen.getByText("What am I looking at?")).toBeInTheDocument();
    // And the files key is the pre-existing one, so it stays dismissed.
    expect(localStorage.getItem("onboardbuddy:graph-hint-dismissed")).toBe("1");
  });
});
