import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A panel. Tint-layered: the sheet surface on the desk, no border, no shadow
 * (only the Sheet gets a shadow). Put a `Card` on `bg-surface`; inside a
 * sheet, group with `bg-surface-tint` instead of nesting cards.
 *
 * Padding lives on Header/Content/Footer, matching existing consumers.
 * `CardTitle` renders a `<div>` by default for compatibility; pass
 * `as="h2"`/`"h3"` so panel titles are real headings in the outline.
 */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("rounded-panel bg-sheet text-ink", className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 p-5 sm:p-6", className)}
      {...props}
    />
  )
}

type CardTitleProps = React.ComponentProps<"div"> & {
  as?: "div" | "h2" | "h3" | "h4"
}

function CardTitle({ className, as: Comp = "div", ...props }: CardTitleProps) {
  return (
    <Comp
      data-slot="card-title"
      className={cn("type-h3 text-ink", className)}
      {...(props as React.ComponentProps<"div">)}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("type-small max-w-prose text-ink-muted", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-5 pb-5 sm:px-6 sm:pb-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-5 pb-5 sm:px-6 sm:pb-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
}
