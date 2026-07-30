/**
 * The OS "reduce motion" setting, for the motion CSS cannot reach.
 *
 * #74/G5 (#71 item 5): the base rule in `styles.css` flattens every CSS
 * animation and transition, but two kinds of motion escape it. A
 * `scrollIntoView({ behavior: "smooth" })` wins over the CSS
 * `scroll-behavior` property by specification — an explicit behavior is only
 * deferred to the stylesheet when it is `"auto"` — so the five smooth scrolls
 * in this app would keep gliding. And React Flow's `animated` edges draw a
 * marching-dashes CSS animation from a data flag, which the reset silences to a
 * 0.01ms loop but leaves as a permanently dashed edge rather than a plain one.
 *
 * Read at call time rather than cached in a hook: someone who turns the setting
 * on mid-session gets it on the next scroll instead of on the next reload, and
 * these are not hot paths.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** For `scrollIntoView`/`scrollTo` options — jump instead of glide when asked. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
