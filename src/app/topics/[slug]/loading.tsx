import { Skeleton } from "@/components/ui/skeleton";

export default function TopicDetailLoading() {
  return (
    <main className="min-h-svh bg-background" aria-busy="true">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </div>
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-40 rounded-lg" />
          ))}
        </div>
      </section>
    </main>
  );
}
