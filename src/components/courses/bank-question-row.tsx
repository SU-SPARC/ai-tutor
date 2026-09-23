"use client";

import Link from "next/link";
import { CircleMinus, CirclePlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { stateLabel } from "@/lib/courses/format";
import { courseTopicPath } from "@/lib/courses/paths";
import { professorReviewQueuePagePath } from "@/lib/professor/question-paths";
import { releaseBlockReason } from "@/lib/courses/selectors";
import type {
  BankQuestion,
  CourseId,
  Difficulty,
  QuestionLifecycleState,
} from "@/lib/courses/types";
import { cn } from "@/lib/utils";

/** ● pub / ○ appr / ◐ rev / draft / unpub, as the blueprint's right pane reads. */
const STATE_GLYPH: Record<QuestionLifecycleState, string> = {
  published: "●",
  approved: "○",
  needs_review: "◐",
  draft: "○",
  unpublished: "⊘",
};

const STATE_TONE: Record<QuestionLifecycleState, string> = {
  published: "text-success",
  approved: "text-warning",
  needs_review: "text-warning",
  draft: "text-muted-foreground",
  unpublished: "text-destructive",
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  foundational: "foundational",
  core: "core",
  challenge: "challenge",
};

/**
 * Blueprint S3 rule 2: the reason a ⊕ is disabled is never a dead end. It links
 * to the lifecycle step that unblocks it — the review queue for anything still
 * awaiting a decision, the topic page (which owns publish) for everything else.
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

  return (
    <li className="flex items-start gap-2 border-b border-border/60 px-3 py-2 last:border-b-0">
      {blocked ? (
        // aria-disabled rather than `disabled`, so the control stays focusable
        // and hoverable and the professor can still read why it is off.
        <button
          type="button"
          aria-disabled="true"
          aria-label={`Cannot release ${question.title} to ${sectionLabel}: ${blockReason}`}
          onClick={(event) => event.preventDefault()}
          className="mt-0.5 shrink-0 cursor-not-allowed rounded-sm p-0.5 opacity-40 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <CirclePlus className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-label={
            released
              ? `Stage removal of ${question.title} from ${sectionLabel}`
              : `Stage release of ${question.title} to ${sectionLabel}`
          }
          className={cn(
            "mt-0.5 shrink-0 rounded-sm p-0.5 outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
            released
              ? "text-muted-foreground hover:text-foreground"
              : "text-primary hover:text-primary/80",
          )}
        >
          {released ? (
            <CircleMinus className="h-4 w-4" aria-hidden="true" />
          ) : (
            <CirclePlus className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm">{question.title}</span>
          <Badge
            variant="outline"
            className={cn("gap-1", STATE_TONE[question.state])}
          >
            <span aria-hidden="true">{STATE_GLYPH[question.state]}</span>
            {stateLabel(question.state)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            v{question.publishedVersion ?? question.latestVersion}
          </span>
          <span className="text-xs text-muted-foreground">
            {DIFFICULTY_LABELS[question.difficulty]}
          </span>
          {staged ? <Badge variant="secondary">staged</Badge> : null}
        </div>
        {blocked ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            <Link
              href={unblockHref(courseId, question)}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {blockReason}
            </Link>
          </p>
        ) : null}
      </div>
    </li>
  );
}
