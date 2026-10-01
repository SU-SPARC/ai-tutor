"use client";

import { useId } from "react";

import {
  creationMethodLabel,
  olderVisibleVersion,
  professorDifficultyLabel,
  ProfessorTime,
  QuestionStateChip,
  SavedForLaterChip,
  sourceTypeLabel,
} from "@/components/professor/professor-question-labels";
import { QuestionSheet } from "@/components/sheet/question-sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { questionCode, studentDifficultyLabel } from "@/lib/labels";
import {
  questionIntakeProvenance,
  questionIntakeSourceLabel,
} from "@/lib/question-intake/provenance";
import type { QuestionLifecycleDto, QuestionVersionDto } from "@/lib/types";

/**
 * Where the question stands, in one or two plain sentences that always say
 * what students see. Lifecycle names never appear; the chip carries the state.
 */
export function professorQuestionNextStep(question: QuestionLifecycleDto) {
  if (question.recordState === "archived") {
    return "Removed from the question bank. Students can't see it. Choose Put back to use it again.";
  }
  if (question.reserve) {
    return question.reserve.practiceAllowed
      ? "Saved for later. It isn't in the students' question list, but it can be offered as extra practice."
      : "Saved for later. Students can't see it.";
  }
  const older = olderVisibleVersion(question);
  const hidden = older
    ? `Students still see the earlier version ${older.versionNumber}.`
    : "Students can't see it.";
  switch (question.workingVersion.state) {
    case "draft":
      return `Being written. ${hidden} Send it for review when it's ready.`;
    case "needs_review":
      return `Waiting for your review. ${hidden} Check it below, then approve it.`;
    case "revision_requested":
      return `Sent back for changes. ${hidden} Edit the question, then send it for review.`;
    case "approved":
      return `Approved, not yet shown to students. ${older ? hidden : ""}`.trim();
    case "published":
      return "Students can see it.";
    case "unpublished":
      return "Hidden from students. Choose Show to students to show it again.";
    case "rejected":
      return `Rejected. ${hidden} Edit it if you still want to use it.`;
  }
}

/** The state chip plus "Saved for later" when it applies. */
export function ProfessorQuestionStatusChips({
  question,
}: {
  question: QuestionLifecycleDto;
}) {
  const state =
    question.recordState === "archived"
      ? "archived"
      : question.workingVersion.state;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <QuestionStateChip state={state} />
      {question.reserve ? (
        <SavedForLaterChip practiceAllowed={question.reserve.practiceAllowed} />
      ) : null}
    </div>
  );
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

/**
 * The latest version in the shape a student meets it, with every hint and
 * step already down: what is being decided on is the page, not a list of
 * fields describing the page.
 */
export function ProfessorQuestionStudentView({
  question,
  topicTitle,
}: {
  question: QuestionLifecycleDto;
  topicTitle?: string;
}) {
  const working = question.workingVersion;
  const older = olderVisibleVersion(question);
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex max-w-prose flex-col gap-1">
        <h2 id={headingId} className="type-h2 text-ink">
          Student view
        </h2>
        <p className="type-body text-ink">
          {older
            ? `Students see version ${older.versionNumber}. This preview shows your newer version ${working.versionNumber}.`
            : "This is how the question looks to students."}
        </p>
      </div>
      <QuestionSheet
        answer={{
          value: working.answer.acceptedAnswers.join(", "),
          onChange: () => {},
          onCheck: () => {},
          disabled: true,
          helper: "Students see an empty box. This shows the correct answer.",
        }}
        header={{
          topicLabel: topicTitle ?? working.topicId,
          questionCode: questionCode(question.questionId),
          answerType: answerTypeLabel(working),
          difficultyLabel: studentDifficultyLabel(working.difficulty),
        }}
        headingLevel={3}
        hints={{ total: working.hints.length, revealed: working.hints }}
        prompt={working.prompt}
        figure={working.figure}
        steps={{ revealed: working.solutionSteps }}
      />
    </section>
  );
}

/**
 * Identifiers and record-keeping facts, for support requests. Never in the
 * default view: the caller puts this inside a "Technical details" block.
 */
export function ProfessorQuestionTechnicalDetails({
  question,
  topicTitle,
}: {
  question: QuestionLifecycleDto;
  topicTitle?: string;
}) {
  const working = question.workingVersion;
  const intake = questionIntakeProvenance(question);
  return (
    <dl className="grid gap-x-6 gap-y-2 type-body sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="text-ink-muted">Topic</dt>
      <dd className="text-ink">{topicTitle ?? working.topicId}</dd>
      <dt className="text-ink-muted">Difficulty</dt>
      <dd className="text-ink">
        {professorDifficultyLabel(working.difficulty)}
      </dd>
      <dt className="text-ink-muted">Latest version</dt>
      <dd className="text-ink">
        Version {working.versionNumber} of {question.versions.length},{" "}
        {creationMethodLabel(working.creationMethod).toLowerCase()} (
        {working.createdBy.displayName},{" "}
        <ProfessorTime value={working.createdAt} />)
      </dd>
      <dt className="text-ink-muted">Where it came from</dt>
      <dd className="text-ink">{sourceTypeLabel(working.source.sourceType)}</dd>
      {intake ? (
        <>
          <dt className="text-ink-muted">Added with</dt>
          <dd className="flex flex-wrap items-center gap-2 text-ink">
            <StatusChip
              icon={false}
              label={questionIntakeSourceLabel(intake)}
              tone="neutral"
            />
            <span>
              {intake.model ? (
                <>
                  <span className="font-mono">{intake.model}</span>,{" "}
                </>
              ) : null}
              by {intake.submittedBy} on{" "}
              <ProfessorTime value={intake.submittedAt} />
            </span>
          </dd>
        </>
      ) : null}
      <dt className="text-ink-muted">Question ID</dt>
      <dd className="break-all font-mono text-ink">{question.questionId}</dd>
      <dt className="text-ink-muted">Question code</dt>
      <dd className="font-mono text-ink">
        {questionCode(question.questionId)}
      </dd>
    </dl>
  );
}
