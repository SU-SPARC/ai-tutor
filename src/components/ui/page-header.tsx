import Link from "next/link"
import * as React from "react"

import { cn } from "@/lib/utils"

export type BreadcrumbItem = {
  label: string
  /** Omit on the last crumb (the current page). */
  href?: string
}

export type PageHeaderProps = {
  title: React.ReactNode
  /** Small line above the title (e.g. "Week 3"). Sentence case, no caps. */
  eyebrow?: React.ReactNode
  /** ONE sentence. No paragraph intros. */
  description?: React.ReactNode
  /** At most one primary and one secondary action. */
  actions?: React.ReactNode
  /** Trail above the title. The last crumb is the current page. */
  breadcrumb?: BreadcrumbItem[]
  /**
   * One quiet caption line under the description ("Demo data", a join code).
   * Text and inline nodes are wrapped in a <p>; a block element (p, div, ul,
   * dl …) is wrapped in a <div> so a paragraph never nests in a paragraph.
   */
  notice?: React.ReactNode
  /** Extra line under the description (chips, a meter). */
  children?: React.ReactNode
  /** Heading element; default h1. */
  headingLevel?: 1 | 2
  className?: string
}

/**
 * The header block every interior page shares: breadcrumb, serif h1 (type-h1),
 * one sentence, and up to two actions on the right (below on phones). Used by
 * every professor page (via ProfessorPageShell) and the student topic page.
 * The page leaves 32px below it.
 */
function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  breadcrumb,
  notice,
  children,
  headingLevel = 1,
  className,
}: PageHeaderProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2"

  return (
    <header
      data-slot="page-header"
      className={cn(
        "flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-8",
        className,
      )}
    >
      <div className="flex min-w-0 max-w-3xl flex-col gap-2">
        {breadcrumb && breadcrumb.length > 0 ? (
          <Breadcrumb items={breadcrumb} />
        ) : null}
        {eyebrow ? <p className="type-label">{eyebrow}</p> : null}
        <Heading className="type-h1 text-ink">{title}</Heading>
        {description ? (
          <p className="type-body max-w-prose text-ink-muted">{description}</p>
        ) : null}
        {notice ? <PageHeaderNotice>{notice}</PageHeaderNotice> : null}
        {children}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>
      ) : null}
    </header>
  )
}

const BLOCK_ELEMENTS = new Set([
  "div",
  "dl",
  "details",
  "form",
  "ol",
  "p",
  "section",
  "table",
  "ul",
])

function PageHeaderNotice({ children }: { children: React.ReactNode }) {
  const isBlock =
    React.isValidElement(children) &&
    typeof children.type === "string" &&
    BLOCK_ELEMENTS.has(children.type)
  return isBlock ? (
    <div className="type-caption">{children}</div>
  ) : (
    <p className="type-caption">{children}</p>
  )
}

function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 type-caption">
        {items.map((crumb, index) => {
          const isLast = index === items.length - 1
          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 ? (
                <span aria-hidden="true" className="text-ink-muted">
                  /
                </span>
              ) : null}
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  className="rounded-xs text-ink-muted underline-offset-4 transition-colors duration-fast hover:text-ink hover:underline focus-ring"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={isLast ? "text-ink" : "text-ink-muted"}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export { Breadcrumb, PageHeader }
