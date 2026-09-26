import type { Metadata } from "next";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorUploadPanel } from "@/components/professor/professor-upload-panel";
import { PROFESSOR_CONTENT_UPLOAD_MAX_BYTES } from "@/lib/tutor/professor-content-upload";
import { requireProfessor, requirePageAccess } from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Uploads",
};

export default async function ProfessorUploadPage() {
  await requirePageAccess(requireProfessor, "/professor/upload");
  const maxKb = Math.floor(PROFESSOR_CONTENT_UPLOAD_MAX_BYTES / 1024);
  return (
    <ProfessorPageShell
      title="Uploads"
      breadcrumbs={[
        { label: "Workspace", href: "/professor" },
        { label: "Uploads" },
      ]}
      description="Upload a LaTeX or small PDF file to preview the topics, patterns and formulas the tutor would take from it."
      notice={`Files up to ${maxKb} KB. Everything you upload stays private and needs your review before any of it is used.`}
    >
      <section
        aria-labelledby="upload-heading"
        className="flex flex-col gap-5 rounded-panel bg-sheet p-4 sm:p-6"
      >
        <h2 id="upload-heading" className="type-h3 text-ink">
          Private reference upload
        </h2>
        <ProfessorUploadPanel />
      </section>
    </ProfessorPageShell>
  );
}
