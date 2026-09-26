import { ProfessorSectionNav } from "@/components/professor/professor-section-nav";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The workspace overview's shape while it loads: the header block, the
 * five-stage pipeline strip, a short list. This file also covers any
 * professor route without a loading file of its own, so it names no page.
 */
export default function ProfessorWorkspaceLoading() {
  return (
    <div
      data-slot="professor-page"
      className="mx-auto flex w-full max-w-[75rem] flex-col gap-6"
    >
      <ProfessorSectionNav className="lg:hidden" />
      <p role="status" className="sr-only">
        Loading the workspace…
      </p>
      <div aria-busy="true" className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-full max-w-md" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((stage) => (
            <Skeleton key={stage} className="h-36 rounded-panel" />
          ))}
        </div>
        <div className="flex flex-col gap-px overflow-hidden rounded-panel">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-16 rounded-none" />
          ))}
        </div>
      </div>
    </div>
  );
}
