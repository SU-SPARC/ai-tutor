import * as React from "react"

import { cn } from "@/lib/utils"

export type MasteryLevel = 0 | 1 | 2 | 3 | 4

/** The five named levels. The name is always shown or spoken. */
export const MASTERY_LEVEL_NAMES: Record<MasteryLevel, string> = {
  0: "Not started",
  1: "Attempted",
  2: "Familiar",
  3: "Proficient",
  4: "Mastered",
}

const FILL: Record<MasteryLevel, string> = {
  0: "border border-input bg-transparent",
  1: "bg-mastery-1",
  2: "bg-mastery-2",
  3: "bg-mastery-3",
  4: "bg-mastery-4",
}

const CHIP: Record<MasteryLevel, string> = {
  0: "border border-input bg-transparent text-mastery-0-foreground",
  1: "bg-mastery-1 text-mastery-1-foreground",
  2: "bg-mastery-2 text-mastery-2-foreground",
  3: "bg-mastery-3 text-mastery-3-foreground",
  4: "bg-mastery-4 text-mastery-4-foreground",
}

function clampLevel(level: number): MasteryLevel {
  return Math.min(4, Math.max(0, Math.round(level))) as MasteryLevel
}

/**
 * The topic's mastery level as a named chip (Not started … Mastered), filled
 * from the logo-gradient ramp. Distinct from correct-green on purpose.
 */
function MasteryChip({
  level,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & { level: number }) {
  const safe = clampLevel(level)
  return (
    <span
      data-slot="mastery-chip"
      data-level={safe}
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center rounded-chip px-2 chip-text whitespace-nowrap",
        CHIP[safe],
        className,
      )}
      {...props}
    >
      {MASTERY_LEVEL_NAMES[safe]}
    </span>
  )
}

/**
 * A 12px square pip for rails and dense rows. It carries the level name as
 * its accessible label; pass `decorative` when the name is printed beside it.
 */
function MasteryPip({
  level,
  decorative = false,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  level: number
  decorative?: boolean
}) {
  const safe = clampLevel(level)
  return (
    <span
      data-slot="mastery-pip"
      data-level={safe}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : MASTERY_LEVEL_NAMES[safe]}
      aria-hidden={decorative ? true : undefined}
      title={decorative ? undefined : MASTERY_LEVEL_NAMES[safe]}
      className={cn("inline-block size-3 shrink-0 rounded-xs", FILL[safe], className)}
      {...props}
    />
  )
}

/**
 * A thin progress bar for "value of total" (solved of available). Pair it
 * with the fraction in text ("3 of 8"); the bar is never the only signal.
 */
function MasteryBar({
  value,
  total,
  label,
  className,
}: {
  value: number
  total: number
  /** Accessible name; defaults to "{value} of {total}". */
  label?: string
  className?: string
}) {
  const safeTotal = total > 0 ? total : 0
  const safeValue = Math.min(Math.max(0, value), safeTotal)
  const percent = safeTotal === 0 ? 0 : (safeValue / safeTotal) * 100

  return (
    <div
      data-slot="mastery-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeTotal}
      aria-valuenow={safeValue}
      aria-label={label ?? `${safeValue} of ${safeTotal}`}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-rule", className)}
    >
      <div
        className="brand-gradient-fill h-full rounded-full"
        style={{
          width: `${percent}%`,
          // Stretch the gradient across the whole track so a short bar shows
          // only the azure end and a full bar reaches mint.
          backgroundSize: percent > 0 ? `${10000 / percent}% 100%` : undefined,
        }}
      />
    </div>
  )
}

export { MasteryBar, MasteryChip, MasteryPip }
