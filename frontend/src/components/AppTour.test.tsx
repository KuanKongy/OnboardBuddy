import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppTour } from "./AppTour";

/**
 * jsdom has no layout, so AppTour's own visibility filter (a non-zero rect and a
 * non-null offsetParent) would drop every step and close the tour before it
 * rendered. Both are stubbed for this file only.
 */
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    return { top: 10, left: 10, width: 100, height: 20, right: 110, bottom: 30, x: 10, y: 10, toJSON: () => ({}) } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return document.body; },
  });
  Element.prototype.scrollIntoView = () => {};
});

it("hands focus back to whatever opened it", async () => {
  const user = userEvent.setup();
  const onDone = vi.fn();

  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button data-tour="anchor" onClick={() => setOpen(true)}>Take a tour</button>
        {open && (
          <AppTour
            steps={[{ target: "anchor", title: "Here", body: "This is the thing." }]}
            onDone={() => { setOpen(false); onDone(); }}
          />
        )}
      </>
    );
  }

  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Take a tour" });
  await user.click(opener);

  // The tour takes focus for its own keyboard handling…
  expect(screen.getByRole("dialog")).toHaveFocus();

  await user.click(screen.getByRole("button", { name: "Skip tour" }));

  // …and gives it back, rather than dropping it on <body>.
  expect(onDone).toHaveBeenCalled();
  expect(opener).toHaveFocus();
});
