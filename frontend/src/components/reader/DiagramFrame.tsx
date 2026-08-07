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

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** Pan offset in px from the viewport centre, plus the zoom factor. */
interface StageView {
  scale: number;
  x: number;
  y: number;
}

/**
 * A pan/zoom surface for the enlarged diagram.
 *
 * Hand-rolled rather than a library: the whole interaction is one transform
 * string and three handlers, and the reader bundle already carries mermaid.
 *
 * The stage opens fit-and-centred — the diagram is scaled DOWN until it fits
 * the viewport, never up, because the complaint that produced the inline
 * preview's height clamp cuts both ways: a five-node cluster map blown up to
 * fill 76vh is as unhelpful as a 37-table ER squeezed into 285px.
 */
function ZoomStage({ children }: { children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<StageView>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  /**
   * Auto-fit tracks the diagram until the reader takes over. After that a
   * re-render must not yank their zoom back: flipping the theme re-runs
   * `mermaid.render` and resizes the content, and re-fitting there would have
   * thrown away the position they had just panned to.
   */
  const readerDrove = useRef(false);

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    // offsetWidth/Height are the pre-transform layout box, so this measures the
    // diagram at its laid-out size whatever scale is currently applied.
    const width = content.offsetWidth;
    const height = content.offsetHeight;
    // Mermaid renders asynchronously (dynamic import, then an async render), so
    // the first frames are 0x0 — and jsdom never lays anything out at all.
    // Leaving the view alone beats dividing by zero and blanking the stage.
    if (width <= 0 || height <= 0) return;
    const ratio = Math.min(viewport.clientWidth / width, viewport.clientHeight / height);
    setView({ scale: clampScale(Math.min(1, ratio)), x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    fit();
    if (typeof ResizeObserver === "undefined") return;
    // The SVG lands one or more frames after mount, so mount-time measurement
    // alone always reads 0 — the observer is what makes the opening view fit.
    const observer = new ResizeObserver(() => {
      if (!readerDrove.current) fit();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [fit]);

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
    readerDrove.current = true;
    setView((v) => {
      const scale = clampScale(v.scale * factor);
      if (scale === v.scale) return v;
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // React registers `onWheel` passively on the root container, so
    // `preventDefault` from a JSX handler is a no-op and every zoom also
    // scrolls the dialog behind it. A native non-passive listener is the only
    // way to own the gesture.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0015));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  /** Button zoom: same maths with the pointer pinned to the centre. */
  const zoomCentre = (factor: number) => {
    readerDrove.current = true;
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
    readerDrove.current = true;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
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
        // track to the 76vh viewport, so an overflowing diagram is centred in
        // the window and overflows it evenly on both sides.
        className={cn(
          "grid h-[76vh] grid-rows-1 touch-none place-items-center overflow-hidden rounded-lg",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => zoomAt(event.clientX, event.clientY, ZOOM_STEP)}
      >
        <div
          ref={contentRef}
          className="w-full origin-center will-change-transform"
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
          onClick={() => {
            readerDrove.current = false;
            fit();
          }}
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
  return (
    <div className="group relative">
      <div className="max-h-[22rem] overflow-auto rounded-lg">
        <MermaidDiagram code={code} label={label} projectId={projectId} />
      </div>
      <Button
        size="xs"
        variant="outline"
        className="absolute right-2 top-2 gap-1 bg-background/85 backdrop-blur"
        onClick={() => setOpen(true)}
        aria-label={`Enlarge ${label}`}
      >
        <Maximize2 className="h-3 w-3" aria-hidden />
        Enlarge
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* 64rem, not 80rem: at the wider cap a diagram sat edge to edge on a
            laptop and reading it meant scanning left-right across the whole
            screen for every edge. The stage below is what recovers the detail
            that the narrower frame costs. */}
        <DialogContent className="max-h-[92vh] w-[min(92vw,64rem)] overflow-auto sm:max-w-[min(92vw,64rem)]">
          {/* Radix requires a title on every dialog, but the figure inside
              already prints one — two stacked headers saying "sequence
              diagram" is the visible duplicate. Kept in the tree for the
              accessible name, taken off the screen. */}
          <DialogTitle className="sr-only">{label}</DialogTitle>
          <ZoomStage>
            <MermaidDiagram code={code} label={label} projectId={projectId} />
          </ZoomStage>
        </DialogContent>
      </Dialog>
    </div>
  );
}
