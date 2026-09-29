import { MAIN_CONTENT_ID } from "@/components/shell/skip-link";
import { Skeleton } from "@/components/ui/skeleton";

/** The notice's shape: title, the one paragraph, the button, the details line. */
export default function OnboardingLoading() {
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      aria-busy="true"
      className="min-h-[calc(100svh-var(--header-h))] bg-surface px-4 py-10 outline-none sm:px-6 sm:py-16"
    >
      <p role="status" className="sr-only">
        Loading…
      </p>
      <div className="sheet-shadow mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-panel bg-sheet p-6 sm:p-10">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-56 max-w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
        <Skeleton className="h-12 w-full sm:w-60" />
        <div className="border-t border-rule pt-4">
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
    </main>
  );
}
