import { ClipboardCheck } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorFriendlyReviewPanel } from "@/components/professor/professor-friendly-review-panel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getProfessorQuestionReviewDashboard } from "@/lib/data/data-store";
import {
  requirePageAccess,
  requireProfessorReview,
} from "@/lib/auth/authorization";

export default async function ProfessorReviewPage() {
  const authorization = await requirePageAccess(
    requireProfessorReview,
    "/professor/review",
  );
  const dashboard = await getProfessorQuestionReviewDashboard(authorization);

  return (
    <ProfessorPageShell
      title="Review by syllabus topic"
      description="Choose one topic before loading any question details. Approval records an editorial decision; publishing remains a separate lifecycle action."
      aside={
        <Badge variant="outline" className="h-10 gap-2 px-4">
          <ClipboardCheck className="h-4 w-4" />
          one at a time
        </Badge>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Review and publication queue</CardTitle>
          <CardDescription>
            Topics follow the canonical syllabus order. Questions are shown one
            at a time and only server-authorized review actions are available.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfessorFriendlyReviewPanel initialDashboard={dashboard} />
        </CardContent>
      </Card>
    </ProfessorPageShell>
  );
}
