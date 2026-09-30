import { BackBar } from "@/components/shell/back-bar";
import { ThreeColumn } from "@/components/shell/three-column";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading states for `/learn` and `/learn/[topic]`, drawn in the shape of
 * the real pages (header, Continue card, syllabus rows, right column; the
 * topic page also has the rail), so nothing jumps when the content arrives.
 * Never a spinner. The label is announced once through a polite status region.
 */

const RAIL_ROWS = 11;

function RailSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-4" aria-hidden="true">
      <Skeleton className="mb-2 h-4 w-20" />
      {Array.from({ length: RAIL_ROWS }, (_, index) => (
        <div key={index} className="flex h-10 items-center gap-3">
          <Skeleton className="h-4 w-5" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="size-3 rounded-xs" />
        </div>
      ))}
    </div>
  );
}

function LoadingStatus({ label }: { label: string }) {
  return (
    <p role="status" className="sr-only">
      {label}
    </p>
  );
}

/** A compact Sheet row: header line, title, two prompt lines. */
function CompactSheetSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-panel bg-sheet p-4 sm:p-5">
      <Skeleton className="h-4 w-56 max-w-full" />
      <Skeleton className="h-6 w-2/3" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
      </div>
      {withAction ? <Skeleton className="mt-2 h-12 w-full sm:w-40" /> : null}
    </div>
  );
}

function SyllabusRowSkeleton() {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 py-3 pr-3 pl-3.5 sm:grid-cols-[5rem_minmax(0,1fr)]">
      <Skeleton className="h-5 w-14" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-3/4" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-1.5 w-32 rounded-full" />
          <Skeleton className="h-4 w-8" />
        </div>
      </div>
    </div>
  );
}

export function LearnSkeleton({
  label = "Loading your syllabus…",
}: {
  label?: string;
}) {
  return (
    <ThreeColumn drawerOpen={false}>
      <LoadingStatus label={label} />
      <div
        aria-hidden="true"
        className="mx-auto flex w-full max-w-3xl flex-col gap-8 xl:max-w-6xl"
      >
        <Skeleton className="h-10 w-32" />

        <div className="grid grid-cols-1 gap-12 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex min-w-0 flex-col gap-12">
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-16" />
              <CompactSheetSkeleton withAction />
            </div>
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-10 w-full sm:w-56" />
              <div className="flex flex-col divide-y divide-rule border-y border-rule">
                {Array.from({ length: 6 }, (_, index) => (
                  <SyllabusRowSkeleton key={index} />
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-10">
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-16" />
              <div className="flex gap-2">
                {Array.from({ length: 7 }, (_, index) => (
                  <Skeleton key={index} className="size-8 rounded-full" />
                ))}
              </div>
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-1.5 w-full rounded-full" />
              <Skeleton className="h-40 w-full max-w-64" />
            </div>
          </div>
        </div>
      </div>
    </ThreeColumn>
  );
}

export function TopicSkeleton() {
  return (
    <ThreeColumn
      mobileTop={<BackBar href="/learn" label="Learn" />}
      rail={<RailSkeleton />}
    >
      <LoadingStatus label="Loading this topic…" />
      <div
        aria-hidden="true"
        className="mx-auto flex w-full max-w-3xl flex-col gap-8 xl:max-w-6xl"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-8">
          <div className="flex w-full max-w-3xl flex-col gap-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-10 w-4/5" />
            <Skeleton className="h-5 w-full max-w-prose" />
            <div className="mt-2 flex items-center gap-3">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-1.5 w-32 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-12 w-full shrink-0 sm:w-44" />
        </div>

        <div className="grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-12">
          <div className="flex min-w-0 flex-col gap-4">
            <Skeleton className="h-4 w-20" />
            <div className="flex gap-1">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="size-11" />
              ))}
            </div>
            <div className="flex flex-col gap-3">
              <CompactSheetSkeleton />
              <CompactSheetSkeleton />
              <CompactSheetSkeleton />
            </div>
          </div>
          <div className="flex flex-col gap-4 self-start rounded-panel bg-surface-tint p-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </div>
    </ThreeColumn>
  );
}
