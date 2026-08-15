import { Skeleton } from "@/components/ui/skeleton";

export default function PracticeQuestionLoading() {
  return (
    <main className="min-h-svh bg-background" aria-busy="true">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-12">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-40 rounded-lg" />
      </section>
    </main>
  );
}
