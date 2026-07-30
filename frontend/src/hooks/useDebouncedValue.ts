import { useEffect, useState } from "react";

/**
 * Settled copy of a fast-changing value. For a search box: the input echoes every
 * keystroke, this is what the expensive work keys off.
 */
export function useDebouncedValue<T>(value: T, delayMs: number, emptyValue?: T): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    // Clearing is not typing: an emptied box snaps back rather than sitting on a
    // stale filter for the delay.
    if (emptyValue !== undefined && value === emptyValue) {
      setSettled(value);
      return;
    }
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs, emptyValue]);

  return settled;
}
