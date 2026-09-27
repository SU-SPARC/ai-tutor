import { QuestionSheetSkeleton } from "@/components/sheet/question-sheet";
import { ThreeColumn } from "@/components/shell/three-column";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The practice route while its data loads: the same three columns as the
 * workspace, with the Sheet's own skeleton in the middle. Never a spinner.
 */
export default function PracticeLoading() {
  return (
    <ThreeColumn
      rail={
        <div className="flex flex-col gap-4 px-3" aria-hidden="true">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-full" />
          <div className="flex flex-col gap-1 pt-2">
            <Skeleton className="h-10 w-full rounded-l-none" />
            <Skeleton className="h-10 w-full rounded-l-none" />
            <Skeleton className="h-10 w-full rounded-l-none" />
          </div>
        </div>
      }
      railLabel="Questions"
      drawer={
        <div className="flex flex-col gap-4" aria-hidden="true">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-4 w-4/5" />
          <div className="flex flex-col gap-2 pt-4">
            <Skeleton className="h-12 w-4/5 rounded-l-none" />
            <Skeleton className="h-10 w-3/5 self-end" />
          </div>
        </div>
      }
      drawerLabel="Tutor"
      mobileTop={
        <div className="flex h-12 items-center border-b border-rule px-4">
          <Skeleton className="h-6 w-40" />
        </div>
      }
    >
      <div className="mx-auto w-full max-w-3xl" aria-busy="true">
        <p role="status" className="sr-only">
          Loading your practice question…
        </p>
        <QuestionSheetSkeleton />
      </div>
    </ThreeColumn>
  );
}
