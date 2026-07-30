import { render, screen } from "@testing-library/react";
import { ErrorBanner } from "./error-banner";

// This component exists because the hand-rolled copies kept dropping the role, so
// the role is what gets asserted.
describe("ErrorBanner", () => {
  it("announces its message as an alert and keeps the caller's classes", () => {
    render(<ErrorBanner className="mb-3">Could not save the key.</ErrorBanner>);

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Could not save the key.");
    expect(banner.className).toContain("mb-3");
    expect(banner.className).toContain("border-destructive/50");
  });
});
