import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * What a list says when it has nothing in it: one sentence that names the
 * next step, plus at most one action. No illustration, no grey box.
 *
 * ```tsx
 * <EmptyState action={<Button asChild variant="secondary"><Link href="/learn">Browse topics</Link></Button>}>
 *   No saved practice yet. Start a topic and it will appear here.
 * </EmptyState>
 * ```
 */
function EmptyState({
  children,
  action,
  align = "start",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  /** The one sentence. */
  children: React.ReactNode
  action?: React.ReactNode
  align?: "start" | "center"
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col gap-3 py-6",
        align === "center" ? "items-center text-center" : "items-start",
        className,
      )}
      {...props}
    >
      <p className="type-body max-w-prose text-ink-muted">{children}</p>
      {action ? <div className="flex flex-wrap gap-3">{action}</div> : null}
    </div>
  )
}

export { EmptyState }
