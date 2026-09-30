import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import type { LearnTopicRow } from "@/components/learn/learn-model";
import {
  MASTERY_LEVEL_TITLES,
  topicMasteryLevel,
  weekLabel,
} from "@/components/learn/learn-model";
import { EmptyState } from "@/components/ui/empty-state";
import { MasteryBar, MasteryChip } from "@/components/ui/mastery-chip";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

/**
 * The syllabus, read rather than navigated: one row per week ("Week 3") with
 * the topic, its mastery level in words, a thin bar and "2 of 6 solved". A
 * topic with nothing published keeps its row and its week so the numbering
 * never skips; it says so, stays muted, and is not a link. The row the
 * student is working in carries a left azure rule and an "Up next" chip.
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
  "grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-3 border-l-2 py-3 pr-3 pl-3 sm:grid-cols-[5rem_minmax(0,1fr)]";

function SyllabusRow({ topic }: { topic: LearnTopicRow }) {
  const closed = topic.total === 0;
  const level = topicMasteryLevel(topic);

  // The week is printed once, in words, and read once: no hidden duplicate.
  const week = (
    <span className="type-mono whitespace-nowrap text-ink-muted">
      {weekLabel(topic.weekNumber)}
    </span>
  );

  if (closed) {
    return (
      <div className={cn(ROW_GRID, "border-transparent")}>
        {week}
        <div className="flex min-w-0 flex-col gap-1">
          <p className="type-body text-ink-muted">{topic.title}</p>
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
            {topic.title}
          </span>
          {topic.isCurrent ? (
            <StatusChip tone="published" icon={ArrowRight} label="Up next" />
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {level !== undefined ? (
            <MasteryChip level={level} title={MASTERY_LEVEL_TITLES[level]} />
          ) : null}
          <span aria-hidden="true" className="flex min-w-16 flex-1 sm:max-w-48">
            <MasteryBar value={topic.solved} total={topic.total} />
          </span>
          <span className="type-small tabular whitespace-nowrap text-ink-muted">
            <span>{`${topic.solved} of ${topic.total}`}</span> solved
          </span>
        </span>
      </span>
    </Link>
  );
}
