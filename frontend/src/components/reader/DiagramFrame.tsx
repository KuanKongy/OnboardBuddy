import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Maximize2, Minus, Plus, Scan } from "lucide-react";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Interactive zoom bounds. Below 0.25 mermaid's 13px labels stop being text at
 * all, and past 4 an SVG is already bigger than anything the modal can frame,
 * so both ends are dead travel rather than useful range. A diagram that needs
 * less than 0.25 to fit whole (roughly 4 viewport-heights of ER tables) opens
 * at 0.25 and is panned — clamped, not silently rescaled to something that
 * cannot be read.
 */
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
/** One press of + / −, and one double-click. */
const ZOOM_STEP = 1.25;

/**
 * ctrl/cmd+wheel zoom rate, in inverse pixels, applied as `2 ** (-dy * rate)`.
 * This is d3-zoom's own ctrl+wheel number (its 0.002 px⁻¹ base times the ×10
 * it applies when ctrlKey is set), which is what React Flow zooms at — and the
 * Architecture canvas IS React Flow, so matching the constant is what makes
 * the two surfaces feel like the same control rather than two guesses.
 */
const ZOOM_WHEEL_RATE = 0.02;
/**
 * Firefox and some mice report wheel deltas in lines (deltaMode 1) rather than
 * pixels, where one notch is ~3. Panning by the raw number would move the
 * diagram three pixels per notch, which reads as a dead gesture.
 */
const WHEEL_LINE_PX = 16;

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/**
 * Frame bounds for the enlarged view. The width cap is the viewport-relative
 * one first, so the modal never runs off a narrow window; the absolute 80rem
 * stops a 4K monitor from turning a wide diagram into a left-to-right scan.
 * The height floor keeps a 90px flowchart from opening as a letterbox slot.
 */
const FRAME_MAX_VW = 0.92;
const FRAME_MAX_REM = 80;
const STAGE_MIN_REM = 16;
const STAGE_MAX_VH = 0.82;
/** Used only when the diagram's size is not knowable yet. */
const STAGE_DEFAULT_REM = 32;
/**
 * A CSS backstop on the computed width, since the frame is a fixed px chosen
 * when the modal opens and the window can be resized after that.
 */
const FRAME_MAX_CSS = `min(${FRAME_MAX_VW * 100}vw, ${FRAME_MAX_REM}rem)`;
/**
 * DialogContent's own horizontal chrome, added back so the frame is sized to
 * hold the diagram rather than to equal it: `p-6` on both sides plus the 1px
 * border, under the global `box-sizing: border-box`.
 */
const DIALOG_CHROME_X = 2 * 24 + 2;

/** Pan offset in px from the viewport centre, plus the zoom factor. */
interface StageView {
  scale: number;
  x: number;
  y: number;
}

/** The diagram's laid-out size, in CSS px, once mermaid has rendered it. */
interface NaturalSize {
  width: number;
  height: number;
}

/** Everything about the enlarged view that is decided before it opens. */
interface OpenFrame {
  /** Dialog width and stage height, in px. */
  width: number;
  stageHeight: number;
  /** The scale the stage opens at. */
  scale: number;
}

/**
 * The whole sizing decision, taken once, synchronously, from numbers that are
 * already known when the reader clicks Enlarge.
 *
 * This replaced an observe-measure-resize-refit loop, and the reason is worth
 * keeping: the modal cannot measure a diagram that has not rendered yet, so
 * anything that starts from the modal is necessarily asynchronous, and every
 * asynchronous version of this raced something. Live, the last one never
 * applied at all and pinned the renderer. But the inline preview HAS already
 * rendered — nobody can click Enlarge before it has — and it publishes its own
 * natural size (see MermaidDiagram). The modal renders the same diagram with
 * the same renderer, so that number describes it too, and the answer is
 * arithmetic rather than a race.
 *
 * Both boxes are px rather than `min()`/`clamp()` so the scale below divides by
 * the stage that will actually exist, instead of a CSS expression this code
 * would have to predict.
 */
