/**
 * Numeric env knobs (concurrency caps, pool sizes) with a documented default.
 *
 * The pattern everywhere used to be `Number(process.env.X ?? default)`, which
 * turns a typo or an empty value into `NaN` — and BullMQ rejects a NaN
 * concurrency at construction ("concurrency must be a finite number greater
 * than 0"), so one bad env line kills the worker at boot instead of falling
 * back. Anything that is not a positive integer resolves to `fallback`.
 */
export function envInt(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
