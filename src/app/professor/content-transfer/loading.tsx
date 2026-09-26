import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProfessorContentTransferLoading() {
  return (
    <ProfessorPageShell
      title="Import & export"
      description="Move question content in and out as validated JSON; an import never publishes anything to students."
    >
      <p role="status" className="sr-only">
        Loading import and export…
      </p>
      <div aria-busy="true" className="flex flex-col gap-10">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-28 rounded-panel" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-20 rounded-panel" />
        </div>
      </div>
    </ProfessorPageShell>
  );
}
