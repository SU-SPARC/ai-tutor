import { Skeleton } from "@/components/ui/skeleton";

export default function TopicsLoading() {
  return (
    <main className="min-h-svh bg-background" aria-busy="true">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} className="h-48 rounded-lg" />
          ))}
        </div>
      </section>
    </main>
  );
}
