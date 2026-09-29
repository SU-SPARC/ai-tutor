import { MAIN_CONTENT_ID } from "@/components/shell/skip-link";
import { Skeleton } from "@/components/ui/skeleton";

/** The account sheet's shape: title, the detail rows, the two actions. */
export default function AccountLoading() {
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      aria-busy="true"
      className="min-h-[calc(100svh-var(--header-h))] bg-surface px-4 py-10 outline-none sm:px-6 sm:py-16"
    >
      <p role="status" className="sr-only">
        Loading your account…
      </p>
      <div className="sheet-shadow mx-auto flex w-full max-w-2xl flex-col gap-8 rounded-panel bg-sheet p-6 sm:p-8">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-52" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
        </div>
        <div className="flex flex-col divide-y divide-rule border-y border-rule">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-6">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-2/3 sm:col-span-2" />
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>
    </main>
  );
}
