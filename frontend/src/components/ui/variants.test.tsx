import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";
import { Button } from "./button";

describe("Badge success variant (#74/V12)", () => {
  it("uses the app's chip family — tinted fill, /40 border, semantic text", () => {
    render(<Badge variant="success">complete</Badge>);
    const badge = screen.getByText("complete");
    expect(badge).toHaveAttribute("data-variant", "success");
    expect(badge.className).toContain("bg-success-soft");
    expect(badge.className).toContain("border-success/40");
    expect(badge.className).toContain("text-success");
  });
});

describe("Button disabled treatment (#74/V9)", () => {
  // tailwind-merge, not CSS source order, decides whether `disabled:opacity-100`
  // survives. If that flips, the label drops to 2.12:1 and nothing else changes.
  it("keeps the disabled primary readable: muted fill, no extra fade", () => {
    render(<Button disabled>Save</Button>);
    const cls = screen.getByRole("button", { name: "Save" }).className;
    expect(cls).toContain("disabled:bg-muted");
    expect(cls).toContain("disabled:text-muted-foreground");
    expect(cls).toContain("disabled:opacity-100");
    expect(cls).not.toContain("disabled:opacity-40");
  });

  it("shows a not-allowed cursor, which pointer-events-none made unreachable", () => {
    render(<Button disabled>Save</Button>);
    const cls = screen.getByRole("button", { name: "Save" }).className;
    expect(cls).toContain("disabled:cursor-not-allowed");
    expect(cls).not.toContain("disabled:pointer-events-none");
  });
});
