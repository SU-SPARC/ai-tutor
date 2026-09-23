"use client";

/**
 * The Sheet footer: ‹ Prev · one pip per question in the topic · "5/11" · Next ›.
 *
 * It exists so a student can move through a topic with the rail collapsed or
 * absent (the phone case), and so position is always legible without counting
 * rows.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PracticeFooterQuestion = {
  id: string;
  title: string;
};

/** "5/11" — mono, tabular, always the same width as it counts up. */
export function practicePositionText(index: number, total: number) {
  return `${index + 1}/${total}`;
}

type PracticeFooterProps = {
  disabled?: boolean;
  onSelect: (questionId: string) => void;
  questions: PracticeFooterQuestion[];
  selectedQuestionId?: string;
  solvedQuestionIds: ReadonlySet<string>;
};

export function PracticeFooter({
  disabled = false,
  onSelect,
  questions,
  selectedQuestionId,
  solvedQuestionIds,
}: PracticeFooterProps) {
  const index = questions.findIndex(
    (question) => question.id === selectedQuestionId,
  );

  if (questions.length === 0 || index < 0) {
    return null;
  }

  const previous = questions[index - 1];
  const next = questions[index + 1];

  return (
    <nav
      aria-label="Questions in this topic"
      data-slot="practice-footer"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/50 pt-4"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="rounded-[6px] px-2"
        disabled={disabled || !previous}
        onClick={() => previous && onSelect(previous.id)}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Prev
      </Button>

      <ol className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-0.5">
        {questions.map((question, position) => {
          const current = position === index;
          const solved = solvedQuestionIds.has(question.id);
          return (
            <li key={question.id}>
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                aria-label={`Question ${position + 1} of ${questions.length}${
                  solved ? " (solved)" : ""
                }: ${question.title}`}
                disabled={disabled}
                onClick={() => onSelect(question.id)}
                className={cn(
                  "flex size-5 items-center justify-center rounded-full font-mono text-[11px] leading-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
                  current
                    ? "text-primary"
                    : solved
                      ? "text-success"
                      : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span aria-hidden="true">
                  {current ? "●" : solved ? "✓" : "○"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {practicePositionText(index, questions.length)}
      </span>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="rounded-[6px] px-2"
        disabled={disabled || !next}
        onClick={() => next && onSelect(next.id)}
      >
        Next
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
    </nav>
  );
}
