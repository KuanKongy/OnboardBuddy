import { render, screen } from "@testing-library/react";
import { PageSpinner } from "./page-spinner";

describe("PageSpinner", () => {
  it("exposes the wait as a status with an sr-only label", () => {
    render(<PageSpinner label="Loading team members" className="py-12" />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading team members");
    // Announced, not drawn: the label carries `sr-only` and the glyph is hidden.
    expect(status.querySelector(".sr-only")?.textContent).toBe("Loading team members");
    expect(status.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
