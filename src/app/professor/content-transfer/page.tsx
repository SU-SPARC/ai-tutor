import type { Metadata } from "next";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorContentTransferPanel } from "@/components/professor/professor-content-transfer-panel";
import {
  requirePageAccess,
  requireProfessorReview,
} from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Import & export",
};

export default async function ProfessorContentTransferPage() {
  await requirePageAccess(
    requireProfessorReview,
    "/professor/content-transfer",
  );

  return (
    <ProfessorPageShell
      title="Import & export"
      breadcrumbs={[
        { label: "Workspace", href: "/professor" },
        { label: "Import & export" },
      ]}
      description="Move question content in and out as validated JSON; an import never publishes anything to students."
      notice="Files use content-transfer format version 1. Imports need database storage; demo mode allows exports and read-only previews."
    >
      <ProfessorContentTransferPanel />
    </ProfessorPageShell>
  );
}
