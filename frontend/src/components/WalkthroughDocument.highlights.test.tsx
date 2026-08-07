import { render, screen } from "@testing-library/react";
import { WalkthroughDocument, type WalkthroughStepData } from "./WalkthroughDocument";

/**
 * Every chip under a walkthrough snippet claims a line range. Two ways that
 * claim used to be empty, both live on the flagship repo:
 *
 *  - the stored window is built around the FIRST highlight, so a step whose
 *    other highlights sat below it rendered them as chips over lines the block
 *    did not show;
 *  - the stored snippet is capped, so highlights past its end (423, 508, 609
 *    against a snippet ending at 421) were chips pointing at nothing at all.
 *
 * Neither is visible without the right data shape, which is why it is pinned
 * here rather than left to the eye.
 */

const STEP: WalkthroughStepData = {
  id: "s1",
  step_order: 1,
  file_path: "backend/src/worker/summaryWorker.ts",
  symbol_name: "runSummary",
  line_start: 399,
  line_end: 421,
  snippet: Array.from({ length: 23 }, (_, i) => `line ${399 + i}`).join("\n"),
  explanation: "It runs.",
  window: { start: 399, end: 410 },
  highlights: [
    { start: 412, end: 412, source: "control_flow", label: "enqueues the next phase" },
    { start: 508, end: 508, source: "control_flow", label: "flushes progress" },
  ],
  receipts: [],
};

const REPO = { owner: "ldnkoff", repo: "team15", branch: "Milestone5" };

const shownLines = () =>
  [...document.querySelectorAll("[data-line]")].map((n) => Number(n.getAttribute("data-line")));

beforeAll(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe("walkthrough highlight chips", () => {
  it("stretches the window past the stored end so an in-snippet highlight is on screen", () => {
    render(<WalkthroughDocument steps={[STEP]} repo={REPO} />);

    expect(shownLines()).toContain(412);
    // …without giving up the window: the out-of-snippet highlight at 508 must
    // not drag the block open to the full capture.
    expect(shownLines()).not.toContain(421);
  });

  it("sends a highlight past the end of the captured snippet to GitHub instead of nowhere", () => {
    render(<WalkthroughDocument steps={[STEP]} repo={REPO} />);

    const link = screen.getByText("flushes progress").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/ldnkoff/team15/blob/Milestone5/backend/src/worker/summaryWorker.ts#L508-L508",
    );
    // The one that IS in the snippet stays a plain chip over its lit lines.
    expect(screen.getByText("enqueues the next phase").closest("a")).toBeNull();
  });
});
