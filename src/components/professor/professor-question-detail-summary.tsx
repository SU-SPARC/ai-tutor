"use client";

import Link from "next/link";
import { ClipboardCheck, ListChecks } from "lucide-react";

import { LifecycleBadge } from "@/components/professor/professor-question-lifecycle-panel";
import { QuestionSheet } from "@/components/sheet/question-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  difficultyLabel,
  questionCode,
  studentDifficultyLabel,
} from "@/lib/labels";
import { professorReviewQueuePagePath } from "@/lib/professor/question-paths";
import {
  questionIntakeProvenance,
  questionIntakeSourceLabel,
} from "@/lib/question-intake/provenance";
import { questionReserveReasonLabel } from "@/lib/tutor/professor-question-reserve";
import type { QuestionLifecycleDto, QuestionVersionDto } from "@/lib/types";

/**
 * Plain-language guidance for the professor's next move. Lifecycle enum names
 * stay out of the sentence; the badge next to the title carries the state.
 */
export function professorQuestionNextStep(question: QuestionLifecycleDto) {
  if (question.recordState === "archived") {
    return "This question is archived. Restore the record before making any other change.";
  }
  if (question.reserve) {
    return question.reserve.practiceAllowed
      ? "Saved for later and absent from student listings. It is available only through the controlled optional similar-practice flow."
      : "Saved for later and hidden from students. Remove the reserve when you want to publish it.";
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

/**
 * The header word for how an answer is checked. The spec is optional on older
 * records, and "short answer" is what an unspecified one behaves like.
 */
function answerTypeLabel(version: QuestionVersionDto) {
  switch (version.answer.spec?.kind) {
    case "numeric":
      return "numeric";
    case "categorical":
      return "categorical";
    case "number_list":
      return "number list";
    default:
      return "short answer";
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
    <div className="flex flex-col gap-6">
      {/* The working version in the shape a student meets it, with every hint
          and step already down: what is being decided on is the page, not a
          list of fields describing the page. */}
      <section aria-label="Student view" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-display text-xl font-normal">Student view</h2>
          <p className="text-xs text-muted-foreground">
            The working version, v{working.versionNumber} — not necessarily the
            version students can see.
          </p>
        </div>
        <QuestionSheet
          answer={{
            value: working.answer.acceptedAnswers.join(", "),
            onChange: () => {},
            onCheck: () => {},
            disabled: true,
            helper: "Students see an empty field; this is the accepted answer",
          }}
          header={{
            topicLabel: topicTitle ?? working.topicId,
            questionCode: questionCode(question.questionId),
            answerType: answerTypeLabel(working),
            difficultyLabel: studentDifficultyLabel(working.difficulty),
          }}
          hints={{ total: working.hints.length, revealed: working.hints }}
          prompt={working.prompt}
          steps={{ revealed: working.solutionSteps }}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span>{working.title}</span>
            <LifecycleBadge state={state} />
            {intake ? (
              <Badge variant="warning">
                {questionIntakeSourceLabel(intake)}
              </Badge>
            ) : null}
            {question.reserve ? (
              <Badge variant="secondary">Saved for later</Badge>
            ) : null}
            {question.reserve?.practiceAllowed ? (
              <Badge variant="success">Eligible for similar practice</Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            {professorQuestionNextStep(question)}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="font-medium">Topic</dt>
            <dd>{topicTitle ?? working.topicId}</dd>
            <dt className="font-medium">Difficulty</dt>
            <dd>{difficultyLabel(working.difficulty)}</dd>
            <dt className="font-medium">Working version</dt>
            <dd>
              v{working.versionNumber}, created by{" "}
              {working.createdBy.displayName} on {formatDate(working.createdAt)}
            </dd>
            <dt className="font-medium">Published version</dt>
            <dd>
              {question.publishedVersion
                ? `v${question.publishedVersion.versionNumber} is live for students`
                : question.reserve?.practiceAllowed
                  ? "None. Available only as controlled optional practice."
                  : "None. Students cannot see this question."}
            </dd>
            {question.reserve ? (
              <>
                <dt className="font-medium">Save for later</dt>
                <dd>
                  {questionReserveReasonLabel(question.reserve.reasonCode)} ·{" "}
                  {question.reserve.reservedBy.displayName}
                  {question.reserve.note ? ` · ${question.reserve.note}` : ""}
                  {question.reserve.practiceAllowed
                    ? " · Optional similar practice enabled"
                    : " · Reserve only"}
                </dd>
              </>
            ) : null}
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
    </div>
  );
}
