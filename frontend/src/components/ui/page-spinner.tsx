import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

export interface PageSpinnerProps {
  /** Announced, never drawn — say what is loading, not "loading". */
  label?: string
  /** Positioning for the wrapper: the caller's padding, height, or overlay classes. */
  className?: string
  /** Size and colour of the glyph; merged over `h-5 w-5 text-primary`. */
  iconClassName?: string
}

/**
 * A page- or section-level wait that says so out loud.
 *
 * #74/G4 (#71): ~15 loads rendered a bare spinning `Loader2` in a centred div.
 * The spin is the only signal and it carries no text, so to a screen reader
 * the region is simply empty for as long as the fetch takes — indistinguishable
 * from a load that finished with nothing in it. `role="status"` plus an sr-only
 * label announces the wait without changing a pixel; the glyph is `aria-hidden`
 * so the label is the only thing read.
 *
 * Not for buttons: an in-flight button already has its own visible text.
 */
export function PageSpinner({ label = "Loading…", className, iconClassName }: PageSpinnerProps) {
  return (
    <div role="status" className={cn("flex items-center justify-center", className)}>
      <Loader2 className={cn("h-5 w-5 animate-spin text-primary", iconClassName)} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  )
}
