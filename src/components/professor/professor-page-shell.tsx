import type { ReactNode } from "react";

import { PageHeader, type BreadcrumbItem } from "@/components/ui/page-header";

export type ProfessorBreadcrumb = BreadcrumbItem;

/** The one demo sentence every professor page uses in its notice slot. */
export const PROFESSOR_DEMO_NOTICE = "Demo: changes on this page are not saved.";

/**
 * The frame every professor page shares, inside the workspace layout (which
 * already provides the rail, the `<main>` landmark and the phone menu): the
 * header block (breadcrumb, serif h1, ONE sentence, at most one primary and
 * one secondary action) and a dense column capped at 1200px.
 *
 * Below 1024 the rail is hidden and the header's "Menu" button carries the
 * same list of pages; the page itself draws no second copy.
 *
 * `aside` is the action slot. Put buttons there, not status badges; a demo
 * notice belongs in `notice` (one quiet line under the h1).
 */
export function ProfessorPageShell({
  aside,
  breadcrumbs,
  children,
  courseFilter,
  description,
  notice,
  title,
}: {
  aside?: ReactNode;
  breadcrumbs?: ProfessorBreadcrumb[];
  children: ReactNode;
  /** The course selector, on pages whose lists are scoped to one course. */
  courseFilter?: ReactNode;
  description: string;
  /**
   * One line under the description. The demo line is always exactly "Demo:
   * changes on this page are not saved." (see `PROFESSOR_DEMO_NOTICE`). Text
   * or an inline node; a block element (a <p> with a link) is not re-wrapped.
   */
  notice?: ReactNode;
  title: string;
}) {
  return (
    <div
      data-slot="professor-page"
      className="mx-auto flex w-full max-w-[75rem] flex-col gap-6"
    >
      <PageHeader
        breadcrumb={breadcrumbs}
        title={title}
        description={description}
        actions={aside}
        notice={notice}
        className="mb-2"
      />
      {courseFilter}
      {children}
    </div>
  );
}
