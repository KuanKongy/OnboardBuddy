import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type EmptyStateTone = "warning" | "muted"

const TONE_CLASSES: Record<EmptyStateTone, string> = {
  warning: "border-warning/40 bg-warning-soft",
  muted: "border-border bg-card",
}

export interface EmptyStateProps {
  /** Rendered as-is, so the caller keeps control of size and colour. */
  icon?: ReactNode
  /** Named `heading`, not `title`: a DOM `title` here would be a tooltip. */
  heading: ReactNode
  description?: ReactNode
  /** Buttons or links; laid out on the trailing edge. */
  actions?: ReactNode
  tone?: EmptyStateTone
  className?: string
}

/**
 * "Nothing here, and here is why" — the one block the four graph tabs each
 * carried their own copy of (identical classes, drifting copy).
 *
 * `role="status"` so the reason is announced rather than only drawn: an empty
 * level and a failed fetch look the same to a screen reader otherwise.
 */
export function EmptyState({
  icon,
  heading,
  description,
  actions,
  tone = "warning",
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn("flex items-center gap-3 rounded-lg border px-4 py-3", TONE_CLASSES[tone], className)}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{heading}</p>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
