import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the activity view: view tabs, the filter row, the table. */
export default function ProfessorStudentsLoading() {
  return (
    <ProfessorPageShell
      title="Students"
      description="Everyone who has practiced, with what they’ve done so far."
    >
      <p role="status" className="sr-only">
        Loading students…
      </p>
      <div aria-busy="true" className="flex flex-col gap-6">
        <div className="flex gap-6 border-b border-rule pb-3">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Skeleton className="h-10 sm:w-72" />
          <Skeleton className="h-10 sm:w-60" />
          <Skeleton className="h-10 sm:w-24" />
        </div>
        <div className="flex flex-col gap-px overflow-hidden rounded-panel">
          {Array.from({ length: 8 }, (_, row) => (
            <Skeleton key={row} className="h-12 rounded-none" />
          ))}
        </div>
      </div>
    </ProfessorPageShell>
  );
}
