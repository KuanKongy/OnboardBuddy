import { render, screen } from "@testing-library/react";
import { CodeSnippet } from "./CodeSnippet";

describe("CodeSnippet", () => {
  it("numbers lines from startLine", () => {
    render(<CodeSnippet code={"const a = 1;\nconst b = 2;\nreturn a + b;"} startLine={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("43")).toBeInTheDocument();
    expect(screen.getByText("44")).toBeInTheDocument();
    expect(screen.queryByText("45")).not.toBeInTheDocument();
    expect(screen.getByText("const b = 2;")).toBeInTheDocument();
  });

  it("defaults to line 1 and ignores a trailing newline", () => {
    const { container } = render(<CodeSnippet code={"one\ntwo\n"} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-line]")).toHaveLength(2);
  });

  it("marks rows inside highlightRanges (absolute lines)", () => {
    const { container } = render(
      <CodeSnippet
        code={"a\nb\nc\nd"}
        startLine={10}
        highlightRanges={[{ start: 11, end: 12 }]}
      />,
    );
    const rows = [...container.querySelectorAll("[data-line]")];
    const highlighted = rows.filter((r) => r.className.includes("bg-primary"));
    expect(highlighted.map((r) => r.getAttribute("data-line"))).toEqual(["11", "12"]);
  });

  it("keeps a hover affordance on every row", () => {
    const { container } = render(<CodeSnippet code="only line" />);
    const row = container.querySelector("[data-line='1']");
    expect(row?.className).toContain("hover:bg-accent");
  });
});
