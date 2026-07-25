/**
 * Negative case: never named in any export clause, so reconciliation must
 * leave it private. If this turns up `exported: true`, the pass is marking
 * incidental identifiers and inflating the ranker's `exportedSurface`.
 */
function internalOnly(): string {
  return 'private';
}

/** Exported under an alias — the local name is what reconciliation must find. */
function loadSummaryImpl(): string {
  return internalOnly();
}

export { loadSummaryImpl as loadSummary };
