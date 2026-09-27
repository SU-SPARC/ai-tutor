"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

/**
 * A short label for an icon-only control (150ms delay; later tooltips in the
 * same group open instantly). It never holds information that is not also
 * reachable another way: the trigger still needs its own `aria-label`.
 *
 * `Tooltip` includes its own provider, so no app-level setup is needed.
 */
function Tooltip({
  delayDuration = 150,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={300}>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipPrimitive.Provider>
  )
}

const TooltipTrigger = TooltipPrimitive.Trigger

function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-xs rounded-control bg-ink px-2.5 py-1.5 text-sm text-surface",
          "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-fast",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}

/** Convenience: `<SimpleTooltip label="Collapse rail"><Button …/></SimpleTooltip>`. */
function SimpleTooltip({
  label,
  side = "top",
  children,
}: {
  label: React.ReactNode
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"]
  children: React.ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}

export { SimpleTooltip, Tooltip, TooltipContent, TooltipTrigger }
