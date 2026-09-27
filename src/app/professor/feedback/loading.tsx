import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProfessorFeedbackLoading() {
  return (
    <ProfessorPageShell
      title="Student reports"
      description="Problems students flagged on practice questions, for you to triage and resolve."
    >
      <p role="status" className="sr-only">
        Loading student reports…
      </p>
      <div aria-busy="true" className="flex flex-col gap-5">
        <Skeleton className="h-5 w-full max-w-xl" />
        <div className="flex flex-col gap-3 sm:flex-row">
          <Skeleton className="h-10 sm:w-48" />
          <Skeleton className="h-10 sm:w-64" />
        </div>
        <div className="flex flex-col gap-px overflow-hidden rounded-panel">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-48 rounded-none" />
          ))}
        </div>
      </div>
    </ProfessorPageShell>
  );
}
