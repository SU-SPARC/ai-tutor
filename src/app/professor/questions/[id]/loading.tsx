import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { QuestionSheetSkeleton } from "@/components/sheet/question-sheet";
import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the question page: what you can do and the sheet left, sections right. */
export default function ProfessorQuestionLoading() {
  return (
    <ProfessorPageShell
      title="Question"
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Question bank", href: "/professor/questions" },
        { label: "Question" },
      ]}
      description="Loading this question…"
    >
      <p role="status" className="sr-only">
        Loading the question…
      </p>
      <div aria-busy="true" className="grid gap-8 lg:grid-cols-3">
        <div className="flex flex-col gap-8 lg:col-span-2">
          <Skeleton className="h-44 rounded-panel" />
          <QuestionSheetSkeleton />
          <Skeleton className="h-32 rounded-panel" />
        </div>
        <Skeleton className="h-64 rounded-panel" />
      </div>
    </ProfessorPageShell>
  );
}
