import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Loading placeholder that occupies the shape of the thing being loaded.
 *
 * Pages used to hand-roll `<div className="py-20"><Loader2 …/></div>`, which
 * is a different height from the content it stands in for — so every graph tab
 * jumped once on load. Sizing comes from the caller (`className`), because only
 * the caller knows the shape.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  )
}

export { Skeleton }
