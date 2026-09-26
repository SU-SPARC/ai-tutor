"use client";

import Link from "next/link";

import demoQuestionData from "../../../data/demo/questions.json";
import { QuestionStateChip } from "@/components/courses/course-status";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  professorQuestionPath,
  professorReviewQueuePagePath,
} from "@/lib/professor/question-paths";
import { cn } from "@/lib/utils";
import type {
  AnswerType,
  BankQuestion,
  QuestionLifecycleState,
} from "@/lib/courses/types";

/**
 * The legacy editor at `/professor/questions/[qid]` is backed by the eight
 * hand-written demo questions, not by this store's bank. Linking a seeded
 * review candidate there would 404, so only these ids get "Open editor".
 *
 * Local helper: the shared selectors have no notion of "exists in the legacy
 * demo lifecycle", so the id set is read straight from the same JSON the demo
 * repository serves (already in the client bundle via the seed).
 */
export const LEGACY_EDITOR_QUESTION_IDS: ReadonlySet<string> = new Set(
  (demoQuestionData as unknown as { id: string }[]).map(
    (question) => question.id,
  ),
);

export function hasLegacyEditor(questionId: string) {
  return LEGACY_EDITOR_QUESTION_IDS.has(questionId);
}

/** Answer types in words, never the enum. */
export const ANSWER_TYPE_LABELS: Record<AnswerType, string> = {
  numeric: "Numeric",
  categorical: "Categorical",
  expression: "Expression",
};

/**
 * Kept for existing importers: the lifecycle state as the shared StatusChip,
 * so the topic page, the builder and the review queue use one vocabulary.
 */
export function QuestionStateBadge({
  state,
  className,
}: {
  state: QuestionLifecycleState;
  className?: string;
}) {
  return <QuestionStateChip className={className} state={state} />;
}

export type QuestionRow = {
  question: BankQuestion;
  /** Section labels in the current course that currently show this question. */
  releasedTo: string[];
};

export type QuestionActionProps = {
  question: BankQuestion;
  topicId: string;
  onPublish: (questionId: string) => void;
  onPreview: (questionId: string) => void;
  className?: string;
};

/**
 * One question's next move, in the row and again in the preview footer so the
 * professor never has to go back to the table to act on what they just read.
 */
export function QuestionAction({
  question,
  topicId,
  onPublish,
  onPreview,
  className,
}: QuestionActionProps) {
  if (question.state === "approved" || question.state === "unpublished") {
    return (
      <div className={cn("flex flex-col items-end gap-1", className)}>
        <Button
          onClick={() => onPublish(question.id)}
          size="sm"
          type="button"
          variant="secondary"
        >
          {question.state === "approved" ? "Publish" : "Republish"} v
          {question.latestVersion}
        </Button>
        <span className="type-caption">
          {question.state === "approved"
            ? "Publishing makes it releasable"
            : "Republish to make it releasable"}
        </span>
      </div>
    );
  }

  if (question.state === "needs_review") {
    return (
      <Button asChild className={className} size="sm" variant="secondary">
        <Link href={professorReviewQueuePagePath(topicId, question.id)}>
          Review
        </Link>
      </Button>
    );
  }

  if (question.state === "draft") {
    return (
      <span className={cn("type-caption", className)}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">No action while in draft</span>
      </span>
    );
  }

  if (hasLegacyEditor(question.id)) {
    return (
      <Button asChild className={className} size="sm" variant="ghost">
        <Link href={professorQuestionPath(question.id)}>Open editor</Link>
      </Button>
    );
  }

  return (
    <Button
      className={className}
      onClick={() => onPreview(question.id)}
      size="sm"
      type="button"
      variant="ghost"
    >
      Preview
    </Button>
  );
}

/** The just-published confirmation, shown under the action and announced. */
export function PublishedNote({ version }: { version: number }) {
  return (
    <p className="type-caption text-green-700" role="status">
      Published v{version}. It can be released now.
    </p>
  );
}

export function TopicQuestionTable({
  caption,
  rows,
  topicId,
  selectedQuestionId,
  publishedNotes,
  onPublish,
  onPreview,
}: {
  /** Names what the table lists, for screen readers ("Published questions in Bayes"). */
  caption?: string;
  rows: QuestionRow[];
  topicId: string;
  selectedQuestionId: string | null;
  publishedNotes: Record<string, number>;
  onPublish: (questionId: string) => void;
  onPreview: (questionId: string) => void;
}) {
  return (
    <div className="rounded-panel bg-sheet px-2 pb-2">
      <Table>
        {caption ? (
          <TableCaption className="sr-only">{caption}</TableCaption>
        ) : null}
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Question</TableHead>
            <TableHead scope="col">Answer type</TableHead>
            <TableHead scope="col">State</TableHead>
            <TableHead scope="col">Released to</TableHead>
            <TableHead className="text-right" scope="col">
              Action
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell className="py-4 text-ink-muted" colSpan={5}>
                No questions in this topic match this filter.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map(({ question, releasedTo }) => {
            const selected = question.id === selectedQuestionId;
            return (
              <TableRow
                data-state={selected ? "selected" : undefined}
                key={question.id}
              >
                <TableCell className="min-w-56">
                  <button
                    aria-haspopup="dialog"
                    className="rounded-xs text-left text-azure-500 underline-offset-4 hover:text-azure-700 hover:underline focus-ring"
                    onClick={() => onPreview(question.id)}
                    type="button"
                  >
                    {question.title}
                    <span className="sr-only">, open preview</span>
                  </button>
                </TableCell>
                <TableCell className="text-ink-muted">
                  {ANSWER_TYPE_LABELS[question.answerType] ??
                    question.answerType}
                </TableCell>
                <TableCell>
                  <QuestionStateChip state={question.state} />
                </TableCell>
                <TableCell className="text-ink-muted">
                  {releasedTo.length > 0 ? releasedTo.join(", ") : "—"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-end gap-1">
                    <QuestionAction
                      onPreview={onPreview}
                      onPublish={onPublish}
                      question={question}
                      topicId={topicId}
                    />
                    {publishedNotes[question.id] !== undefined ? (
                      <PublishedNote version={publishedNotes[question.id]} />
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
