import type { Metadata } from "next";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorQuestionFeedbackPanel } from "@/components/professor/professor-question-feedback-panel";
import {
  requirePageAccess,
  requireProfessorReview,
} from "@/lib/auth/authorization";
import { getProfessorQuestionFeedbackDashboard } from "@/lib/data/question-feedback-repository";

export const metadata: Metadata = {
  title: "Reports from students",
};

export default async function ProfessorFeedbackPage() {
  const authorization = await requirePageAccess(
    requireProfessorReview,
    "/professor/feedback",
  );
  const dashboard = await getProfessorQuestionFeedbackDashboard(authorization);

  return (
    <ProfessorPageShell
      title="Reports from students"
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Reports from students" },
      ]}
      description="Problems students flagged on practice questions."
      notice={
        dashboard.mode === "demo"
          ? "Demo: changes on this page are not saved."
          : undefined
      }
    >
      <ProfessorQuestionFeedbackPanel initialDashboard={dashboard} />
    </ProfessorPageShell>
  );
}
