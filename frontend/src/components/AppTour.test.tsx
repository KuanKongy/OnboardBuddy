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

it("renders a blank line in the body as a paragraph break", () => {
  // The anchor has to be in the DOM before the tour mounts: AppTour filters its
  // steps once, in a useState initializer, and a step whose target does not
  // exist yet is dropped for the whole run.
  const { rerender } = render(<button data-tour="anchor">anchor</button>);
  rerender(
    <>
      <button data-tour="anchor">anchor</button>
      <AppTour
        steps={[{ target: "anchor", title: "Here", body: "First point.\n\nSecond point." }]}
        onDone={() => {}}
      />
    </>,
  );

  // As one text node the accessible text would be "First point. Second point.",
  // and neither of these exact-text queries would match. The lifecycle tour's
  // steps are several sentences long and were unreadable as a single block.
  expect(screen.getByText("First point.")).toBeInTheDocument();
  expect(screen.getByText("Second point.")).toBeInTheDocument();
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
