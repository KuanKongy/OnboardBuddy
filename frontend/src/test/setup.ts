import "@testing-library/jest-dom/vitest";

// React Flow (used by GraphPage) relies on ResizeObserver, which jsdom doesn't implement.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// Tests run as if the user asked for reduced motion, so drill transitions
// resolve instantly instead of waiting out ~850ms of real timers per
// navigation. The phase sequence is identical either way (see useGraphDrill),
// so this changes timing only — never behaviour. Every other media query keeps
// jsdom's `matches: false`, so this does not silently flip tests into dark mode.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});
