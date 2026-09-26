"use client";

import Link from "next/link";
import { CircleMinus, CirclePlus, Undo2 } from "lucide-react";

import {
  QuestionStateChip,
  StagedChip,
} from "@/components/courses/course-status";
import { Button } from "@/components/ui/button";
import { courseTopicPath } from "@/lib/courses/paths";
import { professorReviewQueuePagePath } from "@/lib/professor/question-paths";
import { releaseBlockReason } from "@/lib/courses/selectors";
import type {
  BankQuestion,
  CourseId,
  Difficulty,
} from "@/lib/courses/types";

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  foundational: "Foundational",
  core: "Core",
  challenge: "Challenge",
};

/**
 * Blueprint S3 rule 2: the reason a ⊕ is unavailable is never a dead end. It
 * links to the lifecycle step that unblocks it — the review queue for anything
 * still awaiting a decision, the topic page (which owns publish) for
 * everything else.
 */
export function unblockHref(
  courseId: CourseId,
  question: BankQuestion,
): string {
  if (question.state === "needs_review") {
    return professorReviewQueuePagePath(question.topicId, question.id);
  }
  const params = new URLSearchParams({ question: question.id });
  return `${courseTopicPath(courseId, question.topicId)}?${params.toString()}`;
}

export function BankQuestionRow({
  courseId,
  onToggle,
  question,
  released,
  sectionLabel,
  staged,
}: {
  courseId: CourseId;
  onToggle: () => void;
  question: BankQuestion;
  /** Already has an availability row in this section (released or held). */
  released: boolean;
  sectionLabel: string;
  staged: boolean;
}) {
  const blockReason = releaseBlockReason(question);
  const blocked = blockReason !== null && !released;
  const stagedKind = staged ? (released ? "remove" : "add") : null;

  const actionLabel = staged
    ? released
      ? `Undo staged removal of ${question.title} from ${sectionLabel}`
      : `Undo staged release of ${question.title} to ${sectionLabel}`
    : released
      ? `Stage removal of ${question.title} from ${sectionLabel}`
      : `Stage release of ${question.title} to ${sectionLabel}`;

  return (
    <li className="flex items-start gap-2 border-b border-rule px-3 py-2 last:border-b-0">
      {blocked ? (
        // aria-disabled rather than `disabled`, so the control stays focusable
        // and the professor can still hear why it is off.
        <Button
          aria-disabled="true"
          aria-label={`Cannot release ${question.title} to ${sectionLabel}: ${blockReason}`}
          className="shrink-0 text-ink-muted"
          onClick={(event) => event.preventDefault()}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <CirclePlus aria-hidden="true" />
        </Button>
      ) : (
        <Button
          aria-label={actionLabel}
          aria-pressed={staged}
          className={
            released || staged ? "shrink-0 text-ink-muted" : "shrink-0 text-azure-500"
          }
          onClick={onToggle}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {staged ? (
            <Undo2 aria-hidden="true" />
          ) : released ? (
            <CircleMinus aria-hidden="true" />
          ) : (
            <CirclePlus aria-hidden="true" />
          )}
        </Button>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
        <p className="type-small text-ink">{question.title}</p>
        <div className="flex flex-wrap items-center gap-2">
          <QuestionStateChip state={question.state} />
          <span className="type-caption tabular">
            v{question.publishedVersion ?? question.latestVersion}
          </span>
          <span className="type-caption">
            {DIFFICULTY_LABELS[question.difficulty]}
          </span>
          {released && !staged ? (
            <span className="type-caption">In {sectionLabel}</span>
          ) : null}
          {stagedKind ? <StagedChip kind={stagedKind} /> : null}
        </div>
        {blocked ? (
          <Link
            className="type-caption w-fit rounded-xs text-azure-500 underline underline-offset-2 hover:text-azure-700 focus-ring"
            href={unblockHref(courseId, question)}
          >
            {blockReason}
          </Link>
        ) : null}
      </div>
    </li>
  );
}
