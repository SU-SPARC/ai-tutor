import type { WeekStrip as WeekStripModel } from "@/components/learn/learn-model";
import { weekDayName } from "@/components/learn/learn-model";
import { cn } from "@/lib/utils";

/**
 * Zone 2. Seven dots and a count. Deliberately not a streak: a gap costs
 * nothing, the copy never says "keep it up", and the number is the only claim
 * the page makes about the week.
 */
export function WeekStrip({ week }: { week: WeekStripModel }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <ul className="flex items-center gap-2" aria-label="Practice this week">
        {week.days.map((day, index) => (
          <li key={day.iso} className="flex flex-col items-center gap-1">
            <span
              aria-hidden="true"
              className="font-mono text-[11px] text-muted-foreground"
            >
              {day.label}
            </span>
            <span
              className={cn(
                "size-2.5 rounded-full",
                day.active ? "bg-primary" : "bg-indigo-100",
                day.isToday && !day.active && "ring-1 ring-indigo-300",
              )}
            >
              <span className="sr-only">
                {`${weekDayName(index)}: ${
                  day.active ? "practised" : "no practice"
                }`}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="font-mono text-xs text-muted-foreground">{week.summary}</p>
    </div>
  );
}
