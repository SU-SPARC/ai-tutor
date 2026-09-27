import Link from "next/link";

import type {
  ContinueCard as ContinueCardModel,
  LearnQuestionRow,
} from "@/components/learn/learn-model";
import { questionPositionLabel } from "@/components/learn/learn-model";
import { QuestionSheet } from "@/components/sheet/question-sheet";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * The one card on the page: the next question as a compact Sheet (the only
 * raised surface here), with one call to action and the alternative sitting
 * quietly beside it. No progress ring, no streak, no second Continue.
 *
 * `question` is the syllabus row the card points at (looked up by its href)
 * so the card can show the prompt and "Question 2 of 5"; `positionTotal` is
 * the number of questions in that row's topic.
 */
export function ContinueCard({
  card,
  positionTotal,
  question,
}: {
  card: ContinueCardModel;
  positionTotal?: number;
  question?: LearnQuestionRow;
}) {
  if (card.kind === "empty") {
    return <EmptyState className="py-2">{card.message}</EmptyState>;
  }

  const positionLabel =
    question && positionTotal
      ? questionPositionLabel(question.position, positionTotal)
      : undefined;

  return (
    <div
      data-slot="continue-card"
      className="sheet-shadow flex flex-col overflow-hidden rounded-panel bg-sheet text-sheet-foreground"
    >
      <QuestionSheet
        compact
        className="rounded-none bg-transparent pb-0 sm:pb-0"
        header={{
          topicLabel: card.eyebrow ?? "",
          positionLabel,
          questionCode: "",
          answerType: "",
        }}
        headingLevel={3}
        hints={{ total: 0, revealed: [] }}
        prompt={question?.prompt ?? ""}
        title={card.questionTitle}
      />

      <div className="flex flex-col gap-4 px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
        {card.detail ? (
          <p className="type-small tabular text-ink-muted">{card.detail}</p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          {card.primary ? (
            <Button
              asChild
              variant="cta"
              size="lg"
              className="w-full sm:w-auto"
            >
              <Link href={card.primary.href}>{card.primary.label}</Link>
            </Button>
          ) : null}
          {card.secondary ? (
            <Button
              asChild
              variant="ghost"
              size="lg"
              className="w-full text-azure-500 hover:text-azure-700 sm:w-auto"
            >
              <Link href={card.secondary.href}>{card.secondary.label}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
