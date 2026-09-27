"use client";

/**
 * The Sheet footer: ‹ Previous · one pip per question in the topic · Next ›.
 *
 * It exists so a student can move through a topic with the rail collapsed or
 * absent (the phone case). Each pip is a button named "Question 3 of 8"; on
 * phones, where eight 44px pips do not fit, the pips give way to that same
 * position in words (the back bar above the Sheet has the jump list).
 */

import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  PracticeGlyph,
  practiceRailGlyph,
} from "@/components/tutor/practice-rail";
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
      className="flex items-center gap-2"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="px-2"
        disabled={disabled || !previous}
        onClick={() => previous && onSelect(previous.id)}
        aria-label={previous ? `Previous question: ${previous.title}` : undefined}
      >
        <ChevronLeft aria-hidden="true" />
        Previous
      </Button>

      <p className="type-small min-w-0 flex-1 text-center text-ink-muted tabular sm:hidden">
        {`Question ${index + 1} of ${questions.length}`}
      </p>

      <ol className="hidden min-w-0 flex-1 flex-wrap items-center justify-center gap-1 sm:flex">
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
                title={`${position + 1}. ${question.title}`}
                disabled={disabled}
                onClick={() => onSelect(question.id)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-control transition-colors duration-fast focus-ring pointer-coarse:size-11 disabled:opacity-50",
                  current ? "bg-azure-100" : "hover:bg-hover",
                )}
              >
                <PracticeGlyph
                  glyph={practiceRailGlyph({ selected: current, solved })}
                />
              </button>
            </li>
          );
        })}
      </ol>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="px-2"
        disabled={disabled || !next}
        onClick={() => next && onSelect(next.id)}
        aria-label={next ? `Next question: ${next.title}` : undefined}
      >
        Next
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}
