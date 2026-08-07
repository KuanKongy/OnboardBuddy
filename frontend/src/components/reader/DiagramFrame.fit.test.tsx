import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DiagramFrame } from "./DiagramFrame";

/**
 * The opening view of the Enlarge stage, driven with real numbers.
 *
 * jsdom performs no layout, so every box here is stubbed on purpose: the thing
 * under test is the arithmetic that turns a measured diagram size into the
 * scale the modal opens at, and that arithmetic is invisible on screen — a
 * wrong `min` silently opens a 37-table ER cropped instead of fitted, which
 * looks like a rendering bug rather than a maths bug.
 */

let resizeCallbacks: ResizeObserverCallback[] = [];

beforeEach(() => {
  resizeCallbacks = [];
  // The suite-wide ResizeObserver stub never fires; the stage's whole
  // fit-on-render path hangs off that callback, so this one records it.
  globalThis.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) {
      resizeCallbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function fix(el: Element, box: { offset?: [number, number]; client?: [number, number] }) {
  if (box.offset) {
    Object.defineProperty(el, "offsetWidth", { value: box.offset[0], configurable: true });
    Object.defineProperty(el, "offsetHeight", { value: box.offset[1], configurable: true });
  }
  if (box.client) {
    Object.defineProperty(el, "clientWidth", { value: box.client[0], configurable: true });
    Object.defineProperty(el, "clientHeight", { value: box.client[1], configurable: true });
  }
}

/** Opens the modal, stubs the two boxes, and returns the applied transform. */
async function openWith(diagram: [number, number]) {
  render(
    <MemoryRouter>
      <DiagramFrame code="graph TD; a-->b" label="sequence diagram" />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Enlarge sequence diagram" }));

  const viewport = await screen.findByTestId("diagram-zoom-viewport");
  const content = viewport.firstElementChild as HTMLElement;
  // A 1280x800 laptop: the dialog caps at min(92vw, 64rem) = 1024px, of which
  // the stage viewport is 976px inside the dialog's p-6, and h-[76vh] = 608px.
  fix(viewport, { client: [976, 608] });
  fix(content, { offset: diagram });

  await act(async () => {
    resizeCallbacks.forEach((cb) => cb([], {} as ResizeObserver));
  });
  return content.style.transform;
}

describe("Enlarge stage opening view", () => {
  it("leaves a small diagram at natural size, centred", async () => {
    // 320x180 fits 3x over in both axes; upscaling it to fill 76vh is the
    // "5-node cluster map across 1.4 viewports" complaint in reverse.
    expect(await openWith([320, 180])).toBe("translate(0px, 0px) scale(1)");
  });

  it("scales a tall diagram down until the whole of it fits", async () => {
    // 976x1520: width already fits, height needs 608/1520 = 0.4.
    expect(await openWith([976, 1520])).toBe("translate(0px, 0px) scale(0.4)");
  });

  it("stops at the readable floor rather than shrinking a huge diagram to nothing", async () => {
    // 976x4000 wants 0.152. Below 0.25 mermaid's 13px labels are sub-4px and
    // the fit stops being a fit, so the stage clamps and the reader pans.
    expect(await openWith([976, 4000])).toBe("translate(0px, 0px) scale(0.25)");
  });

  it("does nothing while the diagram is still 0x0", async () => {
    // Mermaid renders asynchronously; measuring the empty frames must not
    // divide by zero and blank the stage.
    expect(await openWith([0, 0])).toBe("translate(0px, 0px) scale(1)");
  });
});
