/**
 * Process-global rate-limit gate: one open/closed window per provider id,
 * shared by every AiClient in the process.
 *
 * A 429 is a property of the API KEY, not of the call that happened to draw
 * it. WORKER_CONCURRENCY jobs run in one process against one
 * OPENROUTER_API_KEY, and inside a single job LLM_MAX_CONCURRENCY calls are
 * in flight at once — so a per-call backoff has every sibling walking straight
 * back into the same closed window while one call politely waits. The gate is
 * the shared piece: whoever sees the 429 trips it, and everybody stops
 * dispatching until it reopens.
 *
 * Accepted trade: a waiter parked here is not cancellable except through its
 * own signal, so a user pressing Stop mid-window is not noticed until the next
 * batch boundary (the kill switch is checked there) — up to ~60s at the
 * longest cooldown. Failing fast instead would hand the run a pause it could
 * have avoided by waiting, which is the outcome this whole gate exists to
 * prevent.
 *
 * Possible follow-up, out of scope here: if a live soak shows the window
 * reopening into an immediate second 429 (all 28 callers dispatching on the
 * same tick), the fix is a half-open ramp — release waiters a few at a time
 * rather than all at once.
 */

export interface RateLimitGate {
  /** Close the window for at least `cooldownMs`. Safe to call from every 429. */
  trip(cooldownMs: number, reason: string): void;
  /** Resolves when the window is open. Rejects if `signal` aborts first. */
  wait(signal?: AbortSignal): Promise<void>;
  remainingMs(): number;
}

interface GateHooks {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_HOOKS: GateHooks = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
};

// Read through on every call, never captured at gate construction, so a test
// that installs hooks also steers gates that already exist.
let hooks: GateHooks = DEFAULT_HOOKS;

const gates = new Map<string, RateLimitGate>();

/** The one gate for `providerId` in this process, created on first use. */
export function rateLimitGate(providerId: string): RateLimitGate {
  const existing = gates.get(providerId);
  if (existing) return existing;
  const gate = createGate(providerId);
  gates.set(providerId, gate);
  return gate;
}

function createGate(providerId: string): RateLimitGate {
  /** Absolute reading of the injected clock; 0 = never tripped. */
  let until = 0;

  return {
    trip(cooldownMs: number, reason: string): void {
      const target = hooks.now() + Math.max(0, cooldownMs);
      // Extend only. A late 429 answered from inside an already-closed window
      // must not shorten it, and the log below must not fire once per caller:
      // 28 concurrent calls all seeing the same 429 would otherwise write 28
      // identical lines.
      if (target <= until) return;
      until = target;
      // The one line that makes a stalled run read as "waiting on purpose"
      // rather than "hung" — there is no other output while the window is shut.
      console.warn(
        `[ai] rate limited (${reason}) — pausing all ${providerId} dispatch ~${Math.ceil(Math.max(0, cooldownMs) / 1000)}s`,
      );
    },

    remainingMs(): number {
      return Math.max(0, until - hooks.now());
    },

    async wait(signal?: AbortSignal): Promise<void> {
      for (;;) {
        if (signal?.aborted) throw abortReason(signal);
        // Recomputed every pass, never cached: a sibling that 429s mid-window
        // extends `until` while this waiter is already asleep, and the extension
        // has to be picked up here rather than on the next call's first attempt.
        const remaining = until - hooks.now();
        if (remaining <= 0) return;
        await sleepOrAbort(remaining, signal);
      }
    },
  };
}

/**
 * Sleeps `ms` but rejects the moment `signal` aborts — a hedged straggler's
 * loser must not sit out a 60s window for work its twin already delivered.
 * The listener is removed in `finally`: at 28-way fan-out with hedging, a
 * listener left on a long-lived signal per wait pass is a real leak.
 */
function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return hooks.sleep(ms);
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
  });
  // Listener first, sleep second: an abort delivered while the sleep is still
  // being set up would otherwise land on a signal nobody is listening to yet,
  // and the race would never settle.
  signal.addEventListener('abort', onAbort, { once: true });
  return Promise.race([hooks.sleep(ms), aborted]).finally(() => {
    signal.removeEventListener('abort', onAbort);
  });
}

/** Abort reasons are usually a DOMException; keep the thrown message readable. */
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('rate-limit wait aborted');
}

/** @internal Used by tests to drop the process-global registry between cases. */
export function __resetRateLimitGatesForTests(): void {
  gates.clear();
}

/** @internal Used by tests to run the gate on a fake clock (see lib/db.ts). */
export function __setRateLimitGateHooksForTests(
  overrides: { now?: () => number; sleep?: (ms: number) => Promise<void> } | null,
): void {
  hooks = overrides
    ? { now: overrides.now ?? DEFAULT_HOOKS.now, sleep: overrides.sleep ?? DEFAULT_HOOKS.sleep }
    : DEFAULT_HOOKS;
}
