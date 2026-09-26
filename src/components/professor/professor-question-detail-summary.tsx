"use client";

import { useId } from "react";

import {
  professorDifficultyLabel,
  ProfessorTime,
  QuestionStateChip,
  SavedForLaterChip,
} from "@/components/professor/professor-question-labels";
import { QuestionSheet } from "@/components/sheet/question-sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { questionCode, studentDifficultyLabel } from "@/lib/labels";
import {
  questionIntakeProvenance,
  questionIntakeSourceLabel,
} from "@/lib/question-intake/provenance";
import { questionReserveReasonLabel } from "@/lib/tutor/professor-question-reserve";
import type { QuestionLifecycleDto, QuestionVersionDto } from "@/lib/types";

/**
 * Plain-language guidance for the professor's next move. Lifecycle enum names
 * stay out of the sentence; the chip next to the title carries the state.
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

/**
 * Where one question stands (a header block of chips and facts under the
 * page title) and the working version in the shape a student meets it.
 */
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
  const statusHeadingId = useId();
  const sheetHeadingId = useId();

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby={statusHeadingId}
        className="flex flex-col gap-4 rounded-panel bg-surface-tint p-4 sm:p-5"
      >
        <h2 id={statusHeadingId} className="sr-only">
          Where this question stands
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <QuestionStateChip state={state} />
          <span className="font-mono text-ink-muted">
            v{working.versionNumber}
          </span>
          {intake ? (
            <StatusChip
              icon={false}
              label={questionIntakeSourceLabel(intake)}
              tone="neutral"
            />
          ) : null}
          {question.reserve ? (
            <SavedForLaterChip
              practiceAllowed={question.reserve.practiceAllowed}
            />
          ) : null}
          {question.reserve?.practiceAllowed ? (
            <StatusChip
              icon={false}
              label="Eligible for similar practice"
              tone="approved"
            />
          ) : null}
        </div>
        <p className="type-body max-w-prose text-ink">
          {professorQuestionNextStep(question)}
        </p>
        <dl className="grid gap-x-6 gap-y-2 type-small sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="text-ink-muted">Topic</dt>
          <dd className="text-ink">{topicTitle ?? working.topicId}</dd>
          <dt className="text-ink-muted">Difficulty</dt>
          <dd className="text-ink">
            {professorDifficultyLabel(working.difficulty)}
          </dd>
          <dt className="text-ink-muted">Working version</dt>
          <dd className="text-ink">
            v{working.versionNumber}, created by{" "}
            {working.createdBy.displayName} on{" "}
            <ProfessorTime value={working.createdAt} />
          </dd>
          <dt className="text-ink-muted">Published version</dt>
          <dd className="text-ink">
            {question.publishedVersion
              ? `v${question.publishedVersion.versionNumber} is live for students`
              : question.reserve?.practiceAllowed
                ? "None. Available only as controlled optional practice."
                : "None. Students cannot see this question."}
          </dd>
          {question.reserve ? (
            <>
              <dt className="text-ink-muted">Save for later</dt>
              <dd className="text-ink">
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
              <dt className="text-ink-muted">Saved from</dt>
              <dd className="text-ink">
                {questionIntakeSourceLabel(intake)}
                {intake.model ? (
                  <>
                    {" "}
                    (<span className="font-mono">{intake.model}</span>)
                  </>
                ) : null}{" "}
                by {intake.submittedBy} on{" "}
                <ProfessorTime value={intake.submittedAt} />
              </dd>
            </>
          ) : null}
          <dt className="text-ink-muted">Question ID</dt>
          <dd className="break-all font-mono text-ink">
            {question.questionId}
          </dd>
        </dl>
      </section>

      {/* The working version in the shape a student meets it, with every hint
          and step already down: what is being decided on is the page, not a
          list of fields describing the page. */}
      <section
        aria-labelledby={sheetHeadingId}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id={sheetHeadingId} className="type-h2 text-ink">
            Student view
          </h2>
          <p className="type-caption">
            The working version, v{working.versionNumber}; not necessarily the
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
          headingLevel={3}
          hints={{ total: working.hints.length, revealed: working.hints }}
          prompt={working.prompt}
          steps={{ revealed: working.solutionSteps }}
        />
      </section>
    </div>
  );
}
