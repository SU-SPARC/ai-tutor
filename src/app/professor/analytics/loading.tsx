import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the page: the metric row, then the two performance tables. */
export default function ProfessorAnalyticsLoading() {
  return (
    <ProfessorPageShell
      title="Class progress"
      description="How the class is doing on the questions students can see. No student is named."
    >
      <p role="status" className="sr-only">
        Loading class progress…
      </p>
      <div aria-busy="true" className="flex flex-col gap-10">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-24 rounded-panel" />
            ))}
          </div>
        </div>
        {[0, 1].map((table) => (
          <div key={table} className="flex flex-col gap-3">
            <Skeleton className="h-8 w-56" />
            <div className="flex flex-col gap-px overflow-hidden rounded-panel">
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <Skeleton key={row} className="h-10 rounded-none" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </ProfessorPageShell>
  );
}
