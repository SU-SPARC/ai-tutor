"use client";

import Link from "next/link";

import demoQuestionData from "../../../data/demo/questions.json";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { stateLabel } from "@/lib/courses/format";
import {
  professorQuestionPath,
  professorReviewQueuePagePath,
} from "@/lib/professor/question-paths";
import { cn } from "@/lib/utils";
import type { BankQuestion, QuestionLifecycleState } from "@/lib/courses/types";

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

type StateGlyph = { glyph: string; tone: string };

/**
 * The dot is the state, the colour is how close the question is to a student:
 * published is live, approved and needs-review are waiting on a gate,
 * unpublished is content that was pulled back.
 */
const STATE_GLYPHS: Record<QuestionLifecycleState, StateGlyph> = {
  published: { glyph: "●", tone: "text-success" },
  approved: { glyph: "○", tone: "text-warning" },
  needs_review: { glyph: "◐", tone: "text-warning" },
  draft: { glyph: "○", tone: "text-muted-foreground" },
  unpublished: { glyph: "●", tone: "text-destructive" },
};

export function QuestionStateBadge({
  state,
  className,
}: {
  state: QuestionLifecycleState;
  className?: string;
}) {
  const { glyph, tone } = STATE_GLYPHS[state];
  return (
    <Badge variant="outline" className={cn("gap-1.5", className)}>
      <span aria-hidden className={tone}>
        {glyph}
      </span>
      {stateLabel(state)}
    </Badge>
  );
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
 * One question's next move, in the row and again in the drawer footer so the
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
      <div className={cn("flex flex-col items-start gap-1", className)}>
        <Button
          className="border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
          onClick={() => onPublish(question.id)}
          size="sm"
          variant="outline"
        >
          Publish
        </Button>
        <span className="text-xs text-muted-foreground">
          {question.state === "approved"
            ? "Approved — publishing makes it releasable"
            : "Unpublished — republish to make it releasable"}
        </span>
      </div>
    );
  }

  if (question.state === "needs_review") {
    return (
      <Button asChild className={className} size="sm" variant="outline">
        <Link href={professorReviewQueuePagePath(topicId, question.id)}>
          Review
        </Link>
      </Button>
    );
  }

  if (question.state === "draft") {
    return (
      <span className={cn("text-sm text-muted-foreground", className)}>
        Draft
      </span>
    );
  }

  if (hasLegacyEditor(question.id)) {
    return (
      <Button asChild className={className} size="sm" variant="outline">
        <Link href={professorQuestionPath(question.id)}>Open editor</Link>
      </Button>
    );
  }

  return (
    <Button
      className={className}
      onClick={() => onPreview(question.id)}
      size="sm"
      variant="outline"
    >
      Preview
    </Button>
  );
}

/** The just-published confirmation, shown inline under the row's action. */
export function PublishedNote({ version }: { version: number }) {
  return (
    <p className="mt-1 text-xs text-success">
      Published v{version} — now releasable
    </p>
  );
}

export function TopicQuestionTable({
  rows,
  topicId,
  selectedQuestionId,
  publishedNotes,
  onPublish,
  onPreview,
}: {
  rows: QuestionRow[];
  topicId: string;
  selectedQuestionId: string | null;
  publishedNotes: Record<string, number>;
  onPublish: (questionId: string) => void;
  onPreview: (questionId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-xs">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-4">Question</TableHead>
            <TableHead className="px-4">Answer type</TableHead>
            <TableHead className="px-4">State</TableHead>
            <TableHead className="px-4">Released to</TableHead>
            <TableHead className="px-4 text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                className="px-4 py-6 text-sm text-muted-foreground"
                colSpan={5}
              >
                No questions match this filter.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map(({ question, releasedTo }) => {
            const selected = question.id === selectedQuestionId;
            return (
              <TableRow
                key={question.id}
                className={cn(selected && "bg-muted/60")}
                data-state={selected ? "selected" : undefined}
              >
                <TableCell className="px-4 py-3">
                  <button
                    aria-label={`Preview ${question.title}`}
                    className="rounded-sm text-left font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    onClick={() => onPreview(question.id)}
                    type="button"
                  >
                    {question.title}
                  </button>
                </TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">
                  {question.answerType}
                </TableCell>
                <TableCell className="px-4 py-3">
                  <QuestionStateBadge state={question.state} />
                </TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">
                  {releasedTo.length > 0 ? releasedTo.join(", ") : "—"}
                </TableCell>
                <TableCell className="px-4 py-3">
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
