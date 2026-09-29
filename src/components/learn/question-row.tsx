import Link from "next/link";
import { Archive, ArrowRight, Circle, CircleDot } from "lucide-react";
import { useId } from "react";

import type { LearnQuestionRow } from "@/components/learn/learn-model";
import { questionPositionLabel } from "@/components/learn/learn-model";
import { QuestionSheet } from "@/components/sheet/question-sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

/**
 * Where the student left this question, as an icon and a word. Solved reuses
 * the verdict chip; a question the professor removed is neutral (the student
 * did nothing wrong), and every neutral state carries its own glyph so colour
 * is never the only signal.
 */
function QuestionStatus({ status }: { status: LearnQuestionRow["status"] }) {
  switch (status) {
    case "done":
      return <StatusChip tone="correct" label="Solved" />;
    case "retired":
      return (
        <StatusChip tone="neutral" icon={Archive} label="No longer available" />
      );
    case "current":
      return <StatusChip tone="neutral" icon={CircleDot} label="In progress" />;
    case "todo":
    default:
      return <StatusChip tone="neutral" icon={Circle} label="Not started" />;
  }
}

/**
 * One question as a compact Sheet: position and difficulty on the mono line
 * (never the question code), the title as a real heading, the first two lines
 * of the prompt, and
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
  /** The row the header's call to action opens: a left azure rule and an "Up next" chip. */
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
          // Codes are a support handle, not something a student reads.
          questionCode: "",
          // The Sheet joins these in order: "Question 2 of 5 · Core ·
          // 1 hint used". Difficulty is a word, never a colour.
          answerType: question.difficultyLabel,
          difficultyLabel: hintsUsed,
        }}
        headingLevel={3}
        hints={{ total: 0, revealed: [] }}
        menu={
          <span className="type-caption flex flex-wrap items-center justify-end gap-2 pt-1.5">
            {upNext ? (
              <StatusChip tone="published" icon={ArrowRight} label="Up next" />
            ) : null}
            {/* A removed question says so in the Sheet body ("No longer
                available · removed by your professor"), so the chip would
                only repeat it. */}
            {question.status === "retired" ? null : (
              <QuestionStatus status={question.status} />
            )}
          </span>
        }
        prompt={question.prompt}
        title={question.title}
        tombstone={
          question.status === "retired"
            ? "Removed by your professor · your answers are kept."
            : undefined
        }
      />
    </div>
  );
}
