import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the question bank: the two tabs, the filters, the grouped list. */
export default function ProfessorQuestionsLoading() {
  return (
    <ProfessorPageShell
      title="Question bank"
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Question bank" },
      ]}
      description="Loading your questions…"
    >
      <p role="status" className="sr-only">
        Loading your questions…
      </p>
      <div aria-busy="true" className="flex flex-col gap-6">
        <div className="flex gap-6 border-b border-rule pb-3">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="flex gap-1.5 overflow-hidden">
          {[0, 1, 2, 3].map((chip) => (
            <Skeleton key={chip} className="h-11 w-32 rounded-chip" />
          ))}
        </div>
        <div className="flex flex-col gap-px overflow-hidden rounded-panel">
          {Array.from({ length: 8 }, (_, row) => (
            <Skeleton key={row} className="h-14 rounded-none" />
          ))}
        </div>
      </div>
    </ProfessorPageShell>
  );
}
