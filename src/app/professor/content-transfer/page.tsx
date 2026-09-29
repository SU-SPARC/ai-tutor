import type { Metadata } from "next";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorContentTransferPanel } from "@/components/professor/professor-content-transfer-panel";
import {
  requirePageAccess,
  requireProfessorReview,
} from "@/lib/auth/authorization";
import { getServerEnv } from "@/lib/env/server";

export const metadata: Metadata = {
  title: "Copy questions in or out",
};

export default async function ProfessorContentTransferPage() {
  await requirePageAccess(
    requireProfessorReview,
    "/professor/content-transfer",
  );
  const env = getServerEnv();
  // Same rule the API uses: adding questions needs the real database.
  const canAddQuestions = !env.APP_DEMO_MODE && Boolean(env.DATABASE_URL);

  return (
    <ProfessorPageShell
      title="Copy questions in or out"
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Copy questions in or out" },
      ]}
      description="Bring in a question file someone sent you, or download your questions to share. Nothing you bring in is shown to students."
      notice={
        canAddQuestions ? undefined : "Demo: changes on this page are not saved."
      }
    >
      <ProfessorContentTransferPanel canAddQuestions={canAddQuestions} />
    </ProfessorPageShell>
  );
}
