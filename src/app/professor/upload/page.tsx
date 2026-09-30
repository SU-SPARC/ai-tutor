import type { Metadata } from "next";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorUploadPanel } from "@/components/professor/professor-upload-panel";
import { requireProfessor, requirePageAccess } from "@/lib/auth/authorization";
import { PROFESSOR_CONTENT_UPLOAD_MAX_BYTES } from "@/lib/tutor/professor-content-upload";

export const metadata: Metadata = {
  title: "Upload notes",
};

export default async function ProfessorUploadPage() {
  await requirePageAccess(requireProfessor, "/professor/upload");
  return (
    <ProfessorPageShell
      title="Upload notes"
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Upload notes" },
      ]}
      description="See what the tutor can read from your lecture notes. For now this is a preview only: it doesn't change the tutor or create questions, and students never see your file."
    >
      <section
        aria-label="Upload your lecture notes"
        className="flex flex-col gap-5 rounded-panel bg-sheet p-4 sm:p-6"
      >
        <ProfessorUploadPanel maxBytes={PROFESSOR_CONTENT_UPLOAD_MAX_BYTES} />
      </section>
    </ProfessorPageShell>
  );
}
