"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { QuestionStateChip } from "@/components/courses/course-status";
import { Button } from "@/components/ui/button";
import { courseTopicPath } from "@/lib/courses/paths";
import { professorReviewQueuePagePath } from "@/lib/professor/question-paths";
import { releaseBlockReason } from "@/lib/courses/selectors";
import type {
  BankQuestion,
  CourseId,
  Difficulty,
} from "@/lib/courses/types";

/** One difficulty vocabulary across the courses screens. */
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  foundational: "Intro",
  core: "Core",
  challenge: "Challenge",
};

/**
 * The reason a question cannot be added is never a dead end when there is
 * something to do: "Not approved yet: review it" goes to the review queue,
 * "Approved: make it ready" to the week's page, which owns "Make ready to
 * use". A draft has no step here, so its reason is plain text.
 */
export function unblockHref(
  courseId: CourseId,
  question: BankQuestion,
): string | null {
  if (question.state === "draft") {
    return null;
  }
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
  /** Already shown to this section (or paused there). */
  released: boolean;
  /** Already in words: "Section 1". */
  sectionLabel: string;
  staged: boolean;
}) {
  const blockReason = releaseBlockReason(question);
  const blocked = blockReason !== null && !released;
  const href = blocked ? unblockHref(courseId, question) : null;

  let action: ReactNode = null;
  if (!blocked) {
    if (staged && !released) {
      action = (
        <div className="flex flex-wrap items-center gap-2">
          <span className="type-body-strong text-ink">Added ✓</span>
          <Button
            aria-label={`Undo adding ${question.title} to ${sectionLabel}`}
            className="min-h-11"
            onClick={onToggle}
            type="button"
            variant="outline"
          >
            Undo
          </Button>
        </div>
      );
    } else if (staged && released) {
      action = (
        <Button
          aria-label={`Undo remove: keep ${question.title} for ${sectionLabel}`}
          className="min-h-11"
          onClick={onToggle}
          type="button"
          variant="outline"
        >
          Undo remove
        </Button>
      );
    } else if (released) {
      action = (
        <Button
          aria-label={`Remove ${question.title} from ${sectionLabel}`}
          className="min-h-11"
          onClick={onToggle}
          type="button"
          variant="outline"
        >
          Remove
        </Button>
      );
    } else {
      action = (
        <Button
          aria-label={`Add ${question.title} for ${sectionLabel}`}
          className="min-h-11"
          onClick={onToggle}
          type="button"
          variant="secondary"
        >
          Add
        </Button>
      );
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-rule px-3 py-2 last:border-b-0">
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
        <p className="type-body text-ink">{question.title}</p>
        <div className="flex flex-wrap items-center gap-2">
          <QuestionStateChip state={question.state} />
          <span className="type-small text-ink-muted">
            {DIFFICULTY_LABELS[question.difficulty]}
          </span>
          {released && !staged ? (
            <span className="type-small text-ink">
              Shown to {sectionLabel}
            </span>
          ) : null}
          {staged ? (
            <span className="type-small text-ink">
              {released ? "Will hide" : "Will show"} (not saved yet)
            </span>
          ) : null}
        </div>
        {blocked && blockReason ? (
          href ? (
            <Link
              className="type-small inline-flex min-h-11 w-fit items-center rounded-xs text-azure-500 underline underline-offset-2 hover:text-azure-700 focus-ring"
              href={href}
            >
              {blockReason}
            </Link>
          ) : (
            <p className="type-small text-ink">{blockReason}</p>
          )
        ) : null}
      </div>
      {action}
    </li>
  );
}
