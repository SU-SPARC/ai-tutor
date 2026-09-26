import Link from "next/link";

import { Button } from "@/components/ui/button";
import { MetricTile } from "@/components/ui/metric-tile";
import { formatAccuracy } from "@/lib/professor/student-pseudonym";
import type { InstructorCohortAnalytics } from "@/lib/types";

const NUMBER = new Intl.NumberFormat("en");

function count(value: number) {
  return NUMBER.format(value);
}

/**
 * The class summary at the top of Analytics: four plain numbers, then the
 * smaller counts, the tutor path and the recorded misconceptions as quiet
 * lists. No icons, no colour-coded deltas; numbers are mono and tabular.
 */
export function InstructorCohortPanel({
  cohort,
}: {
  cohort: InstructorCohortAnalytics;
}) {
  const routedAttempts =
    cohort.ruleAttempts +
    cohort.retrievalAttempts +
    cohort.llmAttempts +
    cohort.blockedAttempts;
  const scoredAttempts =
    cohort.correctAttempts + (cohort.incorrectAttempts ?? 0);

  return (
    <section
      aria-labelledby="class-practice-heading"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="class-practice-heading" className="type-h2 text-ink">
          Class practice
        </h2>
        <Button asChild variant="outline" size="sm">
          <Link href="/professor/students" prefetch={false}>
            View students
          </Link>
        </Button>
      </div>

      {cohort.mode === "demo" ? (
        <p className="type-body max-w-prose text-ink-muted">
          Demo mode records tutor sessions in memory for the current visitor
          only, so there is no class activity to aggregate.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricTile
              label="Active students"
              value={count(cohort.activeStudents)}
            />
            <MetricTile
              label="Practice sessions"
              value={count(cohort.sessions)}
              delta={`${count(cohort.extraPracticeSessions)} extra practice`}
            />
            <MetricTile
              label="Answer attempts"
              value={count(cohort.attempts)}
            />
            <MetricTile
              label="Correct"
              value={formatAccuracy(cohort.correctAttempts, scoredAttempts)}
              delta={
                scoredAttempts > 0
                  ? `${count(cohort.correctAttempts)} of ${count(scoredAttempts)} scored answers`
                  : "No scored answers yet"
              }
            />
          </div>

          <dl className="flex flex-wrap gap-x-6 gap-y-1 type-small">
            <div className="flex gap-2">
              <dt className="text-ink-muted">Hints</dt>
              <dd className="font-mono tabular text-ink">
                {count(cohort.hintsUsed)}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-muted">Solutions revealed</dt>
              <dd className="font-mono tabular text-ink">
                {count(cohort.solutionsRevealed)}
              </dd>
            </div>
          </dl>

          {cohort.excludedStaffSessions > 0 ? (
            <p className="type-caption">
              {cohort.excludedStaffSessions}
              {cohort.excludedStaffSessions === 1
                ? " session by a professor account is excluded."
                : " sessions by professor accounts are excluded."}
            </p>
          ) : null}

          {cohort.studentsNeedingAttention > 0 ? (
            <p className="type-small max-w-prose text-ink">
              {cohort.studentsNeedingAttention}{" "}
              {cohort.studentsNeedingAttention === 1
                ? "student has"
                : "students have"}{" "}
              answered four or more times on a topic with 40% or fewer correct.{" "}
              <Link
                className="rounded-xs font-medium text-azure-500 underline-offset-4 hover:text-azure-700 hover:underline focus-ring"
                href="/professor/students?sort=lowest_accuracy"
                prefetch={false}
              >
                Review them
              </Link>
            </p>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-2">
            <section
              aria-labelledby="tutor-path-heading"
              className="flex flex-col gap-3 rounded-panel bg-sheet p-4"
            >
              <h3 id="tutor-path-heading" className="type-h3 text-ink">
                Tutor path
              </h3>
              {routedAttempts > 0 ? (
                <dl className="flex flex-col divide-y divide-rule type-small">
                  <CountRow label="Rule-based" value={cohort.ruleAttempts} />
                  <CountRow
                    label="Retrieval"
                    value={cohort.retrievalAttempts}
                  />
                  <CountRow label="LLM fallback" value={cohort.llmAttempts} />
                  <CountRow label="Blocked" value={cohort.blockedAttempts} />
                </dl>
              ) : (
                <p className="type-small text-ink-muted">
                  No tutor interactions have been recorded yet.
                </p>
              )}
            </section>

            <section
              aria-labelledby="misconceptions-heading"
              className="flex flex-col gap-3 rounded-panel bg-sheet p-4"
            >
              <div className="flex flex-col gap-1">
                <h3 id="misconceptions-heading" className="type-h3 text-ink">
                  Most recorded misconceptions
                </h3>
                <p className="type-caption">Counted in tutor sessions.</p>
              </div>
              {cohort.misconceptions.length > 0 ? (
                <dl className="flex flex-col divide-y divide-rule type-small">
                  {cohort.misconceptions.map((misconception) => (
                    <CountRow
                      key={misconception.misconceptionId}
                      label={misconception.label}
                      value={misconception.sessions}
                      unit="sessions"
                    />
                  ))}
                </dl>
              ) : (
                <p className="type-small text-ink-muted">
                  No misconception codes have been recorded yet.
                </p>
              )}
            </section>
          </div>
        </>
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
    <div className="flex min-h-10 items-center justify-between gap-4 py-2">
      <dt className="min-w-0 text-ink">{label}</dt>
      <dd className="shrink-0 font-mono tabular text-ink">
        {count(value)}
        {unit ? <span className="sr-only"> {unit}</span> : null}
      </dd>
    </div>
  );
}
