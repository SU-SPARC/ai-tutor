import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProfessorAvailabilityLoading() {
  return (
    <ProfessorPageShell
      title="What students see"
      description="Choose when students can see each topic or question."
    >
      <p role="status" className="sr-only">
        Loading what students see…
      </p>
      <div aria-busy="true" className="flex flex-col gap-8">
        <Skeleton className="h-10 w-full max-w-xl" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-48" />
          <div className="flex flex-col gap-px overflow-hidden rounded-panel">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-28 rounded-none" />
            ))}
          </div>
        </div>
      </div>
    </ProfessorPageShell>
  );
}
