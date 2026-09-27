"use client";

import { MasteryBar } from "@/components/ui/mastery-chip";
import type { SectionTopicMastery } from "@/lib/courses/selectors";

/**
 * One thin gradient bar per open topic, with the percent beside it. The bar
 * is never the only signal, and no topic is coloured as a verdict: a low
 * number is something to look at, not a grade.
 */
export function TopicMasteryBars({ rows }: { rows: SectionTopicMastery[] }) {
  if (rows.length === 0) {
    return (
      <p className="type-body max-w-prose text-ink-muted">
        No topic is open to this section yet, so there is nothing to measure.
      </p>
    );
  }

  return (
    <ul className="grid gap-x-8 gap-y-3 rounded-panel bg-sheet p-5 md:grid-cols-2 sm:p-6">
      {rows.map((row) => {
        // `sectionProgress` collapses "no attempts" to 0, so 0 is reported as
        // "no data" rather than as a real score a student earned.
        const hasData = row.pct > 0;
        return (
          <li className="flex flex-col gap-1.5" key={row.topicId}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="type-small min-w-0 truncate text-ink">
                {row.label}
              </span>
              <span className="type-mono shrink-0 text-ink-muted">
                {hasData ? `${row.pct}%` : "—"}
              </span>
            </div>
            <MasteryBar
              label={`${row.label}: ${hasData ? `${row.pct}% mastery` : "no attempts yet"}`}
              total={100}
              value={hasData ? row.pct : 0}
            />
          </li>
        );
      })}
    </ul>
  );
}
