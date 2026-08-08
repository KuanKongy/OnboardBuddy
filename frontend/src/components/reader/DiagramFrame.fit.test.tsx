import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DiagramFrame } from "./DiagramFrame";

/**
 * The arithmetic that turns a diagram's natural size into the modal that
 * frames it, and the scale it opens at.
 *
 * That arithmetic is invisible on screen — a wrong `min` silently opens a
 * 37-table ER cropped instead of fitted, which looks like a rendering bug
 * rather than a maths bug — and it is now the WHOLE mechanism: the size is
 * decided once, synchronously, from the number the inline preview published
 * when it rendered. There is no measurement of the modal, no observer and no
 * frame clock, so there is nothing here to step or flush. If a test in this
 * file ever needs to wait for something, the mechanism has regressed.
 *
 * `MermaidDiagram` is stubbed: jsdom lays nothing out, so the real one could
 * not publish a size anyway, and the stub is how the "preview has not rendered
 * yet" case gets expressed at all.
 */

const preview = vi.hoisted(() => ({ natural: null as [number, number] | null }));

vi.mock("@/components/MermaidDiagram", () => ({
  MermaidDiagram: ({ label }: { label?: string }) => (
    <figure
      data-natural-width={preview.natural ? String(preview.natural[0]) : undefined}
      data-natural-height={preview.natural ? String(preview.natural[1]) : undefined}
    >
      <figcaption>{label}</figcaption>
    </figure>
  ),
}));

beforeEach(() => {
  preview.natural = [320, 180];
  // A 1280x800 laptop, spelled out because every number below is derived from
  // it: the frame caps at min(92vw, 80rem) = min(1177.6, 1280) = 1177.6, and
  // the stage at 82vh = 656 with a 16rem = 256 floor.
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
});

/** Opens the modal with the preview reporting `natural`, and returns the parts. */
async function openWith(natural: [number, number] | null) {
  preview.natural = natural;
  render(
    <MemoryRouter>
      <DiagramFrame code="graph TD; a-->b" label="sequence diagram" />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Enlarge sequence diagram" }));

  const viewport = await screen.findByTestId("diagram-zoom-viewport");
  return {
    viewport,
    content: viewport.firstElementChild as HTMLElement,
    dialog: screen.getByRole("dialog"),
  };
}

const scaleOf = (el: HTMLElement) => Number(/scale\(([-\d.]+)\)/.exec(el.style.transform)?.[1]);

describe("Enlarge frame sizing", () => {
  it("hugs a small diagram instead of opening a 64rem box around it", async () => {
    const { dialog, viewport, content } = await openWith([320, 180]);

    // 320 + DialogContent's p-6 and border = 370, under both caps. 180 is below
    // the 16rem floor, so the stage keeps a usable slot rather than a letterbox.
    expect(dialog.style.width).toBe("370px");
    expect(viewport.style.height).toBe("256px");
    // Stage 320 wide for a 320 diagram: it fits, and is not blown up to fill.
    expect(scaleOf(content)).toBe(1);
  });

  it("scales a tall diagram down until the whole of it fits", async () => {
    const { dialog, viewport, content } = await openWith([976, 1520]);

    expect(dialog.style.width).toBe("1026px");
    expect(viewport.style.height).toBe("656px");
    // Width already fits (stage 976 for a 976 diagram); height needs 656/1520.
    expect(scaleOf(content)).toBeCloseTo(0.4316, 4);
  });

  it("stops at the readable floor rather than shrinking a huge diagram to nothing", async () => {
    // 976x4000 wants 0.164. Below 0.25 mermaid's 13px labels are sub-4px and
    // the fit stops being a fit, so the stage clamps and the reader pans.
    const { content } = await openWith([976, 4000]);

    expect(scaleOf(content)).toBe(0.25);
  });

  it("lets a huge diagram run to the caps rather than to its own size", async () => {
    const { dialog, viewport, content } = await openWith([6979, 4000]);

    // 7029 loses to 92vw = 1177.6, so the frame caps and the stage is 1128.
    expect(dialog.style.width).toBe("1178px");
    expect(viewport.style.height).toBe("656px");
    expect(scaleOf(content)).toBe(0.25);
  });

  it("keeps a CSS cap behind the px width, for a window resized after opening", async () => {
    // The width is chosen once, at click time. Without this the dialog would
    // stay 1178px wide on a window that had since become narrower than that.
    const { dialog } = await openWith([6979, 4000]);

    expect(dialog.style.maxWidth).toBe("min(92vw, 80rem)");
  });

  it("opens at the caps when the preview has no size to offer", async () => {
    // A preview still rendering, or one that fell back to its source. Guessing
    // a size would be worse than opening wide with Fit one click away.
    const { dialog, viewport, content } = await openWith(null);

    expect(dialog.style.width).toBe("1178px");
    expect(viewport.style.height).toBe("512px");
    expect(scaleOf(content)).toBe(1);
  });
});

/**
 * React Flow's wheel contract, which the Architecture canvas already has. The
 * old handler zoomed on every wheel event, so a macOS two-finger scroll — the
 * ordinary "look around" gesture — rescaled the diagram instead of moving it.
 */
describe("Enlarge stage wheel gesture", () => {
  it("pans on a plain wheel, both axes, 1:1", async () => {
    const { viewport, content } = await openWith([320, 180]);

    fireEvent.wheel(viewport, { deltaX: 30, deltaY: 40 });

    // The content moves opposite the scroll, so scrolling down walks down the
    // diagram. Scale untouched: this gesture is not a zoom any more.
    expect(content.style.transform).toBe("translate(-30px, -40px) scale(1)");
  });

  it("converts line-mode deltas to pixels instead of panning three pixels a notch", async () => {
    const { viewport, content } = await openWith([320, 180]);

    fireEvent.wheel(viewport, { deltaX: 0, deltaY: 3, deltaMode: 1 });

    expect(content.style.transform).toBe("translate(0px, -48px) scale(1)");
  });

  it("zooms on ctrl+wheel (which is how macOS delivers a trackpad pinch)", async () => {
    const { viewport, content } = await openWith([320, 180]);

    // -50px at d3-zoom's ctrl rate of 0.02 is 2 ** 1 = one doubling.
    fireEvent.wheel(viewport, { deltaY: -50, ctrlKey: true, clientX: 0, clientY: 0 });

    expect(content.style.transform).toBe("translate(0px, 0px) scale(2)");
  });

  it("zooms on cmd+wheel too, and stops at the ceiling", async () => {
    const { viewport, content } = await openWith([320, 180]);

    // 4x would be reached exactly at -100; -200 asks for 16x.
    fireEvent.wheel(viewport, { deltaY: -200, metaKey: true, clientX: 0, clientY: 0 });

    expect(content.style.transform).toBe("translate(0px, 0px) scale(4)");
  });
});
