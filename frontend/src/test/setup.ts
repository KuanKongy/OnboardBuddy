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

// jsdom does not implement window.scrollTo; it logs a "Not implemented" error
// (via its virtual console) whenever code calls it, e.g. the scroll-to-top on
// route change in usePageChrome. Stub it to a no-op so that runner noise, and
// any chance of it escalating the run, is gone. Scroll behavior is not under
// test here.
window.scrollTo = (() => {}) as typeof window.scrollTo;
