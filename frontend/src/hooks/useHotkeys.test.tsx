import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { hotkeysEnabled, setHotkeysEnabled, useHotkeys } from "./useHotkeys";

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

  /**
   * #74/G12. The preference is read at keypress time, not captured when the hook
   * mounted — which is the whole reason the toggle needs no reload. A refactor to
   * a mounted `useState` would still pass every test above and silently make the
   * setting apply only to components mounted after it was changed.
   */
  describe("the hotkeys preference", () => {
    afterEach(() => localStorage.removeItem("onboardbuddy:hotkeys"));

    it("fires by default, with nothing stored", () => {
      render(<Harness />);
      fireEvent.keyDown(document.body, { key: "]" });
      expect(screen.getByTestId("count")).toHaveTextContent("1");
    });

    it('is suppressed once the preference is "off", on an already-mounted hook', () => {
      render(<Harness />);
      fireEvent.keyDown(document.body, { key: "]" });
      expect(screen.getByTestId("count")).toHaveTextContent("1");

      setHotkeysEnabled(false);
      fireEvent.keyDown(document.body, { key: "]" });
      expect(screen.getByTestId("count")).toHaveTextContent("1");

      setHotkeysEnabled(true);
      fireEvent.keyDown(document.body, { key: "]" });
      expect(screen.getByTestId("count")).toHaveTextContent("2");
    });

    it("keeps shortcuts on for any value that is not exactly \"off\"", () => {
      localStorage.setItem("onboardbuddy:hotkeys", "");
      expect(hotkeysEnabled()).toBe(true);
      localStorage.setItem("onboardbuddy:hotkeys", "OFF");
      expect(hotkeysEnabled()).toBe(true);
      localStorage.setItem("onboardbuddy:hotkeys", "off");
      expect(hotkeysEnabled()).toBe(false);
    });
  });
});
