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
 * The destructive banner, with `role="alert"` wired in so the next caller cannot
 * drop it — the same reason `empty-state.tsx` exists.
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
