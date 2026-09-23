import Link from "next/link";
import type { ReactNode } from "react";

import { ProfessorSectionNav } from "@/components/professor/professor-section-nav";
import { ProfessorRail } from "@/components/shell/app-rail";
import { ThreeColumn } from "@/components/shell/three-column";

export type ProfessorBreadcrumb = {
  href?: string;
  label: string;
};

/**
 * The frame every professor page shares: the workspace rail down the left, one
 * optional breadcrumb trail, one title block, one optional aside. Pages supply
 * their own content below it, so the workspace navigation never disappears
 * mid-task.
 *
 * The rail leaves below `lg`, which is why the horizontal `ProfessorSectionNav`
 * is still rendered there: a professor on a laptop in a lecture hall keeps the
 * same destinations, just laid out across instead of down.
 */
export function ProfessorPageShell({
  aside,
  breadcrumbs,
  children,
  description,
  title,
}: {
  aside?: ReactNode;
  breadcrumbs?: ProfessorBreadcrumb[];
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <ThreeColumn rail={<ProfessorRail />} drawerOpen={false}>
      <div className="flex w-full flex-col gap-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex max-w-3xl flex-col gap-3">
            {breadcrumbs && breadcrumbs.length > 0 ? (
              <nav aria-label="Breadcrumb">
                <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {breadcrumbs.map((crumb, index) => {
                    // The last crumb is where you already are, so it is never a
                    // link — it is the page's own name in the trail.
                    const isLast = index === breadcrumbs.length - 1;
                    return (
                      <li
                        key={`${crumb.label}-${index}`}
                        className="flex items-center gap-1.5"
                      >
                        {index > 0 ? (
                          <span
                            aria-hidden
                            className="text-muted-foreground/60"
                          >
                            /
                          </span>
                        ) : null}
                        {crumb.href && !isLast ? (
                          <Link
                            href={crumb.href}
                            className="rounded-sm transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          >
                            {crumb.label}
                          </Link>
                        ) : (
                          <span
                            aria-current={isLast ? "page" : undefined}
                            className={isLast ? "text-foreground" : undefined}
                          >
                            {crumb.label}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </nav>
            ) : null}
            <h1 className="font-display text-3xl font-normal tracking-normal">
              {title}
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
          {aside ? (
            <div className="flex flex-wrap items-center gap-3">{aside}</div>
          ) : null}
        </div>

        <div className="lg:hidden">
          <ProfessorSectionNav />
        </div>

        {children}
      </div>
    </ThreeColumn>
  );
}
