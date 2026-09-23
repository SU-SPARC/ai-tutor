import type { Glance } from "@/components/learn/learn-model";
import { cn } from "@/lib/utils";

const RING_RADIUS = 26;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Zone 5, ≥1280 only. Two honest numbers: how much of the course has been
 * solved, split by the course's own difficulty words, and which days were
 * practised. The calendar is a calendar — no streak, no "best run", no
 * countdown.
 */
export function AtAGlance({ glance }: { glance: Glance }) {
  const fraction = glance.total > 0 ? glance.solved / glance.total : 0;

  return (
    <div className="flex flex-col gap-6 rounded-lg bg-sheet p-6 text-sheet-foreground">
      <div className="flex items-center gap-4">
        <svg
          aria-hidden="true"
          viewBox="0 0 64 64"
          className="size-16 shrink-0 -rotate-90"
        >
          <circle
            cx="32"
            cy="32"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="6"
            className="stroke-indigo-100"
          />
          <circle
            cx="32"
            cy="32"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            className="stroke-indigo-500"
            strokeDasharray={`${(fraction * RING_CIRCUMFERENCE).toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`}
          />
        </svg>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-mono text-sm">
            {`${glance.solved}/${glance.total} solved`}
          </p>
          <ul className="flex flex-col gap-0.5">
            {glance.breakdown.map((row) => (
              <li
                key={row.label}
                className="font-mono text-xs text-muted-foreground"
              >
                {`${row.label} ${row.solved}/${row.total}`}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">
          Practice days
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {glance.calendar.monthLabel}
        </p>
        <div
          className="grid grid-cols-7 gap-1"
          role="img"
          aria-label={`Days practised in ${glance.calendar.monthLabel}: ${glance.calendar.days
            .filter((day) => day.active)
            .map((day) => day.day)
            .join(", ")}`}
        >
          {Array.from({ length: glance.calendar.leadingBlanks }, (_, index) => (
            <span
              key={`blank-${index}`}
              aria-hidden="true"
              className="size-5"
            />
          ))}
          {glance.calendar.days.map((day) => (
            <span
              key={day.day}
              aria-hidden="true"
              className={cn(
                "flex size-5 items-center justify-center rounded-[3px] font-mono text-[10px]",
                day.active
                  ? "bg-indigo-500 text-primary-foreground"
                  : "bg-indigo-100 text-muted-foreground",
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
