import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatAccuracy } from "@/lib/professor/student-pseudonym";
import type { InstructorCohortAnalytics } from "@/lib/types";

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border p-4">
      <span className="text-2xl leading-none font-semibold tracking-tight">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

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

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Class practice</CardTitle>
          <CardDescription>
            Aggregated across every recorded tutor session. Individual students
            are reachable only through their pseudonymous record.
          </CardDescription>
        </div>
        <Button asChild variant="outline">
          <Link href="/professor/students">View students</Link>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {cohort.mode === "demo" ? (
          <p className="text-sm text-muted-foreground">
            Demo mode records tutor sessions in memory for the current visitor
            only, so there is no class activity to aggregate.
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="Active students" value={cohort.activeStudents} />
              <Metric label="Sessions" value={cohort.sessions} />
              <Metric label="Attempts" value={cohort.attempts} />
              <Metric
                label="Correct"
                value={formatAccuracy(cohort.correctAttempts, cohort.attempts)}
              />
              <Metric label="Hints" value={cohort.hintsUsed} />
              <Metric label="Solutions" value={cohort.solutionsRevealed} />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">Tutor path</h3>
                {routedAttempts > 0 ? (
                  <dl className="flex flex-col gap-2 text-sm">
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-muted-foreground">Rule-based</dt>
                      <dd className="font-medium">{cohort.ruleAttempts}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-muted-foreground">Retrieval</dt>
                      <dd className="font-medium">
                        {cohort.retrievalAttempts}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-muted-foreground">LLM fallback</dt>
                      <dd className="font-medium">{cohort.llmAttempts}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-muted-foreground">Blocked</dt>
                      <dd className="font-medium">{cohort.blockedAttempts}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No tutor interactions have been recorded yet.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">
                  Most recorded misconceptions
                </h3>
                {cohort.misconceptions.length > 0 ? (
                  <dl className="flex flex-col gap-2 text-sm">
                    {cohort.misconceptions.map((misconception) => (
                      <div
                        key={misconception.misconceptionId}
                        className="flex items-center justify-between gap-4"
                      >
                        <dt className="text-muted-foreground">
                          {misconception.label}
                        </dt>
                        <dd className="font-medium">
                          {misconception.sessions}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No misconception codes have been recorded yet.
                  </p>
                )}
              </div>
            </div>

            {cohort.studentsNeedingAttention > 0 ? (
              <p className="text-sm text-muted-foreground">
                {cohort.studentsNeedingAttention}{" "}
                {cohort.studentsNeedingAttention === 1
                  ? "student has"
                  : "students have"}{" "}
                answered four or more times on a topic with 40% or fewer
                correct.{" "}
                <Link
                  className="font-medium text-primary hover:underline"
                  href="/professor/students?sort=lowest_accuracy"
                >
                  Review them
                </Link>
                .
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
