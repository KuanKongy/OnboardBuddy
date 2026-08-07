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

  it("extends the same family to warning", () => {
    render(<Badge variant="warning">revoked</Badge>);
    const badge = screen.getByText("revoked");
    expect(badge).toHaveAttribute("data-variant", "warning");
    expect(badge.className).toContain("bg-warning-soft");
    expect(badge.className).toContain("border-warning/40");
    expect(badge.className).toContain("text-warning");
  });

  it("extends the same family to danger", () => {
    render(<Badge variant="danger">declined</Badge>);
    const badge = screen.getByText("declined");
    expect(badge).toHaveAttribute("data-variant", "danger");
    expect(badge.className).toContain("bg-danger-soft");
    expect(badge.className).toContain("border-danger/40");
    expect(badge.className).toContain("text-danger");
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
