import { MAIN_REGION_ID } from "@/hooks/usePageChrome";

/**
 * The first tabbable thing in every shell (#74/G1, #71 item 1).
 *
 * Both shells open with a ten-item sidebar, so reaching the page a keyboard
 * user actually navigated to cost ten-plus Tab presses on every single route —
 * and the sidebar is rebuilt on each one, so the cost was paid again every time.
 *
 * Hidden until focused, and `focus:` overrides every property `sr-only` sets
 * rather than using `not-sr-only`: both would be focus-variant utilities
 * competing on `position`, and which of two same-specificity utilities wins is
 * Tailwind's internal ordering, not the order written here. Against the base
 * `sr-only` the `:focus` variants win on specificity, which is decided by CSS.
 *
 * The clip-path override is not decoration: Tailwind v4's `sr-only` hides with
 * `clip-path: inset(50%)` where v3 used the older `clip` property, so undoing
 * `clip` — the pattern most skip-link snippets still carry — leaves the focused
 * link clipped to nothing. Verified against the built stylesheet: the v3-style
 * override emitted no matching rule at all, this one lands at a later offset
 * than `.sr-only` and outranks it on specificity.
 */
export function SkipToContent() {
  return (
    <a
      href={`#${MAIN_REGION_ID}`}
      className="sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:m-0 focus:h-auto focus:w-auto focus:overflow-visible focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-3 focus:py-1.5 focus:text-xs focus:font-medium focus:text-foreground focus:shadow-md focus:[clip-path:none]"
    >
      Skip to content
    </a>
  );
}
