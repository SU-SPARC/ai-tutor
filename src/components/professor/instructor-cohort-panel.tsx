import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricTile } from "@/components/ui/metric-tile";
import { formatAccuracy } from "@/lib/professor/student-pseudonym";
import type { InstructorCohortAnalytics } from "@/lib/types";

const NUMBER = new Intl.NumberFormat("en");

/**
 * Where "See these students" goes. The Students list has no attention filter,
 * so it opens sorted with the lowest share correct first, which puts the
 * flagged students at the top.
 */
export const STUDENTS_NEEDING_HELP_HREF =
  "/professor/students?sort=lowest_accuracy";

function count(value: number) {
  return NUMBER.format(value);
}

function plural(value: number, one: string, many: string) {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/** A number tile whose label and meaning read at 16px. */
function Tile({
  delta,
  label,
  value,
}: {
  delta: string;
  label: string;
  value: string;
}) {
  return (
    <MetricTile
      label={<span className="type-body-strong text-ink">{label}</span>}
      value={value}
      delta={<span className="type-body text-ink">{delta}</span>}
    />
  );
}

/**
 * The top of Class progress: who needs attention first, then the class in
 * four worded numbers and the rarer counts behind "More numbers". No student is named, and tutor internals (which engine
 * answered) are left to the research export.
 */
export function InstructorCohortPanel({
  cohort,
}: {
  cohort: InstructorCohortAnalytics;
}) {
  if (cohort.mode === "demo") {
    return (
      <EmptyState>This is a demo, so there’s no real class to show.</EmptyState>
    );
  }

  const checkedAnswers =
    cohort.correctAttempts + (cohort.incorrectAttempts ?? 0);
  const needingHelp = cohort.studentsNeedingAttention;

  return (
    <div className="flex flex-col gap-10">
      <section
        aria-labelledby="attention-heading"
        className="flex flex-col gap-3 rounded-panel border-l-2 border-amber-500 bg-sheet p-4"
      >
        <h2 id="attention-heading" className="type-h2 text-ink">
          Needs your attention
        </h2>
        {needingHelp > 0 ? (
          <>
            <p className="type-body-strong max-w-prose text-ink">
              {plural(needingHelp, "student has", "students have")} answered 4
              or more questions on one topic and got 40% or fewer right.
            </p>
            <Button asChild variant="outline" className="min-h-11 self-start">
              <Link href={STUDENTS_NEEDING_HELP_HREF} prefetch={false}>
                See these students
              </Link>
            </Button>
          </>
        ) : (
          <p className="type-body max-w-prose text-ink">
            No student is struggling with a topic right now.
          </p>
        )}
      </section>

      <section
        aria-labelledby="class-glance-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="class-glance-heading" className="type-h2 text-ink">
          The class so far
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Active students"
            value={count(cohort.activeStudents)}
            delta={`${cohort.activeStudents === 1 ? "has" : "have"} practiced so far this term`}
          />
          <Tile
            label="Correct"
            value={formatAccuracy(cohort.correctAttempts, checkedAnswers)}
            delta={
              checkedAnswers > 0
                ? `of checked answers so far this term (${count(cohort.correctAttempts)} of ${count(checkedAnswers)})`
                : "No answers checked yet"
            }
          />
          <Tile
            label="Hints used"
            value={count(cohort.hintsUsed)}
            delta="hints students asked for"
          />
          <Tile
            label="Solutions viewed"
            value={count(cohort.solutionsRevealed)}
            delta="times students opened a solution"
          />
        </div>

        <details className="group flex flex-col gap-2">
          <summary className="inline-flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 rounded-xs type-body font-medium text-azure-500 focus-ring hover:text-azure-700 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden="true"
              className="size-4 transition-transform duration-fast group-open:rotate-90"
            />
            More numbers
          </summary>
          <dl className="mt-2 flex max-w-md flex-col divide-y divide-rule rounded-panel bg-sheet px-4 type-body">
            <CountRow label="Answers checked" value={checkedAnswers} />
            <CountRow label="Study sessions" value={cohort.sessions} />
            <CountRow
              label="Extra practice questions"
              value={cohort.extraPracticeSessions}
            />
          </dl>
        </details>

        {cohort.excludedStaffSessions > 0 ? (
          <p className="type-small text-ink">
            {cohort.excludedStaffSessions}
            {cohort.excludedStaffSessions === 1
              ? " session by a professor account is excluded."
              : " sessions by professor accounts are excluded."}
          </p>
        ) : null}
      </section>
    </div>
  );
}

/**
 * The mistakes the tutor recognized most often across the class, shown after
 * the "hardest" tables. Empty in the demo, which has no class.
 */
export function InstructorCommonMistakes({
  cohort,
}: {
  cohort: InstructorCohortAnalytics;
}) {
  if (cohort.mode === "demo") {
    return null;
  }

  return (
    <section
      aria-labelledby="misconceptions-heading"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <h2 id="misconceptions-heading" className="type-h2 text-ink">
          Most common mistakes
        </h2>
        <p className="type-body text-ink">
          Mistakes the tutor recognized, and in how many study sessions.
        </p>
      </div>
      {cohort.misconceptions.length > 0 ? (
        <dl className="flex max-w-2xl flex-col divide-y divide-rule rounded-panel bg-sheet px-4 type-body">
          {cohort.misconceptions.map((misconception) => (
            <CountRow
              key={misconception.misconceptionId}
              label={misconception.label}
              value={misconception.sessions}
              unit={misconception.sessions === 1 ? "session" : "sessions"}
            />
          ))}
        </dl>
      ) : (
        <p className="type-body text-ink">
          The tutor hasn’t recognized a common mistake yet.
        </p>
      )}
    </section>
  );
}

function CountRow({
  label,
  unit,
  value,
}: {
  label: string;
  unit?: string;
  value: number;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
      <dt className="min-w-0 text-ink">{label}</dt>
      <dd className="shrink-0 tabular text-ink">
        {count(value)}
        {unit ? ` ${unit}` : null}
      </dd>
    </div>
  );
}
