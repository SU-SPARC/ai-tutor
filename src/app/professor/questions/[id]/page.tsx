import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorQuestionDetailSummary } from "@/components/professor/professor-question-detail-summary";
import { ProfessorQuestionLifecyclePanel } from "@/components/professor/professor-question-lifecycle-panel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  requirePageAccess,
  requireProfessorReview,
} from "@/lib/auth/authorization";
import { getQuestionLifecycleDashboard } from "@/lib/data/data-store";
import { isProfessorQuestionId } from "@/lib/professor/question-paths";

/**
 * One question's lifecycle: its current fields, where it stands, and every
 * attributed action available to the professor. This is where "View Draft"
 * lands after a save from the AI question intake screen.
 */
export default async function ProfessorQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const questionId = safeDecode(id ?? "").trim();
  const authorization = await requirePageAccess(
    requireProfessorReview,
    `/professor/questions/${encodeURIComponent(questionId)}`,
  );

  // Hand-typed URLs never reach a query: only well-formed stable IDs continue.
  if (!isProfessorQuestionId(questionId)) {
    notFound();
  }

  const dashboard = await getQuestionLifecycleDashboard(authorization);
  const question = dashboard.questions.find(
    (candidate) => candidate.questionId === questionId,
  );
  if (!question) {
    notFound();
  }

  const topicTitle = dashboard.topics.find(
    (topic) => topic.id === question.workingVersion.topicId,
  )?.title;

  return (
    <ProfessorPageShell
      title={question.workingVersion.title}
      description="One question, every immutable version. Edit, approve, publish, or roll back from here; students only ever see a published version."
      aside={
        <Badge variant="outline" className="h-10 gap-2 px-4">
          <ShieldCheck className="h-4 w-4" />
          professor only
        </Badge>
      }
    >
      <ProfessorQuestionDetailSummary
        question={question}
        topicTitle={topicTitle}
      />
      <Card>
        <CardHeader>
          <CardTitle>Question content and lifecycle actions</CardTitle>
          <CardDescription>
            The working version is opened below with every field, the revision
            editor, and the attributed version history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfessorQuestionLifecyclePanel
            focusQuestionId={question.questionId}
            hideBulkControls
            initialDashboard={{ ...dashboard, questions: [question] }}
          />
        </CardContent>
      </Card>
    </ProfessorPageShell>
  );
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
