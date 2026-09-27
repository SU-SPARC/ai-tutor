import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Full-page status (not found, error, access denied, sign-in unavailable): a
 * single sheet centred on the desk. Say what happened in the title, why and
 * what to do next in one or two sentences, then the next step as actions.
 *
 * Renders its own `<main id="main-content">` unless `asMain={false}` (use that
 * when it sits inside `ThreeColumn`, which already renders the main landmark).
 */
function StatusPage({
  title,
  description,
  actions,
  code,
  children,
  asMain = true,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  /** A small mono line above the title, e.g. "404" or "Access denied". */
  code?: React.ReactNode
  /** Extra content under the description (a list, a link). */
  children?: React.ReactNode
  asMain?: boolean
  className?: string
}) {
  const Wrapper = asMain ? "main" : "div"
  // `outline-none` on the landmark: it receives focus only from the skip
  // link, and a landmark is not a control.
  return (
    <Wrapper
      id={asMain ? "main-content" : undefined}
      tabIndex={asMain ? -1 : undefined}
      data-slot="status-page"
      className={cn(
        "flex min-h-[calc(100svh-var(--header-h))] w-full items-start justify-center bg-surface px-4 py-12 outline-none sm:items-center sm:py-16",
        className,
      )}
    >
      <section className="sheet-shadow flex w-full max-w-lg flex-col gap-4 rounded-panel bg-sheet p-6 sm:p-8">
        {code ? <p className="type-mono text-ink-muted">{code}</p> : null}
        <h1 className="type-h1 text-ink">{title}</h1>
        {description ? (
          <div className="type-body max-w-prose text-ink-muted [&_p+p]:mt-2">{description}</div>
        ) : null}
        {children}
        {actions ? <div className="mt-2 flex flex-wrap gap-3">{actions}</div> : null}
      </section>
    </Wrapper>
  )
}

export { StatusPage }
