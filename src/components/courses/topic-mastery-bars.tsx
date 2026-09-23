"use client";

import { Progress } from "@/components/ui/progress";
import type { SectionTopicMastery } from "@/lib/courses/selectors";
import { cn } from "@/lib/utils";

/**
 * Mastery is read as a traffic light before it is read as a number: green is
 * fine, amber needs a look, red needs a lesson.
 */
function tone(pct: number) {
  if (pct >= 75) {
    return { text: "text-success", bar: "bg-success" };
  }
  if (pct >= 50) {
    return { text: "text-warning", bar: "bg-warning" };
  }
  return { text: "text-destructive", bar: "bg-destructive" };
}

export function TopicMasteryBars({ rows }: { rows: SectionTopicMastery[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No topic is open to this section yet, so there is nothing to measure.
      </p>
    );
  }

  return (
    <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
      {rows.map((row) => {
        // `sectionProgress` collapses "no attempts" to 0, so 0 is reported as
        // "no data" rather than as a real score a student earned.
        const hasData = row.pct > 0;
        const { text, bar } = tone(row.pct);
        return (
          <div className="flex flex-col gap-1.5" key={row.topicId}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm leading-6">{row.label}</span>
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  hasData ? text : "text-muted-foreground",
                )}
              >
                {hasData ? `${row.pct}%` : "—"}
              </span>
            </div>
            <Progress
              aria-label={`${row.label} mastery`}
              indicatorClassName={hasData ? bar : "bg-muted-foreground/30"}
              value={row.pct}
            />
          </div>
        );
      })}
    </div>
  );
}
