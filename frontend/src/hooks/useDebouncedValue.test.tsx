import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useDebouncedValue } from "./useDebouncedValue";

function Probe({ emptyValue }: { emptyValue?: string }) {
  const [raw, setRaw] = useState("");
  const settled = useDebouncedValue(raw, 200, emptyValue);
  return (
    <>
      {["gr", "graph", ""].map((v) => (
        <button key={v || "clear"} onClick={() => setRaw(v)}>
          {v || "clear"}
        </button>
      ))}
      <span data-testid="settled">{settled}</span>
    </>
  );
}

const settled = () => screen.getByTestId("settled").textContent;
const type = (label: string) => fireEvent.click(screen.getByRole("button", { name: label }));
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("only settles after the delay, and a burst settles once on the last value", () => {
    render(<Probe />);

    type("gr");
    tick(150);
    expect(settled()).toBe("");

    // Still typing — the pending timer is discarded, not fired.
    type("graph");
    tick(150);
    expect(settled()).toBe("");

    tick(50);
    expect(settled()).toBe("graph");
  });

  it("snaps to the empty value without waiting", () => {
    render(<Probe emptyValue="" />);

    type("graph");
    tick(200);
    expect(settled()).toBe("graph");

    // Clearing is not typing: no stale filter for 200ms.
    type("clear");
    expect(settled()).toBe("");
  });
});
