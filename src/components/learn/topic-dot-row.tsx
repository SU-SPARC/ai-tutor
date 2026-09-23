import Link from "next/link";

import type { LearnQuestionRow } from "@/components/learn/learn-model";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<LearnQuestionRow["status"], string> = {
  current: "in progress",
  done: "done",
  retired: "retired",
  todo: "not started",
};

/**
 * The topic's state in one line. Eleven questions fit where a table of eleven
 * rows would not, and every dot is a link, so the row is also the fastest way
 * into any question in the topic.
 */
export function TopicDotRow({ questions }: { questions: LearnQuestionRow[] }) {
  if (questions.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-wrap items-start gap-2">
      {questions.map((question) => (
        <li key={question.id}>
          <Link
            href={question.href}
            title={`${question.position}. ${question.title}`}
            className="flex w-7 flex-col items-center gap-1 rounded-[6px] py-1 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Dot status={question.status} />
            <span
              aria-hidden="true"
              className="font-mono text-[11px] text-muted-foreground"
            >
              {question.position}
            </span>
            <span className="sr-only">
              {`Question ${question.position}, ${STATUS_LABELS[question.status]}`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Dot({ status }: { status: LearnQuestionRow["status"] }) {
  if (status === "retired") {
    return (
      <span
        aria-hidden="true"
        className="flex size-4 items-center justify-center rounded-full border border-destructive/50 text-[10px] leading-none text-destructive"
      >
        ⊘
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 items-center justify-center rounded-full text-[10px] leading-none",
        status === "done" && "bg-success text-success-foreground",
        status === "current" && "bg-primary text-primary-foreground",
        status === "todo" && "border border-border",
      )}
    >
      {status === "done" ? "✓" : null}
    </span>
  );
}
