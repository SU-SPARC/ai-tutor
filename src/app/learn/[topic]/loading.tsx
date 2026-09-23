import { QuestionSheetSkeleton } from "@/components/sheet/question-sheet";
import { Skeleton } from "@/components/ui/skeleton";

export default function TopicLoading() {
  return (
    <div className="bg-surface-tint" aria-busy="true">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <p className="sr-only">Loading this topic</p>
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-80 max-w-full" />
            <Skeleton className="h-4 w-full max-w-lg" />
          </div>
          <QuestionSheetSkeleton />
          <QuestionSheetSkeleton />
        </div>
      </div>
    </div>
  );
}