function frameFor(natural: NaturalSize | null): OpenFrame {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  // innerWidth, not `documentElement.clientWidth`: the dialog is modal, so by
  // the time it is laid out the page scrollbar has been removed and the width
  // it gets is the one INCLUDING that gutter.
  const maxWidth = Math.min(FRAME_MAX_VW * window.innerWidth, FRAME_MAX_REM * rem);
  const maxStageHeight = STAGE_MAX_VH * window.innerHeight;

  if (!natural) {
    // No diagram to size to: an unrendered preview, or one that fell back to
    // its source. Open at the caps rather than guessing; Fit is one click away.
    return {
      width: Math.round(maxWidth),
      stageHeight: Math.round(Math.min(STAGE_DEFAULT_REM * rem, maxStageHeight)),
      scale: 1,
    };
  }

  const width = Math.round(Math.min(natural.width + DIALOG_CHROME_X, maxWidth));
  const stageHeight = Math.round(
    Math.min(Math.max(STAGE_MIN_REM * rem, natural.height), maxStageHeight),
  );
  const stageWidth = width - DIALOG_CHROME_X;
  return {
    width,
    stageHeight,
    // Scaled DOWN to fit, never up: a five-node cluster map blown up to fill
    // the stage is as unhelpful as a 37-table ER squeezed into 285px.
    scale: clampScale(
      Math.min(1, stageWidth / natural.width, stageHeight / natural.height),
    ),
  };
}

