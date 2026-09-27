import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * One number with its plain label, for the analytics metric row. No icons, no
 * sparkline, no colour-coded delta. Values are mono and tabular so a row of
 * tiles lines up. Render real counts only; use "—" when there is no data.
 */
function MetricTile({
  label,
  value,
  delta,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  /** 13px ink-muted, sentence case: "Answer attempts". */
  label: React.ReactNode
  /** The number, already formatted (Intl.NumberFormat) or "—". */
  value: React.ReactNode
  /** Optional context line: "12 this week", "of 61 students". */
  delta?: React.ReactNode
}) {
  return (
    <div
      data-slot="metric-tile"
      className={cn("flex flex-col gap-1 rounded-panel bg-sheet p-4", className)}
      {...props}
    >
      <p className="type-label">{label}</p>
      <p className="type-metric text-ink">{value}</p>
      {delta ? <p className="type-caption">{delta}</p> : null}
    </div>
  )
}

export { MetricTile }
