import Link from "next/link";
import { Circle, CircleDot } from "lucide-react";
import { useId } from "react";

import type { LearnQuestionRow } from "@/components/learn/learn-model";
import { questionPositionLabel } from "@/components/learn/learn-model";
import { QuestionSheet } from "@/components/sheet/question-sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

/**
 * Where the student left this question, as an icon and a word. Retired and
 * solved reuse the product's verdict and lifecycle chips; the two neutral
 * states carry their own glyphs so colour is never the only signal.
 */
function QuestionStatus({ status }: { status: LearnQuestionRow["status"] }) {
  switch (status) {
    case "done":
      return <StatusChip tone="correct" label="Solved" />;
    case "retired":
      return <StatusChip tone="retired" label="Retired" />;
    case "current":
      return <StatusChip tone="neutral" icon={CircleDot} label="In progress" />;
    case "todo":
    default:
      return <StatusChip tone="neutral" icon={Circle} label="Not started" />;
  }
}

/**
 * One question as a compact Sheet: position, code and difficulty on the mono
 * line, the title as a real heading, the first two lines of the prompt, and
 * where the student left it. The whole card is one link whose accessible name
 * is the question title only (not the KaTeX prompt), so a screen reader lists
 * "Spinner and Coin Condition, link" once per row.
 *
 * No section first-try percentage: that number does not exist for students,
 * and a made-up one would be worse than silence.
 */
export function QuestionRow({
  question,
  topicTotal,
  upNext = false,
}: {
  question: LearnQuestionRow;
  /** Questions in this topic, for "Question 2 of 5". */
  topicTotal: number;
  /** The row the header's call to action opens: a left azure rule. */
  upNext?: boolean;
}) {
  const labelId = useId();
  const hintsUsed =
    question.hintsUsed > 0
      ? `${question.hintsUsed} hint${question.hintsUsed === 1 ? "" : "s"} used`
      : undefined;

  return (
    <div className="group relative">
      <Link
        href={question.href}
        aria-labelledby={labelId}
        className="absolute inset-0 z-10 rounded-panel focus-ring"
      >
        <span id={labelId} hidden>
          {question.title}
        </span>
      </Link>
      <QuestionSheet
        compact
        className={cn(
          "border-l-2 ring-1 ring-transparent transition-shadow duration-fast ease-out group-hover:ring-input",
          upNext ? "border-azure-500" : "border-transparent",
        )}
        header={{
          topicLabel: questionPositionLabel(question.position, topicTotal),
          questionCode: question.questionCode,
          // The Sheet joins these in order: "Question 2 of 5 · Q-A638 ·
          // Core · 1 hint used". Difficulty is a word, never a colour.
          answerType: question.difficultyLabel,
          difficultyLabel: hintsUsed,
        }}
        headingLevel={3}
        hints={{ total: 0, revealed: [] }}
        menu={
          <span className="type-caption flex items-center gap-3 pt-1.5">
            {upNext ? (
              <span className="type-label sr-only text-azure-500 sm:not-sr-only">
                Up next
              </span>
            ) : null}
            <QuestionStatus status={question.status} />
          </span>
        }
        prompt={question.prompt}
        title={question.title}
        tombstone={
          question.status === "retired" ? "Your attempts are kept." : undefined
        }
      />
    </div>
  );
}
