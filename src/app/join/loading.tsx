import { MAIN_CONTENT_ID } from "@/components/shell/skip-link";
import { Skeleton } from "@/components/ui/skeleton";

/** The join sheet's shape while the page resolves the session: never a spinner. */
export default function JoinLoading() {
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      aria-busy="true"
      className="min-h-[calc(100svh-var(--header-h))] bg-surface px-4 py-10 outline-none sm:px-6 sm:py-16"
    >
      <p role="status" className="sr-only">
        Loading the join page…
      </p>
      <div className="sheet-shadow mx-auto flex w-full max-w-md flex-col gap-6 rounded-panel bg-sheet p-6 sm:p-8">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-full" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-28" />
          <div className="flex gap-2">
            <Skeleton className="h-12 flex-1" />
            <Skeleton className="h-12 w-20" />
          </div>
        </div>
        <Skeleton className="mx-auto h-5 w-36" />
        <div className="flex flex-col gap-2 border-t border-rule pt-6">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    </main>
  );
}
