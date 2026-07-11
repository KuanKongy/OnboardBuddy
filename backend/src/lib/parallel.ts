/**
 * Bounded-concurrency map. Results keep input order. On the first error no
 * new tasks start; in-flight tasks settle, then the first error is thrown.
 * The LLM provider has its own semaphore (LLM_MAX_CONCURRENCY), so callers
 * here bound DB/orchestration fan-out, not provider pressure.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let firstError: unknown = null;

  async function runWorker(): Promise<void> {
    for (;;) {
      if (firstError !== null) return;
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index]!, index);
      } catch (err) {
        if (firstError === null) firstError = err;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runWorker));
  if (firstError !== null) throw firstError;
  return results;
}
