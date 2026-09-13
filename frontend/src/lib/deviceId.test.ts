import { deviceFpSource, getDeviceFp, getDeviceId, __resetDeviceIdCaches } from "./deviceId";

/**
 * These identifiers ride on EVERY api call, so the bar is not "computes a hash"
 * but "cannot break a request": a blocked storage API, a throwing signal getter,
 * or a browser with no SubtleCrypto must all degrade quietly. A throw here would
 * take out every fetch in the app at once, which is exactly the failure no page
 * would survive and no reviewer would see in a passing unit test elsewhere.
 */
const KEY = "onboardbuddy.device.id";

beforeEach(() => {
  __resetDeviceIdCaches();
  localStorage.clear();
});

describe("getDeviceId", () => {
  it("creates one id, persists it, and returns the same value on later calls", () => {
    const first = getDeviceId();
    expect(first).toMatch(/^[A-Za-z0-9._:-]{8,64}$/);
    expect(localStorage.getItem(KEY)).toBe(first);
    expect(getDeviceId()).toBe(first);

    // A fresh module (a new page load) reads the stored value rather than minting
    // a second id, which is the whole point of persisting it.
    __resetDeviceIdCaches();
    expect(getDeviceId()).toBe(first);
  });

  it("replaces a junk stored value instead of sending one the server will ignore", () => {
    localStorage.setItem(KEY, "nope");
    const id = getDeviceId();
    expect(id).not.toBe("nope");
    expect(id).toMatch(/^[A-Za-z0-9._:-]{8,64}$/);
  });

  it("still returns a stable id for the session when storage throws", () => {
    const proto = Object.getPrototypeOf(localStorage);
    const getItem = vi.spyOn(proto, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage is blocked");
    });
    const setItem = vi.spyOn(proto, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      const first = getDeviceId();
      expect(first).toMatch(/^[A-Za-z0-9._:-]{8,64}$/);
      // Same value within the page, from the in-memory fallback.
      expect(getDeviceId()).toBe(first);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

describe("getDeviceFp", () => {
  it("keeps the serialization positional when a signal getter throws", () => {
    const baseline = deviceFpSource().split("|").length;
    const spy = vi.spyOn(navigator, "userAgent", "get").mockImplementation(() => {
      throw new Error("blocked by a privacy extension");
    });
    try {
      const source = deviceFpSource();
      // Degraded to a placeholder in place, not dropped: a missing field would
      // shift every later signal into the wrong slot.
      expect(source.split("|")).toHaveLength(baseline);
      expect(source.split("|")[0]).toBe("?");
    } finally {
      spy.mockRestore();
    }
  });

  it("returns a stable hex digest, or null where SubtleCrypto is absent", async () => {
    const first = await getDeviceFp();
    if (first === null) {
      // jsdom on a non-secure origin has no crypto.subtle. null is a supported
      // answer and api.ts omits the header; assert that rather than skipping, so
      // this case is recorded as covered.
      expect(await getDeviceFp()).toBeNull();
      return;
    }
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await getDeviceFp()).toBe(first);
  });

  it("hashes with SubtleCrypto when the environment provides one", async () => {
    // Polyfilled from node so the hashing path is exercised even when jsdom
    // gives the suite no crypto.subtle of its own.
    const { webcrypto } = await import("node:crypto");
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
    __resetDeviceIdCaches();
    try {
      const fp = await getDeviceFp();
      expect(fp).toMatch(/^[0-9a-f]{64}$/);
      // Same browser, same digest: the detector relies on that to recognise a
      // returning device at all.
      __resetDeviceIdCaches();
      expect(await getDeviceFp()).toBe(fp);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });
});
