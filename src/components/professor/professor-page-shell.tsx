import type { ReactNode } from "react";

import { ProfessorSectionNav } from "@/components/professor/professor-section-nav";

/**
 * The frame every professor page shares: one title block, one section nav,
 * one optional aside. Pages supply their own content below it, so the
 * workspace navigation never disappears mid-task.
 */
export function ProfessorPageShell({
  aside,
  children,
  description,
  title,
}: {
  aside?: ReactNode;
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex max-w-3xl flex-col gap-3">
            <h1 className="text-3xl font-semibold tracking-normal">{title}</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
          {aside ? (
            <div className="flex flex-wrap items-center gap-3">{aside}</div>
          ) : null}
        </div>

        <ProfessorSectionNav />

        {children}
      </section>
    </main>
  );
}
