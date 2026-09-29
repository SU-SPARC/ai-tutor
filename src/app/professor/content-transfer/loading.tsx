import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProfessorContentTransferLoading() {
  return (
    <ProfessorPageShell
      title="Copy questions in or out"
      description="Bring in a question file someone sent you, or download your questions to share. Nothing you bring in is shown to students."
    >
      <p role="status" className="sr-only">
        Loading this page…
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
