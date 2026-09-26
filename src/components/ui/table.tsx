import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Dense data table for professor screens: 40px rows, 13px ink-muted headers
 * in sentence case, hairline rules, surface-tint hover, azure-100 selection
 * (set `data-state="selected"` or `aria-selected` on the row).
 *
 * `stickyHeader`: the header sticks while the table body scrolls. Because the
 * table sits in a horizontal scroll container, stickiness is relative to that
 * container, so give it a height with `containerClassName` (e.g. "max-h-[70svh]").
 *
 * Numeric columns: pass `numeric` to `TableHead` and `TableCell` (right
 * aligned, mono, tabular).
 */
function Table({
  className,
  containerClassName,
  stickyHeader = false,
  ...props
}: React.ComponentProps<"table"> & {
  containerClassName?: string
  stickyHeader?: boolean
}) {
  return (
    <div
      data-slot="table-container"
      data-sticky-header={stickyHeader ? "true" : undefined}
      className={cn(
        "relative w-full overflow-x-auto",
        stickyHeader && "overflow-y-auto",
        containerClassName,
      )}
    >
      <table
        data-slot="table"
        className={cn(
          "w-full caption-bottom border-collapse text-sm",
          stickyHeader &&
            "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-surface",
          className,
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:border-rule [&_tr:hover]:bg-transparent", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "h-10 border-b border-rule transition-colors duration-fast hover:bg-surface-tint",
        "data-[state=selected]:bg-azure-100 aria-selected:bg-azure-100",
        className,
      )}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t border-rule bg-surface-tint font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  )
}

function TableHead({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-3 text-left align-middle type-label whitespace-nowrap",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  )
}

function TableCell({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3 py-2 align-middle text-sm text-ink",
        numeric && "text-right font-mono tabular",
        className,
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 type-caption", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
}
