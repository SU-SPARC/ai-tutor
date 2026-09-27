import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { QuestionSheetSkeleton } from "@/components/sheet/question-sheet";
import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the queue: filter row, count tiles, list left, sheet right. */
export default function ProfessorReviewLoading() {
  return (
    <ProfessorPageShell
      title="Review queue"
      breadcrumbs={[
        { label: "Workspace", href: "/professor" },
        { label: "Review queue" },
      ]}
      description="Loading the questions waiting for a decision…"
    >
      <p role="status" className="sr-only">
        Loading the review queue…
      </p>
      <div aria-busy="true" className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Skeleton className="h-10 sm:w-96" />
          <Skeleton className="h-10 sm:w-40" />
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <Skeleton key={tile} className="h-24 rounded-panel" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="flex flex-col gap-px overflow-hidden rounded-panel lg:col-span-2">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-20 rounded-none" />
            ))}
          </div>
          <QuestionSheetSkeleton className="lg:col-span-3" />
        </div>
      </div>
    </ProfessorPageShell>
  );
}
