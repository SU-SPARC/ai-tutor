import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the upload sheet: one file field and its button. */
export default function ProfessorUploadLoading() {
  return (
    <ProfessorPageShell
      title="Upload notes"
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Upload notes" },
      ]}
      description="Getting the upload page ready…"
    >
      <p role="status" className="sr-only">
        Loading the upload page…
      </p>
      <div
        aria-busy="true"
        className="flex flex-col gap-5 rounded-panel bg-sheet p-4 sm:p-6"
      >
        <Skeleton className="h-6 w-56" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Skeleton className="h-10 sm:w-96" />
          <Skeleton className="h-10 sm:w-40" />
        </div>
      </div>
    </ProfessorPageShell>
  );
}
