"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

/**
 * Neutralise Radix's popper wrapper (bug #84).
 *
 * `TooltipPrimitive.Content` renders *inside* `[data-radix-popper-content-wrapper]`
 * — an un-classed `position: fixed; z-index: 50` div that Radix owns and that
 * keeps `pointer-events: auto`. Styling only the content therefore leaves an
 * invisible, click-absorbing box exactly where the tooltip appears: over the
 * Dependencies view toggle, the first press hit the wrapper and only dismissed
 * the tooltip. There is no way to pass a class to that element, so it is set
 * here, from the content's own ref.
 *
 * `styles.css` carries the equivalent `:has()` rule. Both are kept on purpose:
 * the stylesheet covers content Radix re-parents without remounting, and this
 * covers the case where `:has()` does not apply — and, unlike a CSS rule, it
 * is observable from a test.
 */
function neutralizePopperWrapper(node: HTMLElement | null) {
  const wrapper = node?.parentElement;
  if (wrapper?.hasAttribute("data-radix-popper-content-wrapper")) {
    wrapper.style.pointerEvents = "none";
  }
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ref,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const setContentRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      neutralizePopperWrapper(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        ref={setContentRef}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
