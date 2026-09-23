import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ThreeColumnProps = {
  rail?: ReactNode;
  children: ReactNode;
  drawer?: ReactNode;
  railCollapsed?: boolean;
  drawerOpen?: boolean;
  className?: string;
};

/**
 * [syllabus rail 264] [sheet] [tutor drawer 380], collapsing right to left:
 * the drawer leaves below xl, the rail below lg. Both are plain slots — the
 * practice screen owns the phone bottom-sheet that replaces the drawer, this
 * primitive only decides the columns.
 *
 * The wrapper is the desk (surface-tint) and the middle column is the page
 * (background), which is what makes the rail read as a band running the full
 * height without needing a border to separate it.
 */
export function ThreeColumn({
  rail,
  children,
  drawer,
  railCollapsed = false,
  drawerOpen = true,
  className,
}: ThreeColumnProps) {
  const showRail = Boolean(rail);
  const showDrawer = Boolean(drawer) && drawerOpen;

  const columns = showRail
    ? railCollapsed
      ? showDrawer
        ? "lg:grid-cols-[48px_minmax(0,1fr)] xl:grid-cols-[48px_minmax(0,1fr)_380px]"
        : "lg:grid-cols-[48px_minmax(0,1fr)]"
      : showDrawer
        ? "lg:grid-cols-[264px_minmax(0,1fr)] xl:grid-cols-[264px_minmax(0,1fr)_380px]"
        : "lg:grid-cols-[264px_minmax(0,1fr)]"
    : showDrawer
      ? "xl:grid-cols-[minmax(0,1fr)_380px]"
      : "";

  return (
    <div className={cn("bg-surface-tint", className)} data-slot="three-column">
      <div
        className={cn("mx-auto grid w-full max-w-[90rem] grid-cols-1", columns)}
      >
        {showRail ? (
          <aside
            data-slot="three-column-rail"
            data-collapsed={railCollapsed ? "true" : undefined}
            className="sticky top-14 hidden max-h-[calc(100svh-3.5rem)] self-start overflow-y-auto bg-surface-tint py-4 lg:block"
          >
            {rail}
          </aside>
        ) : null}

        <main
          data-slot="three-column-main"
          className="min-w-0 bg-background px-4 py-6 sm:px-6"
        >
          {children}
        </main>

        {showDrawer ? (
          <aside
            data-slot="three-column-drawer"
            className="sticky top-14 hidden max-h-[calc(100svh-3.5rem)] self-start overflow-y-auto border-l border-border bg-background px-4 py-6 xl:block"
          >
            {drawer}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
