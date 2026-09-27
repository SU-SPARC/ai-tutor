import type { Metadata } from "next";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorQuestionFeedbackPanel } from "@/components/professor/professor-question-feedback-panel";
import {
  requirePageAccess,
  requireProfessorReview,
} from "@/lib/auth/authorization";
import { getProfessorQuestionFeedbackDashboard } from "@/lib/data/question-feedback-repository";

export const metadata: Metadata = {
  title: "Student reports",
};

export default async function ProfessorFeedbackPage() {
  const authorization = await requirePageAccess(
    requireProfessorReview,
    "/professor/feedback",
  );
  const dashboard = await getProfessorQuestionFeedbackDashboard(authorization);
  const open = dashboard.counts.open;

  return (
    <ProfessorPageShell
      title="Student reports"
      breadcrumbs={[
        { label: "Workspace", href: "/professor" },
        { label: "Student reports" },
      ]}
      description="Problems students flagged on practice questions, for you to triage and resolve."
      notice={
        <>
          <span className="font-mono tabular text-ink">{open}</span>{" "}
          {open === 1 ? "report is" : "reports are"} open
          {dashboard.mode === "demo" ? " · Demo data" : ""}
        </>
      }
    >
      <ProfessorQuestionFeedbackPanel initialDashboard={dashboard} />
    </ProfessorPageShell>
  );
}
