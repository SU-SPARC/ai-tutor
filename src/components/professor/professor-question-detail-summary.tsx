import Link from "next/link";
import { ClipboardCheck, ListChecks } from "lucide-react";

import { LifecycleBadge } from "@/components/professor/professor-question-lifecycle-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { difficultyLabel } from "@/lib/labels";
import { professorReviewQueuePagePath } from "@/lib/professor/question-paths";
import {
  questionIntakeProvenance,
  questionIntakeSourceLabel,
} from "@/lib/question-intake/provenance";
import type { QuestionLifecycleDto } from "@/lib/types";

/**
 * Plain-language guidance for the professor's next move. Lifecycle enum names
 * stay out of the sentence; the badge next to the title carries the state.
 */
export function professorQuestionNextStep(question: QuestionLifecycleDto) {
  if (question.recordState === "archived") {
    return "This question is archived. Restore the record before making any other change.";
  }
  switch (question.workingVersion.state) {
    case "draft":
      return "This draft has not been submitted for review yet. Submit it for review below, then approve it. Publishing to students is a separate step.";
    case "needs_review":
      return "Waiting for your review. Check every field below, edit if anything needs fixing, then approve. Publishing to students is a separate step.";
    case "revision_requested":
      return "A revision was requested. Edit the question below to create a new version, then submit it for review.";
    case "approved":
      return "Approved but not published. Students cannot see it until you publish this version.";
    case "published":
      return "Published. Students can practice this exact version while it is available to them.";
    case "unpublished":
      return "Unpublished. Students cannot see it. Publish it again or roll back to a prior version when ready.";
    case "rejected":
      return "Rejected. This version will not be published. Edit it to start a new version if the question is still wanted.";
  }
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function ProfessorQuestionDetailSummary({
  question,
  topicTitle,
}: {
  question: QuestionLifecycleDto;
  topicTitle?: string;
}) {
  const working = question.workingVersion;
  const intake = questionIntakeProvenance(question);
  const state =
    question.recordState === "archived" ? "archived" : working.state;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{working.title}</span>
          <LifecycleBadge state={state} />
          {intake ? (
            <Badge variant="warning">{questionIntakeSourceLabel(intake)}</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>{professorQuestionNextStep(question)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="font-medium">Topic</dt>
          <dd>{topicTitle ?? working.topicId}</dd>
          <dt className="font-medium">Difficulty</dt>
          <dd>{difficultyLabel(working.difficulty)}</dd>
          <dt className="font-medium">Working version</dt>
          <dd>
            v{working.versionNumber}, created by {working.createdBy.displayName}{" "}
            on {formatDate(working.createdAt)}
          </dd>
          <dt className="font-medium">Published version</dt>
          <dd>
            {question.publishedVersion
              ? `v${question.publishedVersion.versionNumber} is live for students`
              : "None. Students cannot see this question."}
          </dd>
          {intake ? (
            <>
              <dt className="font-medium">Saved from</dt>
              <dd>
                {questionIntakeSourceLabel(intake)}
                {intake.model ? ` (${intake.model})` : ""} by{" "}
                {intake.submittedBy} on {formatDate(intake.submittedAt)}
              </dd>
            </>
          ) : null}
          <dt className="font-medium">Question ID</dt>
          <dd className="font-mono text-xs">{question.questionId}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          {working.state === "needs_review" &&
          question.recordState === "active" ? (
            <Button asChild size="sm" variant="outline">
              <Link
                href={professorReviewQueuePagePath(
                  working.topicId,
                  question.questionId,
                )}
              >
                <ClipboardCheck className="h-4 w-4" />
                Open in Review Queue
              </Link>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="ghost">
            <Link href="/professor/questions">
              <ListChecks className="h-4 w-4" />
              All questions
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
