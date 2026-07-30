import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { scrollBehavior } from "@/lib/motion";

export interface TourStep {
  /** Matches a `data-tour="<target>"` attribute somewhere in the dashboard. */
  target: string;
  title: string;
  body: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const HIGHLIGHT_PADDING = 6;
const CARD_WIDTH = 288;
const CARD_GAP = 12;
const CARD_ESTIMATED_HEIGHT = 180;

function getTargetEl(target: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
}

function measure(target: string): Rect | null {
  const el = getTargetEl(target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top - HIGHLIGHT_PADDING,
    left: r.left - HIGHLIGHT_PADDING,
    width: r.width + HIGHLIGHT_PADDING * 2,
    height: r.height + HIGHLIGHT_PADDING * 2,
  };
}

/** True when `el` actually has on-screen pixels — catches CSS transforms
 * (e.g. the mobile drawer's `-translate-x-full`) that `offsetParent` misses
 * since it only detects `display: none`. */
function isOnScreen(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  return r.right > 0 && r.bottom > 0 && r.left < viewportWidth && r.top < viewportHeight;
}

interface AppTourProps {
  steps: TourStep[];
  /** Called on Skip, Esc, or completing the final step. */
  onDone: () => void;
}

/**
 * Hand-rolled spotlight coach-mark tour. Anchors to real dashboard elements
 * via `data-tour="<id>"`. Steps whose anchor isn't currently rendered (e.g.
 * an empty-state dashboard has no stats row) are skipped automatically.
 */
export function AppTour({ steps, onDone }: AppTourProps) {
  // Filter on visibility, not just existence: `hidden lg:block` asides exist
  // in the DOM on mobile with a zero rect, which would spotlight nothing.
  const [available] = useState(() =>
    steps.filter((s) => {
      const el = getTargetEl(s.target);
      return el !== null && el.offsetParent !== null && isOnScreen(el);
    }),
  );
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const step = available[index] ?? null;

  // Closing unmounts the focused card, which resets focus to <body>. Captured in
  // the first effect declared, so it runs before the per-step focus steal below.
  const returnFocusTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    return () => { returnFocusTo.current?.focus(); };
  }, []);

  const reposition = useCallback(() => {
    setRect(step ? measure(step.target) : null);
  }, [step]);

  // Scroll the target into view and (re)measure whenever the step changes.
  useEffect(() => {
    if (!step) return;
    const el = getTargetEl(step.target);
    el?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    reposition();
    const settle = window.setTimeout(reposition, 300);
    return () => window.clearTimeout(settle);
  }, [step, reposition]);

  useEffect(() => {
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [reposition]);

  useEffect(() => {
    cardRef.current?.focus();
  }, [step]);

  const handleNext = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= available.length) {
        onDone();
        return i;
      }
      return i + 1;
    });
  }, [available.length, onDone]);

  const handleBack = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // No anchors survived filtering (e.g. tour re-triggered mid-loading) — bail.
  useEffect(() => {
    if (available.length === 0) onDone();
  }, [available.length, onDone]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onDone();
      } else if (e.key === "Enter") {
        // Let a focused button (Back / Skip tour) handle its own Enter press;
        // only advance when Enter isn't activating a control.
        if (e.target instanceof HTMLElement && e.target.closest("button")) return;
        e.preventDefault();
        handleNext();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleBack();
      } else if (e.key === "Tab") {
        // Minimal focus containment so aria-modal is honest: keep Tab cycling
        // within the tour card instead of escaping into the dimmed page.
        const card = cardRef.current;
        if (!card) return;
        const focusables = card.querySelectorAll<HTMLElement>("button, [tabindex]:not([tabindex='-1'])");
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        const active = document.activeElement;
        if (!card.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && (active === first || active === card)) {
          e.preventDefault();
          last.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDone, handleNext, handleBack]);

  if (!step) return null;

  let cardTop: number;
  let cardLeft: number;
  if (rect) {
    const spaceBelow = window.innerHeight - (rect.top + rect.height);
    const spaceAbove = rect.top;
    cardTop =
      spaceBelow >= CARD_ESTIMATED_HEIGHT + CARD_GAP || spaceBelow >= spaceAbove
        ? Math.min(
            rect.top + rect.height + CARD_GAP,
            window.innerHeight - CARD_ESTIMATED_HEIGHT - CARD_GAP,
          )
        : Math.max(CARD_GAP, rect.top - CARD_ESTIMATED_HEIGHT - CARD_GAP);
    cardLeft = Math.min(Math.max(CARD_GAP, rect.left), window.innerWidth - CARD_WIDTH - CARD_GAP);
  } else {
    cardTop = window.innerHeight / 2 - CARD_ESTIMATED_HEIGHT / 2;
    cardLeft = window.innerWidth / 2 - CARD_WIDTH / 2;
  }

  return (
    <div className="fixed inset-0 z-[60]" data-tour-overlay>
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-md border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] transition-all duration-200"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-black/60" />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${step.title} — step ${index + 1} of ${available.length}`}
        tabIndex={-1}
        className="fixed w-72 max-w-[85vw] rounded-lg border border-border bg-card p-3 text-xs shadow-xl outline-none transition-all duration-200"
        style={{ top: cardTop, left: cardLeft }}
      >
        <p className="mb-1 text-[0.6875rem] font-medium text-muted-foreground">
          {index + 1} of {available.length}
        </p>
        <p className="font-semibold text-foreground">{step.title}</p>
        <p className="mt-1 text-muted-foreground">{step.body}</p>
        <div className="mt-3 flex items-center justify-between">
          <Button variant="ghost" size="xs" onClick={onDone}>
            Skip tour
          </Button>
          <div className="flex gap-1.5">
            {index > 0 && (
              <Button variant="outline" size="xs" onClick={handleBack}>
                Back
              </Button>
            )}
            <Button size="xs" onClick={handleNext}>
              {index + 1 === available.length ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
