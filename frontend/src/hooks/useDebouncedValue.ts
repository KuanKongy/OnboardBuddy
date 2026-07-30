import { useEffect, useState } from "react";

/**
 * Settled copy of a fast-changing value.
 *
 * For a search box: the input echoes every keystroke, this is what the
 * expensive work (filter → edge cap → dagre layout) keys off. Bug #70(2)
 * measured a full re-layout per character on a 200-node level.
 */
export function useDebouncedValue<T>(value: T, delayMs: number, emptyValue?: T): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    // Clearing is not typing: the X button and an emptied box snap back to the
    // whole set rather than sitting on a stale filter for the delay.
    if (emptyValue !== undefined && value === emptyValue) {
      setSettled(value);
      return;
    }
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs, emptyValue]);

  return settled;
}