/** The size the inline preview published when its diagram landed. */
function readNaturalSize(root: HTMLElement | null): NaturalSize | null {
  const figure = root?.querySelector<HTMLElement>("[data-natural-width]");
  if (!figure) return null;
  const width = Number(figure.dataset.naturalWidth);
  const height = Number(figure.dataset.naturalHeight);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * A pan/zoom surface for the enlarged diagram.
 *
 * Hand-rolled rather than a library: the whole interaction is one transform
 * string and three handlers, and the reader bundle already carries mermaid.
 *
 * Deliberately inert until touched. It observes nothing, measures nothing on
 * mount and schedules no frames: the opening view arrives fully decided in
 * `frame`, as the stage's initial state. Everything that reads live geometry
 * is behind a user action (the Fit button), so once the modal is open this
 * component does no work at all until the reader does something. That is the
 * whole point of the rewrite. The version it replaced measured on a frame
 * clock, and in the real reader tree it never converged and pinned the
 * renderer instead.
 */
function ZoomStage({ children, frame }: { children: ReactNode; frame: OpenFrame }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Fresh on every open: Radix unmounts the dialog's content when it closes,
  // so the opening scale is simply what this mounts with.
  const [view, setView] = useState<StageView>({ scale: frame.scale, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);

  /**
   * The Fit button, and only the Fit button. This is the one place that reads
   * the live boxes, which is what makes it the correct recourse whenever the
   * click-time arithmetic and reality disagree: a window resized while the
   * modal is open, or a diagram whose modal render came out a different size
   * from its preview.
   */
  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    // offsetWidth/Height are the pre-transform layout box, so this measures the
    // diagram at its laid-out size whatever scale is currently applied.
    const width = content.offsetWidth;
    const height = content.offsetHeight;
    if (width <= 0 || height <= 0) return;
    const ratio = Math.min(viewport.clientWidth / width, viewport.clientHeight / height);
    setView({ scale: clampScale(Math.min(1, ratio)), x: 0, y: 0 });
  }, []);

  /** Zoom keeping the diagram point under (clientX, clientY) under it. */
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const box = viewport.getBoundingClientRect();
    // The content is centred in the viewport and scaled about its own centre,
    // so the pan offsets live in a coordinate space whose origin is the
    // viewport centre; the pointer has to be expressed the same way.
    const px = clientX - box.left - box.width / 2;
    const py = clientY - box.top - box.height / 2;
    setView((v) => {
      const scale = clampScale(v.scale * factor);
      if (scale === v.scale) return v;
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  const panBy = useCallback((dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    /**
     * React Flow's wheel contract, which the Architecture canvas already has:
     * a plain wheel — which is what a macOS two-finger scroll sends — PANS, and
     * only ctrl/cmd+wheel zooms. The previous handler zoomed on every wheel
     * event, so the ordinary gesture for "look around" rescaled the diagram
     * instead of moving it (the reported friction). macOS delivers a trackpad
     * pinch as a wheel event with ctrlKey set, so pinch lands on the zoom
     * branch without any gesture-event plumbing.
     */
    const onWheel = (event: WheelEvent) => {
      // React registers `onWheel` passively on the root container, so
      // `preventDefault` from a JSX handler is a no-op and the gesture also
      // scrolls the dialog behind it. A native non-passive listener is the
      // only way to own it — for the pan branch as much as the zoom branch.
      event.preventDefault();
      const unit =
        event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? viewport.clientHeight : 1;
      const dy = event.deltaY * unit;
      if (event.ctrlKey || event.metaKey) {
        zoomAt(event.clientX, event.clientY, 2 ** (-dy * ZOOM_WHEEL_RATE));
        return;
      }
      // 1:1 and both axes: the content moves with the fingers, so scrolling
      // down walks DOWN the diagram (the translate goes the other way).
      panBy(-event.deltaX * unit, -dy);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoomAt, panBy]);

  /** Button zoom: same maths with the pointer pinned to the centre. */
  const zoomCentre = (factor: number) => {
    setView((v) => {
      const scale = clampScale(v.scale * factor);
      if (scale === v.scale) return v;
      return { scale, x: (v.x * scale) / v.scale, y: (v.y * scale) / v.scale };
    });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragFrom.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = dragFrom.current;
    if (!from) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    dragFrom.current = { x: event.clientX, y: event.clientY };
    panBy(dx, dy);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragFrom.current) return;
    dragFrom.current = null;
    setDragging(false);
    // Releasing a capture that was never taken throws, and pointercancel can
    // arrive after the browser has already dropped it.
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="relative">
      <div
        ref={viewportRef}
        data-testid="diagram-zoom-viewport"
        // `grid-rows-1` is load-bearing, not tidiness. Without it the implicit
        // row is auto-sized, so a 6979px ER diagram grows the track to 6979px
        // and `place-items-center` has nothing to centre against: the diagram
        // sits at the top of a track taller than the window, and scaling it
        // about its own centre pushed every table below the fold — the stage
        // opened blank at a correctly computed scale. `minmax(0, 1fr)` pins the
        // track to the stage's own height, so an overflowing diagram is centred
        // in the window and overflows it evenly on both sides. That is also why
        // the height below is a definite length rather than `fit-content`: an
        // auto-sized row would grow back to 6979px and reinstate the bug.
        //
        // `grid-cols-1` is the same fix in the other axis, and it became
        // load-bearing when the content box became max-content sized. Measured
        // in Chrome: without it the implicit column grew to the 37-table ER's
        // 7005px, so the stage's own box was 7005px wide, `overflow-hidden`
        // clipped nothing, and the diagram overflowed the modal to the right
        // only instead of being centred in it.
        style={{ height: `${frame.stageHeight}px` }}
        className={cn(
          // select-none: without it a pan drag doubles as text selection and
          // paints the diagram's labels blue.
          "grid grid-cols-1 grid-rows-1 touch-none select-none place-items-center overflow-hidden rounded-lg",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => zoomAt(event.clientX, event.clientY, ZOOM_STEP)}
      >
        {/* `w-max` (max-content), not `w-full` and not the default fit-content.
            This box IS the measurement the frame is sized from, so it must not
            depend on the frame: `w-full` measures the stage back to itself
            (which is how the modal ended up identical for a two-participant
            sequence diagram and a 37-table ER), and fit-content clamps at the
            available width, which feeds the frame's own width back in — the
            empty figure that exists for the frames before mermaid resolves
            would shrink the frame, and the diagram would then be laid out
            inside that shrunken frame and lock it there.

            Max-content is the diagram's own width whatever the frame is doing,
            so it only ever grows as the SVG arrives. A diagram wider than the
            stage overflows it evenly on both sides (place-items-center) and is
            clipped, which is what the fit scale and the pan exist for. */}
        <div
          ref={contentRef}
          className="w-max origin-center will-change-transform"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          {children}
        </div>
      </div>
      {/* Siblings of the viewport, not children: a pointerdown inside it starts
          a pan, and a zoom button that also drags the diagram is a broken
          button. */}
      <div className="absolute right-2 top-2 flex items-center gap-1">
        <Button
          size="xs"
          variant="outline"
          className="bg-background/85 px-1.5 backdrop-blur"
          onClick={() => zoomCentre(ZOOM_STEP)}
          aria-label="Zoom in"
        >
          <Plus className="h-3 w-3" aria-hidden />
        </Button>
        <Button
          size="xs"
          variant="outline"
          className="bg-background/85 px-1.5 backdrop-blur"
          onClick={() => zoomCentre(1 / ZOOM_STEP)}
          aria-label="Zoom out"
        >
          <Minus className="h-3 w-3" aria-hidden />
        </Button>
        <Button
          size="xs"
          variant="outline"
          className="gap-1 bg-background/85 backdrop-blur"
          onClick={fit}
          aria-label="Fit diagram to view"
        >
          <Scan className="h-3 w-3" aria-hidden />
          Fit
        </Button>
      </div>
    </div>
  );
}

/**
 * Size discipline for the reader's anchor diagrams (audit E2 / §19.2, and
 * READER_REDESIGN.md N12): the same raw `MermaidDiagram` rendered a 37-table
 * ER at ~285px (unreadable, no recourse) and a 5-node cluster map across 1.4
 * viewports (no prose visible on the first screen). The reading flow gets a
 * height-clamped, scrollable preview; the full-size diagram lives one click
 * away in a near-fullscreen lightbox — content present, quiet until asked
 * (owner rule K1 applied to pictures).
 */
export function DiagramFrame({
  code,
  label,
  projectId,
}: {
  code: string;
  label: string;
  projectId?: string;
}) {
  const [open, setOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<OpenFrame | null>(null);

  return (
    <div className="group relative">
      <div ref={previewRef} className="max-h-[22rem] overflow-auto rounded-lg">
        <MermaidDiagram code={code} label={label} projectId={projectId} />
      </div>
      <Button
        size="xs"
        variant="outline"
        className="absolute right-2 top-2 gap-1 bg-background/85 backdrop-blur"
        // Both updates in one handler, so they land in one commit and the
        // dialog's first render already has the size it should be.
        onClick={() => {
          setFrame(frameFor(readNaturalSize(previewRef.current)));
          setOpen(true);
        }}
        aria-label={`Enlarge ${label}`}
      >
        <Maximize2 className="h-3 w-3" aria-hidden />
        Enlarge
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* The frame follows the diagram. A fixed 64rem × 76vh box put a
            two-participant sequence diagram in a sea of empty background, and
            the cap it was set to was itself a compromise: 80rem used to put a
            wide diagram edge to edge on a laptop, so the width was capped for
            everyone to protect the few that needed it. Sizing to content
            separates the two — small diagrams get a small modal, and only a
            diagram that genuinely fills the screen reaches the wide cap, where
            the stage's pan/zoom is what makes it readable.

            A px width with a CSS cap behind it, not a `min()`: the width is
            chosen once when the modal opens, and `maxWidth` is what keeps a
            window resized afterwards from pushing it off screen. `maxWidth`
            also has to be set at all, because `sm:max-w-lg` from the base
            DialogContent would otherwise win over the width alone.

            `grid-cols-1` for the reason spelled out on the stage below: the
            base DialogContent is a grid with an implicit auto column, which a
            max-content stage grows past the dialog's own width, and
            `overflow-auto` then hands the modal a horizontal scrollbar over a
            diagram that is supposed to be panned, not scrolled. */}
        {frame && (
          <DialogContent
            className="max-h-[92vh] grid-cols-1 overflow-auto"
            style={{ width: `${frame.width}px`, maxWidth: FRAME_MAX_CSS }}
          >
            {/* Radix requires a title on every dialog, but the figure inside
                already prints one — two stacked headers saying "sequence
                diagram" is the visible duplicate. Kept in the tree for the
                accessible name, taken off the screen. */}
            <DialogTitle className="sr-only">{label}</DialogTitle>
            <ZoomStage frame={frame}>
              <MermaidDiagram code={code} label={label} projectId={projectId} />
            </ZoomStage>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
