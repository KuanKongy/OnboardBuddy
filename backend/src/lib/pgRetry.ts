/**
 * One-shot retry for Postgres statement timeouts (SQLSTATE 57014).
 *
 * Lives in lib/ rather than worker/semantic/ because the analysis side needs
 * it too: bug #76 was first seen on the semantic bulk writes, but the measured
 * six-way-concurrency failures of 2026-07-26 (CourseInsights, StudyFlow,
 * kuankongy.github.io) proved the same cancellation reaches every phase that
 * issues a wide write against the transaction-mode pooler.
 *
 * IMPORTANT — what may and may not be wrapped:
 *
 *  - Wrap a statement that runs in AUTOCOMMIT (via `query()` / the pool). A
 *    57014 cancels that statement and rolls its implicit transaction back, so
 *    nothing partial survives and repeating it lands on the same rows. That
 *    holds for upserts, DELETE-then-INSERT pairs, and plain multi-VALUES
 *    INSERTs alike.
 *
 *  - Wrap a WHOLE transaction (connect → BEGIN → … → COMMIT, with ROLLBACK on
 *    error) when the work spans several statements.
 *
 *  - NEVER wrap one statement that runs inside a caller's open transaction.
 *    After 57014 the transaction is in the aborted state and every further
 *    command fails with 25P02 ("current transaction is aborted"), so a
 *    per-statement retry there cannot succeed — it only converts one honest
 *    error into a confusing second one.
 *
 * And never blanket-wrap `query()`: a retry that fires on any error turns one
 * constraint violation into two and hides real failures behind doubled
 * latency. Only 57014 is retried, exactly once.
 */

/** Postgres SQLSTATE for "canceling statement due to statement timeout". */
export const STATEMENT_TIMEOUT_SQLSTATE = '57014';

/** Milliseconds before the single retry. Small on purpose: this is contention, not backpressure. */
const TIMEOUT_RETRY_DELAY_MS = 500;

export function isStatementTimeout(err: unknown): boolean {
  return typeof err === 'object' && err !== null
    && (err as { code?: unknown }).code === STATEMENT_TIMEOUT_SQLSTATE;
}

/**
 * Runs `run`, and on a statement timeout (and only then) runs it once more
 * after a short pause. Every other error propagates untouched on the first
 * attempt. `label` names the call site in the warning so a repeat failure is
 * attributable without a stack trace.
 */
export async function withStatementTimeoutRetry<T>(label: string, run: () => Promise<T>): Promise<T> {
  const attempts = 2;
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!isStatementTimeout(err) || attempt >= attempts) throw err;
      console.warn(
        `[pgRetry] statement timeout (57014) on ${label}, attempt ${attempt}/${attempts} — retrying in ${TIMEOUT_RETRY_DELAY_MS}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, TIMEOUT_RETRY_DELAY_MS));
    }
  }
}
