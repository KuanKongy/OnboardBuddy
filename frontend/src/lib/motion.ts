/**
 * The OS "reduce motion" setting, for the motion CSS cannot reach: an explicit
 * `scrollIntoView({ behavior: "smooth" })` outranks the stylesheet by spec, and React
 * Flow's `animated` edges draw their dashes from a data flag. Read at call time rather
 * than cached, so turning the setting on mid-session takes effect on the next scroll.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** For `scrollIntoView`/`scrollTo` options — jump instead of glide when asked. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
