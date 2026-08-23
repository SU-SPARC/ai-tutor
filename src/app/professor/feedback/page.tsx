import { MessageSquareWarning } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorQuestionFeedbackPanel } from "@/components/professor/professor-question-feedback-panel";
import { Badge } from "@/components/ui/badge";
import {
  requirePageAccess,
  requireProfessorReview,
} from "@/lib/auth/authorization";
import { getProfessorQuestionFeedbackDashboard } from "@/lib/data/question-feedback-repository";

export default async function ProfessorFeedbackPage() {
  const authorization = await requirePageAccess(
    requireProfessorReview,
    "/professor/feedback",
  );
  const dashboard = await getProfessorQuestionFeedbackDashboard(authorization);

  return (
    <ProfessorPageShell
      title="Question feedback"
      description="Review student-reported problems tied to an exact tutor session and immutable question version. Triage and resolution are operational records; they do not edit or republish question content."
      aside={
        <Badge variant="outline" className="h-10 gap-2 px-4">
          <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
          {dashboard.counts.open} open
        </Badge>
      }
    >
      <ProfessorQuestionFeedbackPanel initialDashboard={dashboard} />
    </ProfessorPageShell>
  );
}
