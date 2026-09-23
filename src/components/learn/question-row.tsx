import Link from "next/link";

import type { LearnQuestionRow } from "@/components/learn/learn-model";
import { QuestionSheet } from "@/components/sheet/question-sheet";
import { cn } from "@/lib/utils";

const STATUS_WORDS: Record<LearnQuestionRow["status"], string | undefined> = {
  current: "in progress",
  done: "done",
  retired: "retired",
  todo: undefined,
};

/**
 * One question as a collapsed Sheet: position, code, the first two lines of
 * the prompt, and the three facts a student can act on — how hard it is, how
 * much help is there, and where they left it. No section first-try
 * percentage: that number does not exist for students in this demo, and a
 * made-up one would be worse than silence.
 */
export function QuestionRow({ question }: { question: LearnQuestionRow }) {
  const status = STATUS_WORDS[question.status];
  const meta = [
    question.difficultyLabel,
    question.hintCount > 0
      ? `${question.hintCount} hint${question.hintCount === 1 ? "" : "s"}`
      : undefined,
    status,
  ].filter((part): part is string => Boolean(part));

  return (
    <Link
      href={question.href}
      className={cn(
        "block overflow-hidden rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        question.status === "current" && "border-l-2 border-primary",
      )}
    >
      <QuestionSheet
        compact
        className="rounded-none pb-3 sm:pb-3"
        header={{
          topicLabel: String(question.position),
          questionCode: question.questionCode,
          answerType: "",
        }}
        hints={{ total: 0, revealed: [] }}
        prompt={question.prompt}
        tombstone={
          question.status === "retired" ? "Your attempts are kept." : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-sheet px-4 pt-0 pb-4 sm:px-5">
        <p className="font-mono text-xs text-muted-foreground">
          {meta.join(" · ")}
        </p>
        <span className="ml-auto text-sm text-primary">Open →</span>
      </div>
    </Link>
  );
}
