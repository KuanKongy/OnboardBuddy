import { MAIN_REGION_ID } from "@/hooks/usePageChrome";

/**
 * The first tabbable thing in every shell. Hidden until focused via `focus:` overrides
 * of every `sr-only` property rather than `not-sr-only`, because two focus-variant
 * utilities competing on `position` are resolved by Tailwind's internal ordering, not
 * the order written here. `[clip-path:none]` is load-bearing — Tailwind v4's `sr-only`
 * hides with `clip-path`, so the v3-style `clip` override emits nothing.
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
