import type { ReactNode } from "react";

import { ProfessorSectionNav } from "@/components/professor/professor-section-nav";
import { PageHeader, type BreadcrumbItem } from "@/components/ui/page-header";

export type ProfessorBreadcrumb = BreadcrumbItem;

/**
 * The frame every professor page shares, inside the workspace layout (which
 * already provides the rail, the `<main>` landmark and the phone menu): the
 * header block (breadcrumb, serif h1, ONE sentence, at most one primary and
 * one secondary action) and a dense column capped at 1200px.
 *
 * Below 1024 the rail is hidden, so the page itself carries the workspace
 * sections as one scrolling row above the header block (44px, not the old
 * wrapped 120px block). Above 1024 the rail in the layout is the only copy.
 *
 * `aside` is the action slot. Put buttons there, not status badges; a demo
 * notice belongs in `notice` (one quiet line under the h1).
 */
export function ProfessorPageShell({
  aside,
  breadcrumbs,
  children,
  description,
  notice,
  title,
}: {
  aside?: ReactNode;
  breadcrumbs?: ProfessorBreadcrumb[];
  children: ReactNode;
  description: string;
  /**
   * One quiet line under the description (e.g. "Demo data"). Text or an
   * inline node; a block element (a <p> with a link) is not re-wrapped.
   */
  notice?: ReactNode;
  title: string;
}) {
  return (
    <div
      data-slot="professor-page"
      className="mx-auto flex w-full max-w-[75rem] flex-col gap-6"
    >
      <ProfessorSectionNav className="lg:hidden" />
      <PageHeader
        breadcrumb={breadcrumbs}
        title={title}
        description={description}
        actions={aside}
        notice={notice}
        className="mb-2"
      />
      {children}
    </div>
  );
}
