import type { ReactNode, Ref } from "react"

import { cn } from "@/lib/utils"

export interface ErrorBannerProps {
  children: ReactNode
  /** Callers vary the margin and the text size; the colours are the point and stay fixed. */
  className?: string
  /** ProjectSettingsPage scrolls its banner into view after a failed save. */
  ref?: Ref<HTMLDivElement>
}

/**
 * The destructive banner, with `role="alert"` wired in.
 *
 * #74/G3 (#71): these six classes were pasted at 19 sites and only four of
 * them carried the role. A save that failed on button press painted red text
 * that a screen-reader user was never told about — the request came back, the
 * page looked answered, and nothing was announced. Centralised the same way
 * `empty-state.tsx` centralised the "nothing here" block, so the role cannot
 * be dropped by the next caller.
 */
export function ErrorBanner({ children, className, ref }: ErrorBannerProps) {
  return (
    <div
      ref={ref}
      role="alert"
      className={cn(
        "rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive",
        className,
      )}
    >
      {children}
    </div>
  )
}
