"use client"

import * as React from "react"
import Link from "next/link"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

type TabsVariant = "underline" | "segmented"

const TabsVariantContext = React.createContext<TabsVariant>("underline")

/**
 * Radix tabs (arrow keys move, Home/End jump, `aria-selected` wired).
 * - `underline` (default): page-level tabs, e.g. Bank · Intake, the review
 *   queue's status tabs. A 2px azure bar marks the active tab.
 * - `segmented`: a small filter group inside a toolbar.
 *
 * If the active tab should survive a reload or be shareable, drive `value`
 * from the URL (search param) in the page.
 */
function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  variant = "underline",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: TabsVariant }) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(
          variant === "underline"
            ? "flex w-full items-end gap-6 overflow-x-auto border-b border-rule"
            : "inline-flex w-fit items-center gap-0.5 rounded-control bg-surface-tint p-0.5",
          className,
        )}
        {...props}
      />
    </TabsVariantContext.Provider>
  )
}

function TabsTrigger({
  className,
  count,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & {
  /** A count shown after the label in mono ("Needs review 264"). */
  count?: number
}) {
  const variant = React.useContext(TabsVariantContext)

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex shrink-0 items-center gap-2 font-medium whitespace-nowrap text-ink-muted transition-colors duration-fast ease-out focus-ring hover:text-ink disabled:pointer-events-none disabled:opacity-50",
        variant === "underline"
          ? "relative -mb-px h-11 border-b-2 border-transparent px-0.5 text-base data-[state=active]:border-azure-500 data-[state=active]:text-ink"
          : "h-8 rounded-xs px-3 text-sm data-[state=active]:bg-sheet data-[state=active]:text-ink pointer-coarse:h-10",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined ? (
        <span className="font-mono text-sm tabular text-ink-muted">{count}</span>
      ) : null}
    </TabsPrimitive.Trigger>
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring", className)}
      {...props}
    />
  )
}

/**
 * Underline tabs whose items are links: each view is its own URL (a search
 * param or a route), so they are a `<nav>` list with `aria-current="page"`
 * on the active one, not a Radix tablist. Same look as `TabsList
 * variant="underline"`.
 *
 * ```tsx
 * <LinkTabs label="Section views">
 *   <LinkTab href="?tab=progress" current>Progress</LinkTab>
 *   <LinkTab href="?tab=settings">Settings</LinkTab>
 * </LinkTabs>
 * ```
 */
function LinkTabs({
  label,
  className,
  children,
}: {
  /** The nav landmark's name ("Section views"). */
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <nav aria-label={label} data-slot="link-tabs" className={className}>
      <ul className="flex w-full items-end gap-6 overflow-x-auto border-b border-rule">
        {children}
      </ul>
    </nav>
  )
}

function LinkTab({
  current = false,
  count,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Link> & {
  /** The view on screen; sets `aria-current="page"`. */
  current?: boolean
  /** A count shown after the label in mono. */
  count?: number
}) {
  return (
    <li>
      <Link
        data-slot="link-tab"
        aria-current={current ? "page" : undefined}
        className={cn(
          "type-body-strong relative -mb-px inline-flex h-11 items-center gap-1.5 border-b-2 px-0.5 whitespace-nowrap transition-colors duration-fast ease-out focus-ring",
          current
            ? "border-azure-500 text-ink"
            : "border-transparent text-ink-muted hover:text-ink",
          className,
        )}
        {...props}
      >
        {children}
        {count !== undefined ? (
          <span className="type-small font-mono tabular text-ink-muted">{count}</span>
        ) : null}
      </Link>
    </li>
  )
}

export { LinkTab, LinkTabs, Tabs, TabsContent, TabsList, TabsTrigger }
export type { TabsVariant }
