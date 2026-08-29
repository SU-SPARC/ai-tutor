import { ShieldCheck } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorQuestionIntakePanel } from "@/components/professor/professor-question-intake-panel";
import { ProfessorQuestionLifecyclePanel } from "@/components/professor/professor-question-lifecycle-panel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getQuestionLifecycleDashboard } from "@/lib/data/data-store";
import {
  requireProfessorReview,
  requirePageAccess,
} from "@/lib/auth/authorization";

export default async function ProfessorQuestionsPage() {
  const authorization = await requirePageAccess(
    requireProfessorReview,
    "/professor/questions",
  );
  const initialDashboard = await getQuestionLifecycleDashboard(authorization);

  return (
    <ProfessorPageShell
      title="Question lifecycle"
      description="Operate immutable question versions from draft through review, approval, publication, rollback, and archival."
      aside={
        <Badge variant="outline" className="h-10 gap-2 px-4">
          <ShieldCheck className="h-4 w-4" />
          private materials excluded
        </Badge>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Question intake</CardTitle>
          <CardDescription>
            Turn one submitted question into a complete, editable tutoring draft
            before it enters the normal review lifecycle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfessorQuestionIntakePanel
            readOnly={initialDashboard.readOnly}
            topics={initialDashboard.topics}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Professor question queue</CardTitle>
          <CardDescription>
            Demo mode is read-only. Production changes use explicit, attributed
            lifecycle transitions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfessorQuestionLifecyclePanel
            initialDashboard={initialDashboard}
          />
        </CardContent>
      </Card>
    </ProfessorPageShell>
  );
}
