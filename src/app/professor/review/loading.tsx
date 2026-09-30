import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { QuestionSheetSkeleton } from "@/components/sheet/question-sheet";
import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the review screen: topic choice, one progress line, list left, question right. */
export default function ProfessorReviewLoading() {
  return (
    <ProfessorPageShell
      title="Review questions"
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Review questions" },
      ]}
      description="Read each question, then approve it or send it back. Students never see a question until you show it to them."
    >
      <p role="status" className="sr-only">
        Opening the questions waiting for you…
      </p>
      <div aria-busy="true" className="flex flex-col gap-6">
        <Skeleton className="h-11 sm:w-96" />
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="flex flex-col gap-px overflow-hidden rounded-panel lg:col-span-2">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-20 rounded-none" />
            ))}
          </div>
          <div className="flex flex-col gap-4 lg:col-span-3">
            <Skeleton className="h-11 w-full" />
            <QuestionSheetSkeleton />
          </div>
        </div>
      </div>
    </ProfessorPageShell>
  );
}
