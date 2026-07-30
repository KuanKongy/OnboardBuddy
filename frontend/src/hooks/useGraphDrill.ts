import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DrillFrame } from "@/lib/drillStack";
import { prefersReducedMotion } from "@/lib/motion";
import type { DrillStack } from "@/hooks/useDrillStack";

export type DrillPhase = "idle" | "zoom-in" | "waiting" | "settle" | "zoom-out";

/**
 * Motion budget. Deliberately short: this is a navigation transition, and
 * anything slower reads as lag rather than as movement.
 */
export const DRILL_TIMING = {
  zoomIn: 400,
  settle: 450,
  zoomOut: 450,
  /** Give up on a slow child fetch rather than stranding the camera. */
  waitTimeout: 6000,
  /** Zoom multiplier at the peak of the dive, and where the child level starts. */
  punchIn: 2.6,
  punchOut: 0.45,
} as const;

export interface GraphDrill {
  phase: DrillPhase;
  /** True while the transition owns the camera and input. */
  busy: boolean;
  /** Node the camera dives into / emerges from. */
  anchorNodeId: string | null;
  /** Set when a drill failed, for the caller to surface. */
  error: string | null;
  drillInto(frame: DrillFrame, nodeId: string): void;
  drillUp(): void;
  jumpTo(index: number): void;
  cancel(): void;
}

export interface UseGraphDrillOptions {
  stack: DrillStack;
  /**
   * Load the data for a level and commit it to the caller's own state.
   * Resolves when the child level is ready to render; rejects to abort the
   * transition. `null` means the root level.
   */
  loadLevel(frame: DrillFrame | null): Promise<void>;
  /** Current viewport, saved against the level being left. */
  readViewport?(): { x: number; y: number; zoom: number } | null;
}

/**
 * Drill-down as an explicit, interruptible transition.
 *
 * Zoom is the *navigation* signal here — clicking a node that has a level
 * below it dives into that node, the data swaps at the peak of the dive, and
 * the child level settles into view. Going back plays it in reverse, so
 * "down" and "up" are visibly opposite motions rather than two different
 * kinds of jump.
 *
 * The phase is exposed rather than kept internal so the canvas can freeze
 * input during a transition and tests can wait on a state instead of a
 * timeout.
 */
