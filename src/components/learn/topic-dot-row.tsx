import Link from "next/link";
import { Check, Circle, CircleDot, CircleSlash } from "lucide-react";

import type { LearnQuestionRow } from "@/components/learn/learn-model";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<LearnQuestionRow["status"], string> = {
  current: "in progress",
  done: "solved",
  retired: "no longer available",
  todo: "not started",
};

/**
 * The topic's state in one line: every question as a 44px target with its
 * glyph and number, so the row is also the fastest way into any question.
 * The glyphs match the syllabus rail (filled check, dot, ring, slash), so
 * colour is never the only signal.
 */
export function TopicDotRow({ questions }: { questions: LearnQuestionRow[] }) {
  if (questions.length === 0) {
    return null;
  }

  return (
    <ul aria-label="Jump to a question" className="flex flex-wrap gap-1">
      {questions.map((question) => (
        <li key={question.id}>
          <Link
            href={question.href}
            title={`${question.position}. ${question.title}`}
            className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-control px-1 transition-colors duration-fast ease-out hover:bg-hover focus-ring"
          >
            <Dot status={question.status} />
            <span aria-hidden="true" className="type-caption tabular">
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
  const className = "size-4 shrink-0";

  switch (status) {
    case "done":
      return (
        <span
          aria-hidden="true"
          className={cn(
            className,
            "inline-flex items-center justify-center rounded-full bg-green-500 text-on-fill",
          )}
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      );
    case "current":
      return (
        <CircleDot aria-hidden="true" className={cn(className, "text-azure-500")} />
      );
    case "retired":
      return (
        <CircleSlash aria-hidden="true" className={cn(className, "text-ink-muted")} />
      );
    case "todo":
    default:
      return (
        <Circle aria-hidden="true" className={cn(className, "text-ink-muted")} />
      );
  }
}
