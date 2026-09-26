import type { ReactNode, Ref } from "react";

import { DrawerEdgeTab } from "@/components/shell/drawer-edge-tab";
import { MAIN_CONTENT_ID } from "@/components/shell/skip-link";
import { cn } from "@/lib/utils";

export type ThreeColumnProps = {
  /** Left rail (SyllabusRail, ProfessorRail, PracticeRail). Shown >= 1024. */
  rail?: ReactNode;
  children: ReactNode;
  /** Right drawer (the tutor, an About panel). Shown >= 1280. */
  drawer?: ReactNode;
  /** 48px icon rail instead of 264. AppRail rows collapse to their icon. */
  railCollapsed?: boolean;
  /** `false` removes the drawer column (and shows the edge tab, if any). */
  drawerOpen?: boolean;
  /**
   * Called by the right-edge tab. When set, a tab labelled `drawerTabLabel`
   * is rendered on the right edge whenever the drawer column is not visible
   * (below 1280, or when `drawerOpen` is false). Client callers only.
   */
  onDrawerToggle?: () => void;
  drawerTabLabel?: string;
  /** Ref to the edge tab, so a client caller can move focus onto it. */
  drawerTabRef?: Ref<HTMLButtonElement>;
  /** Replaces the rail below 1024: a back bar, a "Jump to" select. */
  mobileTop?: ReactNode;
  /** Landmark names for the two asides. */
  railLabel?: string;
  drawerLabel?: string;
  /** Extra classes for <main> (e.g. professor: dense, max 1200). */
  mainClassName?: string;
  className?: string;
};

/**
 * [rail 264] [main] [drawer 380], collapsing right to left: the drawer leaves
 * below 1280, the rail below 1024 (replaced by `mobileTop`). Both are plain
 * slots; this primitive only decides the columns.
 *
 * It renders THE `<main id="main-content">` of the page (the skip link's
 * target), so pages inside it must not render another `<main>`.
 *
 * Tint layering: rail and drawer sit on surface-tint, the main column on the
 * surface, and the Sheet (lightest) inside the main column.
 */
export function ThreeColumn({
  rail,
  children,
  drawer,
  railCollapsed = false,
  drawerOpen = true,
  onDrawerToggle,
  drawerTabLabel = "Open tutor",
  drawerTabRef,
  mobileTop,
  railLabel = "Syllabus",
  drawerLabel = "Tutor",
  mainClassName,
  className,
}: ThreeColumnProps) {
  const showRail = Boolean(rail);
  const showDrawer = Boolean(drawer) && drawerOpen;

  const railColumn = railCollapsed ? "var(--rail-collapsed-w)" : "var(--rail-w)";
  const columns = showRail
    ? showDrawer
      ? "lg:grid-cols-[var(--rail-col)_minmax(0,1fr)] xl:grid-cols-[var(--rail-col)_minmax(0,1fr)_var(--drawer-w)]"
      : "lg:grid-cols-[var(--rail-col)_minmax(0,1fr)]"
    : showDrawer
      ? "xl:grid-cols-[minmax(0,1fr)_var(--drawer-w)]"
      : "";

  return (
    <div
      className={cn("bg-surface", className)}
      data-slot="three-column"
      style={{ ["--rail-col" as string]: railColumn }}
    >
      <div
        className={cn(
          "mx-auto grid w-full max-w-[90rem] grid-cols-1",
          columns,
        )}
      >
        {showRail ? (
          <aside
            aria-label={railLabel}
            data-slot="three-column-rail"
            data-collapsed={railCollapsed ? "true" : undefined}
            className="group/rail sticky top-(--header-h) hidden max-h-[calc(100svh-var(--header-h))] self-start overflow-y-auto overscroll-contain bg-surface-tint py-4 lg:block"
          >
            {rail}
          </aside>
        ) : null}

        {/* tabIndex -1 lets the skip link move focus here; a landmark is
         * not a control, so it draws no ring of its own. */}
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          data-slot="three-column-main"
          className={cn(
            "min-w-0 bg-surface outline-none",
            mobileTop ? "pb-6 lg:py-6" : "py-6",
            "px-4 sm:px-6 lg:px-8",
            mainClassName,
          )}
        >
          {mobileTop ? (
            <div data-slot="three-column-mobile-top" className="-mx-4 mb-4 sm:-mx-6 lg:hidden">
              {mobileTop}
            </div>
          ) : null}
          {children}
        </main>

        {showDrawer ? (
          <aside
            aria-label={drawerLabel}
            data-slot="three-column-drawer"
            className="sticky top-(--header-h) hidden max-h-[calc(100svh-var(--header-h))] self-start overflow-y-auto overscroll-contain bg-surface-tint px-4 py-6 xl:block"
          >
            {drawer}
          </aside>
        ) : null}
      </div>

      {onDrawerToggle ? (
        <DrawerEdgeTab
          ref={drawerTabRef}
          label={drawerTabLabel}
          onToggle={onDrawerToggle}
          alwaysVisible={!showDrawer}
        />
      ) : null}
    </div>
  );
}
