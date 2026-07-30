import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // No `disabled:pointer-events-none` — it makes `cursor-not-allowed` unreachable.
  // Safe to drop only because every disabled Button here renders a real <button>,
  // and no `asChild` call site passes `disabled`. Hover is reachable in exchange,
  // hence `not-disabled:` on every hover fill.
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // A muted fill rather than a fade: fading as well drops the label to
        // 2.12:1 dark / 1.75:1 light, so this variant opts out of the base opacity
        // (tailwind-merge keeps the later value).
        default:
          "bg-primary text-primary-foreground not-disabled:hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100",
        destructive:
          "bg-destructive text-white not-disabled:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs not-disabled:hover:bg-accent not-disabled:hover:text-accent-foreground dark:border-input dark:bg-input-fill/30 dark:not-disabled:hover:bg-input-fill/50",
        secondary:
          "bg-secondary text-secondary-foreground not-disabled:hover:bg-secondary/80",
        ghost:
          "not-disabled:hover:bg-accent not-disabled:hover:text-accent-foreground dark:not-disabled:hover:bg-accent/50",
        link: "text-primary underline-offset-4 not-disabled:hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
