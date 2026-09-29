import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like a student's record: name and email strip, number row, tables. */
export default function ProfessorStudentLoading() {
  return (
    <ProfessorPageShell
      title="Student record"
      description="What this student has practiced and how it went."
    >
      <p role="status" className="sr-only">
        Loading the student record…
      </p>
      <div aria-busy="true" className="flex flex-col gap-8">
        <Skeleton className="h-20 rounded-panel" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-panel" />
          ))}
        </div>
        {[0, 1].map((table) => (
          <div key={table} className="flex flex-col gap-3">
            <Skeleton className="h-8 w-56" />
            <div className="flex flex-col gap-px overflow-hidden rounded-panel">
              {Array.from({ length: 4 }, (_, row) => (
                <Skeleton key={row} className="h-10 rounded-none" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </ProfessorPageShell>
  );
}
