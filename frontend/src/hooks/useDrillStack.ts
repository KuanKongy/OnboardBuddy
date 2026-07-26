import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  decodeDrill,
  encodeDrill,
  framesFromLegacyCluster,
  sameFrames,
  type DrillFrame,
  type DrillViewport,
} from "@/lib/drillStack";

export interface DrillStack {
  frames: DrillFrame[];
  /** Deepest frame, or null at the root level. */
  current: DrillFrame | null;
  depth: number;
  push(frame: DrillFrame, leavingViewport?: DrillViewport): void;
  /** Back to the previous level the user was actually on. */
  pop(): void;
  /** Breadcrumb jump. -1 = root. */
  jumpTo(index: number): void;
  reset(): void;
  /** Viewport saved when leaving that level, if this session pushed it. */
  savedViewport(index: number): DrillViewport | null;
}

interface DrillHistoryState {
  obDepth?: number;
  obViewports?: Record<number, DrillViewport>;
}

/**
 * Drill navigation backed by the URL, so a reload or a shared link lands on
 * the same level and the browser Back button walks the drill path — the
 * property the old `?cluster=` param had and which must not regress.
 *
 * Restore-viewports deliberately live in `history.state`, not the URL: a
 * reload legitimately loses them and falls back to `fitView`, and putting
 * pixel coordinates in a shareable link would make the link mean something
 * different on another screen size.
 */
export function useDrillStack(param = "drill"): DrillStack {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const raw = searchParams.get(param);
  const legacyCluster = searchParams.get("cluster");

  const frames = useMemo(
    // `?cluster=` only applies when there is no `?drill=` — once the user
    // drills, the new param is authoritative.
    () => (raw ? decodeDrill(raw) : framesFromLegacyCluster(legacyCluster)),
    [raw, legacyCluster],
  );

  // Frames are re-decoded on every render; keeping the latest in a ref lets the
  // callbacks stay referentially stable without going stale.
  const framesRef = useRef(frames);
  framesRef.current = frames;

  const historyState = (): DrillHistoryState =>
    (typeof window !== "undefined" ? ((window.history.state?.usr ?? window.history.state) as DrillHistoryState) : {}) ?? {};

  const writeFrames = useCallback(
    (next: DrillFrame[], viewports?: Record<number, DrillViewport>) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next.length > 0) params.set(param, encodeDrill(next));
          else params.delete(param);
          // A drill supersedes the legacy param; leaving both would make the
          // two disagree on the next decode.
          params.delete("cluster");
          return params;
        },
        { state: { obDepth: next.length, obViewports: viewports ?? historyState().obViewports } },
      );
    },
    [param, setSearchParams],
  );

  const push = useCallback(
    (frame: DrillFrame, leavingViewport?: DrillViewport) => {
      const next = [...framesRef.current, frame];
      if (sameFrames(next, framesRef.current)) return;
      const viewports = { ...(historyState().obViewports ?? {}) };
      // Saved against the level being LEFT, so returning restores the camera
      // you had rather than refitting to the whole graph.
      if (leavingViewport) viewports[framesRef.current.length] = leavingViewport;
      writeFrames(next, viewports);
    },
    [writeFrames],
  );

  const pop = useCallback(() => {
    const cur = framesRef.current;
    if (cur.length === 0) return;
    // If this session pushed the current level, going Back IS popping — same
    // motion, one history entry consumed, and Forward still works. Otherwise
    // (cold load on a deep link) there is nothing behind us, so write the
    // truncated stack instead.
    if (historyState().obDepth === cur.length) navigate(-1);
    else writeFrames(cur.slice(0, -1));
  }, [navigate, writeFrames]);

  const jumpTo = useCallback(
    (index: number) => {
      const cur = framesRef.current;
      const target = Math.max(-1, Math.min(index, cur.length - 1));
      const nextLen = target + 1;
      if (nextLen === cur.length) return;
      const delta = nextLen - cur.length;
      if (historyState().obDepth === cur.length && delta < 0 && -delta <= cur.length) {
        navigate(delta);
        return;
      }
      writeFrames(cur.slice(0, nextLen));
    },
    [navigate, writeFrames],
  );

  const reset = useCallback(() => jumpTo(-1), [jumpTo]);

  const savedViewport = useCallback(
    (index: number) => historyState().obViewports?.[index] ?? null,
    [],
  );

  return {
    frames,
    current: frames.length > 0 ? frames[frames.length - 1]! : null,
    depth: frames.length,
    push,
    pop,
    jumpTo,
    reset,
    savedViewport,
  };
}

/**
 * The same ladder, held in component state instead of the URL.
 *
 * `useDrillStack` keeps its depth and its saved viewports in `history.state`,
 * which is ONE object per history entry. Two URL-backed stacks mounted on the
 * same page — the Dependencies tab hosts both the Files ladder and the Classes
 * ladder — therefore overwrite each other's `obDepth` and `obViewports`, and
 * Back on one begins consuming the other's history entries. A second ladder on
 * a page that already has one uses this: identical interface and identical
 * drill transitions, at the cost of not being deep-linkable.
 */
export function useLocalDrillStack(): DrillStack {
  const [frames, setFrames] = useState<DrillFrame[]>([]);
  const viewportsRef = useRef<Record<number, DrillViewport>>({});

  const push = useCallback((frame: DrillFrame, leavingViewport?: DrillViewport) => {
    setFrames((cur) => {
      const next = [...cur, frame];
      if (sameFrames(next, cur)) return cur;
      // Saved against the level being LEFT, so returning restores the camera
      // you had rather than refitting to the whole graph.
      if (leavingViewport) viewportsRef.current[cur.length] = leavingViewport;
      return next;
    });
  }, []);

  const jumpTo = useCallback((index: number) => {
    setFrames((cur) => {
      const target = Math.max(-1, Math.min(index, cur.length - 1));
      return target + 1 === cur.length ? cur : cur.slice(0, target + 1);
    });
  }, []);

  const pop = useCallback(() => setFrames((cur) => (cur.length === 0 ? cur : cur.slice(0, -1))), []);
  const reset = useCallback(() => setFrames((cur) => (cur.length === 0 ? cur : [])), []);
  const savedViewport = useCallback((index: number) => viewportsRef.current[index] ?? null, []);

  return {
    frames,
    current: frames.length > 0 ? frames[frames.length - 1]! : null,
    depth: frames.length,
    push,
    pop,
    jumpTo,
    reset,
    savedViewport,
  };
}
