import type { WeekStrip as WeekStripModel } from "@/components/learn/learn-model";
import { weekDayName } from "@/components/learn/learn-model";
import { cn } from "@/lib/utils";

/**
 * Seven day circles and a count. Deliberately not a streak: a gap costs
 * nothing, the copy never says "keep it up", and the count is the only claim
 * the page makes about the week. A practiced day is filled; today is ringed.
 */
export function WeekStrip({ week }: { week: WeekStripModel }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex items-center gap-2" aria-label="Practice this week">
        {week.days.map((day, index) => (
          <li key={day.iso}>
            <span
              aria-hidden="true"
              className={cn(
                "type-label flex size-8 items-center justify-center rounded-full",
                day.active
                  ? "bg-azure-500 text-on-fill"
                  : "border border-rule text-ink-muted",
                day.isToday && "ring-2 ring-azure-500 ring-offset-2 ring-offset-surface",
              )}
            >
              {day.label}
            </span>
            <span className="sr-only">
              {`${weekDayName(index)}${day.isToday ? " (today)" : ""}: ${
                day.active ? "practiced" : "no practice"
              }`}
            </span>
          </li>
        ))}
      </ul>
      <p className="type-small tabular text-ink">{week.summary}</p>
    </div>
  );
}
