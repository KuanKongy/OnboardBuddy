import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useHotkeys } from "./useHotkeys";

function Harness({ enabled = true }: { enabled?: boolean }) {
  const [count, setCount] = useState(0);
  useHotkeys({ "]": () => setCount((c) => c + 1) }, enabled);
  return (
    <div>
      <span data-testid="count">{count}</span>
      <input aria-label="Search" />
    </div>
  );
}

describe("useHotkeys", () => {
  it("fires on a plain matching key", () => {
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: "]" });
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });

  it("ignores keys while typing in an input", () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "]" });
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("ignores modified keys and non-matching keys", () => {
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: "]", metaKey: true });
    fireEvent.keyDown(document.body, { key: "]", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "[" });
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("pauses while any dialog/tour overlay is open", () => {
    render(
      <>
        <Harness />
        <div role="dialog">modal</div>
      </>,
    );
    fireEvent.keyDown(document.body, { key: "]" });
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("does nothing when disabled", () => {
    render(<Harness enabled={false} />);
    fireEvent.keyDown(document.body, { key: "]" });
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });
});
