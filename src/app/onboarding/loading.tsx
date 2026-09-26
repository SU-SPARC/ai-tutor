import { MAIN_CONTENT_ID } from "@/components/shell/skip-link";
import { Skeleton } from "@/components/ui/skeleton";

/** The notice's shape: title, intro, the four points, the decision. */
export default function OnboardingLoading() {
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      aria-busy="true"
      className="min-h-[calc(100svh-var(--header-h))] bg-surface px-4 py-10 outline-none sm:px-6 sm:py-16"
    >
      <p role="status" className="sr-only">
        Loading the tutor and data notice…
      </p>
      <div className="sheet-shadow mx-auto flex w-full max-w-3xl flex-col gap-8 rounded-panel bg-sheet p-6 sm:p-10">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
        </div>
        <div className="grid gap-x-10 gap-y-6 border-t border-rule pt-6 sm:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="flex flex-col gap-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
        <div className="border-t border-rule pt-6">
          <Skeleton className="h-10 w-56" />
        </div>
      </div>
    </main>
  );
}