export function useGraphDrill({ stack, loadLevel, readViewport }: UseGraphDrillOptions): GraphDrill {
  const [phase, setPhase] = useState<DrillPhase>("idle");
  const [anchorNodeId, setAnchorNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The phase as of *now*, not as of the last render.
   *
   * The re-entry guards below used to read the `phase` state variable out of
   * their own render closure, which is one render behind any transition
   * started in the current tick. One user gesture on a graph node fires BOTH
   * `onNodeClick` and `onSelectionChange` (see GraphCanvas.activate), so both
   * calls saw `phase === "idle"` and each started a `run()`. The first run is
   * then superseded and bails at `if (!live()) return` *without restoring the
   * phase* — correct only while the newer run finishes. Three overlapping
   * starts (a click landing while a remount re-applies the selection) could
   * leave the phase permanently non-idle, and a stuck phase means
   * `busy === true` forever: GraphCanvas then sets `elementsSelectable` and
   * `nodesFocusable` to false, React Flow drops `role="button"`/`tabindex`
   * from every node, and `activate()` early-returns. That is the observed
   * "folder nodes are completely inert, 0 interactive controls" dead end.
   */
  const phaseRef = useRef<DrillPhase>("idle");
  const setPhaseNow = useCallback((next: DrillPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  // Every async continuation checks this: a transition superseded by another
  // (or by unmount) must not write state belonging to a run that is over.
  const runIdRef = useRef(0);
  const aliveRef = useRef(true);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) window.clearTimeout(t);
    timersRef.current = [];
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearTimers();
    };
  }, [clearTimers]);

  const wait = useCallback((ms: number) => new Promise<void>((resolve) => {
    if (ms <= 0) { resolve(); return; }
    timersRef.current.push(window.setTimeout(resolve, ms));
  }), []);

  const cancel = useCallback(() => {
    runIdRef.current += 1;
    clearTimers();
    setPhaseNow("idle");
    setAnchorNodeId(null);
  }, [clearTimers, setPhaseNow]);

  /** Shared body for down/up/jump — they differ only in stack move and timing. */
  const run = useCallback(
    async (opts: {
      nodeId: string | null;
      down: boolean;
      applyStack(leavingViewport?: { x: number; y: number; zoom: number }): void;
      targetFrame: DrillFrame | null;
    }) => {
      const myRun = ++runIdRef.current;
      const live = () => aliveRef.current && runIdRef.current === myRun;
      const reduced = prefersReducedMotion();
      setError(null);
      setAnchorNodeId(opts.nodeId);

      try {
        // 1. Dive (or begin the pull-back). The camera work itself is done by
        //    DrillCamera, which reads `phase` and `anchorNodeId`.
        setPhaseNow(opts.down ? "zoom-in" : "zoom-out");

        // 2. Fetch and the animation overlap deliberately — on a warm cache
        //    the data is ready before the dive finishes and nothing waits.
        const load = loadLevel(opts.targetFrame);
        await wait(reduced ? 0 : opts.down ? DRILL_TIMING.zoomIn : DRILL_TIMING.zoomOut);
        if (!live()) return;

        let timedOut = false;
        setPhaseNow("waiting");
        await Promise.race([
          load,
          wait(DRILL_TIMING.waitTimeout).then(() => { timedOut = true; }),
        ]);
        if (!live()) return;
        if (timedOut) throw new Error("Timed out loading that level");

        // 3. Commit the move only once its data is in hand, so a failed load
        //    leaves the user where they were instead of on a blank level.
        opts.applyStack(readViewport?.() ?? undefined);

        setPhaseNow("settle");
        await wait(reduced ? 0 : DRILL_TIMING.settle);
        if (!live()) return;
        setPhaseNow("idle");
        setAnchorNodeId(null);
      } catch (err) {
        if (!live()) return;
        setError(err instanceof Error ? err.message : "Could not open that level");
        setPhaseNow("idle");
        setAnchorNodeId(null);
      }
    },
    [loadLevel, readViewport, wait, setPhaseNow],
  );

  const drillInto = useCallback(
    (frame: DrillFrame, nodeId: string) => {
      if (phaseRef.current !== "idle") return;
      void run({
        nodeId,
        down: true,
        targetFrame: frame,
        applyStack: (vp) => stack.push(frame, vp),
      });
    },
    [run, stack],
  );

  const drillUp = useCallback(() => {
    if (phaseRef.current !== "idle" || stack.depth === 0) return;
    const parent = stack.depth >= 2 ? stack.frames[stack.depth - 2]! : null;
    // Emerge from the node that was drilled into, so up is visibly the
    // reverse of down rather than an unrelated refit.
    void run({
      nodeId: stack.current?.id ?? null,
      down: false,
      targetFrame: parent,
      applyStack: () => stack.pop(),
    });
  }, [run, stack]);

  const jumpTo = useCallback(
    (index: number) => {
      if (phaseRef.current !== "idle") return;
      const target = index >= 0 ? stack.frames[index] ?? null : null;
      void run({
        nodeId: stack.current?.id ?? null,
        down: false,
        targetFrame: target,
        applyStack: () => stack.jumpTo(index),
      });
    },
    [run, stack],
  );

  return useMemo(
    () => ({
      phase,
      busy: phase !== "idle",
      anchorNodeId,
      error,
      drillInto,
      drillUp,
      jumpTo,
      cancel,
    }),
    [phase, anchorNodeId, error, drillInto, drillUp, jumpTo, cancel],
  );
}
