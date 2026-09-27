import type { Glance } from "@/components/learn/learn-model";
import { solvedCountLabel } from "@/components/learn/learn-model";
import { MasteryBar } from "@/components/ui/mastery-chip";
import { cn } from "@/lib/utils";

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/**
 * Two honest records: how much of the published course is solved, split by
 * the course's own difficulty words, and which days this month had practice.
 * The calendar is a calendar — no streak, no "best run", no countdown.
 */
export function AtAGlance({ glance }: { glance: Glance }) {
  const activeDays = glance.calendar.days
    .filter((day) => day.active)
    .map((day) => day.day);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="type-body-strong tabular text-ink">
          {solvedCountLabel(glance.solved, glance.total)}
        </p>
        <span aria-hidden="true" className="flex">
          <MasteryBar value={glance.solved} total={glance.total} />
        </span>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
          {glance.breakdown.map((row) => (
            <div key={row.label} className="contents">
              <dt className="type-small text-ink-muted">{row.label}</dt>
              <dd className="type-small tabular text-ink">
                {row.total > 0 ? `${row.solved} of ${row.total}` : "none yet"}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="type-label">
          {`Practice days · ${glance.calendar.monthLabel}`}
        </h3>
        <div
          className="grid w-fit grid-cols-7 gap-1"
          role="img"
          aria-label={
            activeDays.length > 0
              ? `Days practiced in ${glance.calendar.monthLabel}: ${activeDays.join(", ")}`
              : `No practice yet in ${glance.calendar.monthLabel}`
          }
        >
          {WEEKDAY_LETTERS.map((letter, index) => (
            <span
              key={`weekday-${index}`}
              aria-hidden="true"
              className="type-caption flex size-8 items-center justify-center"
            >
              {letter}
            </span>
          ))}
          {Array.from({ length: glance.calendar.leadingBlanks }, (_, index) => (
            <span
              key={`blank-${index}`}
              aria-hidden="true"
              className="size-8"
            />
          ))}
          {glance.calendar.days.map((day) => (
            <span
              key={day.day}
              aria-hidden="true"
              className={cn(
                "type-caption tabular flex size-8 items-center justify-center rounded-control",
                day.active ? "bg-azure-500 text-on-fill" : "text-ink-muted",
              )}
            >
              {day.day}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
