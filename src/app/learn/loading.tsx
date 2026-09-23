import { QuestionSheetSkeleton } from "@/components/sheet/question-sheet";
import { Skeleton } from "@/components/ui/skeleton";

/** The shape of what is arriving, never a spinner. */
export default function LearnLoading() {
  return (
    <div className="bg-surface-tint" aria-busy="true">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <p className="sr-only">Loading your practice progress</p>
        <div className="flex flex-col gap-10">
          <QuestionSheetSkeleton />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-56" />
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-24" />
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
