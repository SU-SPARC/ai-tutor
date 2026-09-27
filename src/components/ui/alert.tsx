import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * An inline notice: a 2px tone-coloured left rule, no filled card. Keep it to
 * one or two sentences that say what happened and what to do next.
 * `destructive` is announced assertively (`role="alert"`); the rest are polite
 * (`role="status"`). Override `role` for static text that should not be
 * announced at all (`role={undefined}` is not enough; pass `role="note"`).
 */
const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 border-l-2 py-1 pr-2 pl-4 text-base has-[>svg]:grid-cols-[calc(--spacing(4))_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-1",
  {
    variants: {
      variant: {
        default: "border-input text-ink [&>svg]:text-ink-muted",
        info: "border-azure-500 text-ink [&>svg]:text-azure-500",
        success: "border-green-500 text-ink [&>svg]:text-green-500",
        warning: "border-amber-500 text-ink [&>svg]:text-amber-500",
        destructive: "border-red-500 text-ink [&>svg]:text-red-500",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Alert({
  className,
  variant,
  role,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={role ?? (variant === "destructive" ? "alert" : "status")}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 font-medium text-ink", className)}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 grid max-w-prose justify-items-start gap-1 text-base text-ink-muted",
        className,
      )}
      {...props}
    />
  )
}

export { Alert, AlertDescription, AlertTitle, alertVariants }
