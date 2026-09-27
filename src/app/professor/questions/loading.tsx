import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the bank: Bank · Intake tabs, view chips, the grouped table. */
export default function ProfessorQuestionsLoading() {
  return (
    <ProfessorPageShell
      title="Questions"
      breadcrumbs={[
        { label: "Workspace", href: "/professor" },
        { label: "Questions" },
      ]}
      description="Loading the question bank…"
    >
      <p role="status" className="sr-only">
        Loading questions…
      </p>
      <div aria-busy="true" className="flex flex-col gap-6">
        <div className="flex gap-6 border-b border-rule pb-3">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
        </div>
        <div className="flex gap-1.5 overflow-hidden">
          {[0, 1, 2, 3, 4, 5].map((chip) => (
            <Skeleton key={chip} className="h-8 w-24 rounded-chip" />
          ))}
        </div>
        <Skeleton className="h-36 rounded-panel" />
        <div className="flex flex-col gap-px overflow-hidden rounded-panel">
          {Array.from({ length: 8 }, (_, row) => (
            <Skeleton key={row} className="h-12 rounded-none" />
          ))}
        </div>
      </div>
    </ProfessorPageShell>
  );
}
