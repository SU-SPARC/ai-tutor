import { Skeleton } from "@/components/ui/skeleton";

export default function PracticeLoading() {
  return (
    <main className="min-h-svh bg-background" aria-busy="true">
      <section className="mx-auto grid w-full max-w-[90rem] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Skeleton className="hidden h-96 rounded-lg lg:block" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      </section>
    </main>
  );
}
