"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

/**
 * Radix supplies the `progressbar` role and aria-value* attributes, so callers
 * only pass `value` and `max`.
 *
 * The indicator is sized with `width` rather than the usual `translateX` so
 * that `minPercent` can keep a small-but-nonzero value visible.
 */
function Progress({
  className,
  indicatorClassName,
  value,
  max = 100,
  minPercent = 0,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  indicatorClassName?: string
  minPercent?: number
}) {
  const safeMax = max > 0 ? max : 1
  const ratio = ((value ?? 0) / safeMax) * 100
  const percent = Math.min(100, Math.max(minPercent, ratio))

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
      value={value}
      max={max}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full rounded-full bg-primary transition-[width] duration-300",
          indicatorClassName,
        )}
        style={{ width: `${percent}%` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
