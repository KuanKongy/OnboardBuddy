/**
 * Per-browser identifiers sent with every API request so the backend can spot
 * one device farming free accounts (backend/src/api/services/signals.ts).
 *
 * Two different things, on purpose:
 *   - getDeviceId(): a random UUID this browser stores and reuses. It identifies
 *     the INSTALL, not the person, and it is the only value the backend lets
 *     influence a decision. Clearing site data gets a new one, which is fine:
 *     the detector needs a repeat visitor to see a pattern at all, and anything
 *     harder to clear would be fingerprinting users who never agreed to it.
 *   - getDeviceFp(): a hash over passive browser properties, recorded as
 *     evidence only. The backend never gates on it because near-identical
 *     laptops on one campus produce near-identical values.
 *
 * Nothing here may ever throw. A blocked storage API or a missing crypto
 * primitive has to degrade to "no signal" - a sent request with one fewer
 * header beats a page that cannot call the API at all.
 */
const DEVICE_ID_KEY = "onboardbuddy.device.id";

/**
 * Session fallback for when localStorage is unavailable (Safari private mode
 * throws on setItem, embedded webviews can block it outright). The id then lives
 * only as long as the page, which is honest: we could not persist it.
 */
let memoryDeviceId: string | null = null;

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage is full, blocked, or partitioned. memoryDeviceId carries the
    // value for this page instead.
  }
}

function newUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the manual form below.
  }
  // Not cryptographically strong, and it does not need to be: a collision costs
  // the detector one muddled data point, never a wrong answer about a user.
  const rand = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${rand()}${rand()}-${rand()}-${rand()}-${rand()}-${rand()}${rand()}${rand()}`;
}

/** The stable id for this browser, creating and persisting one on first call. */
export function getDeviceId(): string {
  const stored = readStored(DEVICE_ID_KEY);
  // Shape-checked on the way out, not just on the way in: a half-written or
  // hand-edited value would be dropped by the server's validation anyway, so
  // replace it rather than send a header that is silently ignored.
  if (stored && /^[A-Za-z0-9._:-]{8,64}$/.test(stored)) return stored;
  if (memoryDeviceId) return memoryDeviceId;
  const fresh = newUuid();
  memoryDeviceId = fresh;
  writeStored(DEVICE_ID_KEY, fresh);
  return fresh;
}

/**
 * Every signal is read through this so one blocked or exotic getter cannot take
 * the whole fingerprint down with it. A failed read becomes "?", which keeps the
 * serialization positional: the same browser still hashes to the same value.
 */
function probe(read: () => unknown): string {
  try {
    const value = read();
    if (value === undefined || value === null || value === "") return "?";
    return String(value);
  } catch {
    return "?";
  }
}

/** The exact string that gets hashed. Exported so a test can pin its shape. */
export function deviceFpSource(): string {
  return [
    probe(() => navigator.userAgent),
    probe(() => (navigator as Navigator & { platform?: string }).platform),
    probe(() => screen.width),
    probe(() => screen.height),
    probe(() => screen.colorDepth),
    probe(() => (navigator.languages ?? []).join(",")),
    probe(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    probe(() => navigator.hardwareConcurrency),
  ].join("|");
}

/**
 * Cached as a PROMISE, not a value: the hash is async and several requests can
 * ask for it before the first one resolves, and they must all get the same
 * in-flight work rather than each starting their own.
 */
let fpPromise: Promise<string | null> | null = null;

/**
 * Hex SHA-256 of the passive signals, or null when the browser has no
 * SubtleCrypto (every non-secure origin, and jsdom by default). null is a
 * supported answer: api.ts simply omits the header, and the backend treats the
 * fingerprint as optional evidence.
 */
export function getDeviceFp(): Promise<string | null> {
  if (fpPromise) return fpPromise;
  fpPromise = (async () => {
    try {
      const subtle = globalThis.crypto?.subtle;
      if (!subtle) return null;
      const bytes = new TextEncoder().encode(deviceFpSource());
      const digest = await subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      return null;
    }
  })();
  return fpPromise;
}

/** @internal Test seam: drops the cached fingerprint and in-memory id. */
export function __resetDeviceIdCaches(): void {
  fpPromise = null;
  memoryDeviceId = null;
}
