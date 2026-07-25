// Theme + font-size bootstrap, applied before first paint so a stored
// preference never flashes at the default.
//
// This lives in an external file rather than an inline <script> so the
// Content-Security-Policy can be a flat `script-src 'self'` with no
// 'unsafe-inline' and no per-build hash to keep in sync
// (doc/SECURITY_XSS_PROMPT_INJECTION.md §5.1). It is loaded synchronously in
// <head>, so it still runs before the first paint.
(function () {
  try {
    var stored = localStorage.getItem("onboardbuddy:theme");
    var dark =
      stored === "dark" ||
      (stored !== "light" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) {
      document.documentElement.classList.add("dark");
    }
  } catch (e) {
    document.documentElement.classList.add("dark");
  }
})();

(function () {
  try {
    var size = localStorage.getItem("onboardbuddy:font-size");
    var pct = size === "large" ? "112.5%" : size === "xlarge" ? "125%" : "100%";
    document.documentElement.style.fontSize = pct;
  } catch (e) {
    // Best-effort only; default 100% applies.
  }
})();
