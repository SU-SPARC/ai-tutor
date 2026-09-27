import Link from "next/link";
import type { ReactNode } from "react";

import type { LearnTopicRow } from "@/components/learn/learn-model";
import {
  topicMasteryLevel,
  weekLabel,
} from "@/components/learn/learn-model";
import { EmptyState } from "@/components/ui/empty-state";
import { MasteryBar, MasteryChip } from "@/components/ui/mastery-chip";
import { cn } from "@/lib/utils";

/**
 * The syllabus, read rather than navigated: one row per week with the topic,
 * its mastery level in words, a thin bar and the solved fraction. A topic
 * with nothing published keeps its row and its week so the numbering never
 * skips; it says so, stays muted, and is not a link. The row the student is
 * working in carries a left azure rule and "You are here".
 */
export function SyllabusList({
  emptyAction,
  emptyMessage,
  topics,
}: {
  /** Shown with `emptyMessage` when a search or filter hides every row. */
  emptyAction?: ReactNode;
  emptyMessage: string;
  topics: LearnTopicRow[];
}) {
  if (topics.length === 0) {
    return <EmptyState action={emptyAction}>{emptyMessage}</EmptyState>;
  }

  return (
    <ol className="flex flex-col divide-y divide-rule border-y border-rule">
      {topics.map((topic) => (
        <li key={topic.id}>
          <SyllabusRow topic={topic} />
        </li>
      ))}
    </ol>
  );
}

const ROW_GRID =
  "grid grid-cols-[3.5rem_minmax(0,1fr)] items-baseline gap-x-3 border-l-2 py-3 pr-3 pl-3 sm:grid-cols-[4rem_minmax(0,1fr)]";

function SyllabusRow({ topic }: { topic: LearnTopicRow }) {
  const closed = topic.total === 0;
  const level = topicMasteryLevel(topic);

  const week = (
    <span aria-hidden="true" className="type-mono text-ink-muted">
      {weekLabel(topic.weekNumber)}
    </span>
  );

  if (closed) {
    return (
      <div className={cn(ROW_GRID, "border-transparent")}>
        {week}
        <div className="flex min-w-0 flex-col gap-1">
          <p className="type-body text-ink-muted">
            <span className="sr-only">{`Week ${topic.weekNumber}: `}</span>
            {topic.title}
          </p>
          <p className="type-small text-ink-muted">{topic.meta}</p>
        </div>
      </div>
    );
  }

  return (
    <Link
      href={topic.href}
      aria-current={topic.isCurrent ? "step" : undefined}
      className={cn(
        ROW_GRID,
        "focus-ring transition-colors duration-fast ease-out hover:bg-hover",
        topic.isCurrent ? "border-azure-500" : "border-transparent",
      )}
    >
      {week}
      <span className="flex min-w-0 flex-col gap-2">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="type-body-strong min-w-0 text-ink">
            <span className="sr-only">{`Week ${topic.weekNumber}: `}</span>
            {topic.title}
          </span>
          {topic.isCurrent ? (
            <span className="type-label whitespace-nowrap text-azure-500">
              You are here
            </span>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {level !== undefined ? (
            <MasteryChip level={level} />
          ) : null}
          <span aria-hidden="true" className="flex min-w-16 flex-1 sm:max-w-48">
            <MasteryBar value={topic.solved} total={topic.total} />
          </span>
          <span className="type-small tabular text-ink-muted">
            {`${topic.solved} of ${topic.total}`}
            <span className="sr-only"> solved</span>
          </span>
        </span>
      </span>
    </Link>
  );
}
