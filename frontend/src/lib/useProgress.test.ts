import { act, renderHook } from "@testing-library/react";
import { apiFetch } from "@/lib/api";
import { useProgress } from "./useProgress";

/**
 * The debounce is the whole point of this hook and it is invisible: a lost PUT
 * looks exactly like a section the member never marked, so nothing on screen
 * ever reports it. These three cases are the ones no reviewer can catch by eye.
 */
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

const mockFetch = vi.mocked(apiFetch);
const puts = () => mockFetch.mock.calls.filter(([, init]) => init?.method === "PUT");

beforeEach(() => {
  vi.useFakeTimers();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ items: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

// The mount GET resolves on a microtask, which fake timers do not pump.
async function mountedHook() {
  const view = renderHook(() => useProgress("p1"));
  await act(async () => {});
  return view;
}

describe("useProgress save()", () => {
  it("collapses rapid saves into one PUT carrying the latest payload", async () => {
    const { result } = await mountedHook();

    act(() => {
      result.current.save("onboarding", "pkg-1", { readSections: ["a"] });
      result.current.save("onboarding", "pkg-1", { readSections: ["a", "b"] });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(puts()).toHaveLength(1);
    expect(JSON.parse(puts()[0]![1]!.body as string)).toEqual({
      kind: "onboarding",
      ref_id: "pkg-1",
      position: { readSections: ["a", "b"] },
    });
  });

  it("flushes a pending save on unmount instead of dropping it", async () => {
    const { result, unmount } = await mountedHook();

    act(() => { result.current.save("onboarding", "pkg-1", { readSections: ["a"] }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(puts()).toHaveLength(0);

    // Navigating away mid-debounce is the common case (mark a section, click
    // the next one): the write must go out, exactly once.
    act(() => { unmount(); });
    expect(puts()).toHaveLength(1);
    expect(puts()[0]![0]).toBe("/projects/p1/progress");

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(puts()).toHaveLength(1);
  });

  it("writes nothing on unmount when no save is pending", async () => {
    const { unmount } = await mountedHook();

    act(() => { unmount(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(puts()).toHaveLength(0);
  });
});
