"use client";

/**
 * The Sheet footer: ‹ Previous · one pip per question in the topic · Next ›.
 *
 * It exists so a student can move through a topic with the rail collapsed or
 * absent (the phone case). Each pip is a button named "Question 3 of 8"; on
 * phones, where eight 44px pips do not fit, the pips give way to Previous and
 * Next alone (the back bar above the Sheet reads "‹ Question 3 of 8 ›" and
 * holds the jump list). "Next" is always the adjacent question; Alt + ← / →
 * does the same from anywhere on the page outside a text field.
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

/** "Question 5 of 11": the position in words, everywhere it is shown. */
export function practicePositionText(index: number, total: number) {
  return `Question ${index + 1} of ${total}`;
}

/** The keyboard shortcuts for Previous / Next (`aria-keyshortcuts`). */
export const PREVIOUS_SHORTCUT = "Alt+ArrowLeft";
export const NEXT_SHORTCUT = "Alt+ArrowRight";

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
      data-tour="practice-nav"
      className="flex flex-col gap-1"
    >
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-2 pointer-coarse:h-11"
          disabled={disabled || !previous}
          onClick={() => previous && onSelect(previous.id)}
          aria-label={
            previous ? `Previous question: ${previous.title}` : undefined
          }
          aria-keyshortcuts={PREVIOUS_SHORTCUT}
        >
          <ChevronLeft aria-hidden="true" />
          Previous
        </Button>

        {/* Phones: the position lives in the back bar above the Sheet. */}
        <span aria-hidden="true" className="min-w-0 flex-1 sm:hidden" />

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
          className="px-2 pointer-coarse:h-11"
          disabled={disabled || !next}
          onClick={() => next && onSelect(next.id)}
          aria-label={next ? `Next question: ${next.title}` : undefined}
          aria-keyshortcuts={NEXT_SHORTCUT}
        >
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <p
        aria-hidden="true"
        className="type-caption hidden text-center pointer-fine:block"
      >
        Alt + ← / → moves between questions
      </p>
    </nav>
  );
}
