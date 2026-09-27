"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

/**
 * A progress bar: brand-gradient fill on a `--rule` track. Radix supplies the
 * `progressbar` role and aria-value*; give it an `aria-label` and show the
 * fraction in text beside it.
 *
 * The indicator is sized with `width` (not translateX) so `minPercent` can
 * keep a small non-zero value visible, and the gradient is stretched over the
 * full track so the colour at the tip reflects how far along it is.
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
        "relative h-1.5 w-full overflow-hidden rounded-full bg-rule",
        className,
      )}
      value={value}
      max={max}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "brand-gradient-fill h-full rounded-full transition-[width] duration-base ease-out",
          indicatorClassName,
        )}
        style={{
          width: `${percent}%`,
          backgroundSize: percent > 0 ? `${10000 / percent}% 100%` : undefined,
        }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
