// Exported so sibling modules can import it, but absent from the barrel and
// from `exports`. A consumer cannot reach it, so it is not public API and must
// not be reported as an entrypoint.
export function normalizeAmount(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function assertFinite(amount: number): void {
  if (!Number.isFinite(amount)) throw new RangeError('amount must be finite');
}
