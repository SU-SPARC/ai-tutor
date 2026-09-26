import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import {
  RelativeTime,
  requestTime,
} from "@/components/professor/instructor-student-table";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricTile } from "@/components/ui/metric-tile";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAccuracy } from "@/lib/professor/student-pseudonym";
import {
  FULL_CREDIT_VALID_ATTEMPT_LIMIT,
  MANUAL_REVIEW_REASON,
  PRACTICE_CREDIT_ROUTE_LABELS,
} from "@/lib/tutor/practice-credit";
import type {
  InstructorQuestionCreditEvidence,
  InstructorStudentActivityPoint,
  InstructorStudentAttempt,
  InstructorStudentDetail,
} from "@/lib/types";

const SOURCE_LABELS: Record<string, string> = {
  blocked: "Blocked",
  llm: "LLM fallback",
  retrieval: "Retrieval",
  rule: "Rule-based",
};

const MODE_LABELS: Record<string, string> = {
  check: "Answer",
  full_solution: "Full solution",
  hint: "Hint",
  solution: "Solution step",
};

const VERDICTS: Record<string, { label: string; tone: StatusTone }> = {
  blocked: { label: "Blocked", tone: "neutral" },
  correct: { label: "Correct", tone: "correct" },
  guidance: { label: "Guidance", tone: "neutral" },
  incorrect: { label: "Incorrect", tone: "wrong" },
};

/**
 * Route tones reuse the lifecycle/verdict palette by meaning: the full route
 * is a correct result, the partial route an approved one, manual review waits
 * on a person, and "not yet qualified" is neutral. The label is always shown.
 */
const ROUTE_TONES: Record<
  InstructorQuestionCreditEvidence["route"],
  StatusTone
> = {
  full: "correct",
  manual_review: "review",
  not_qualified: "neutral",
  partial_similar: "approved",
};

const NUMBER = new Intl.NumberFormat("en");
const DAY_LABEL = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function count(value: number) {
  return NUMBER.format(value);
}

function formatDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return DAY_LABEL.format(date);
}

const linkClassName =
  "relative rounded-xs font-medium text-azure-500 underline-offset-4 hover:text-azure-700 hover:underline focus-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-3";

/** A zone of the record: an h2, an optional helper line, then the content. */
function Zone({
  children,
  helper,
  id,
  title,
}: {
  children: ReactNode;
  helper?: ReactNode;
  id: string;
  title: string;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="type-h2 text-ink">
          {title}
        </h2>
        {helper ? (
          <p className="type-small max-w-prose text-ink-muted">{helper}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Submissions per active day as a stacked bar: the correct share (green) sits
 * on the baseline, the rest (neutral) above it, 2px apart. Heights are
 * relative to the busiest day, which the caption names; each column carries
 * its figures as text for screen readers and as a hover title.
 */
function ActivityTrend({
  activity,
}: {
  activity: InstructorStudentActivityPoint[];
}) {
  const busiest = Math.max(...activity.map((point) => point.attempts), 1);

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex items-end gap-2 overflow-x-auto pb-1">
        {activity.map((point) => {
          const height = Math.max((point.attempts / busiest) * 100, 6);
          const correctShare =
            point.attempts > 0
              ? (point.correctAttempts / point.attempts) * 100
              : 0;
          const summary = `${point.correctAttempts} of ${point.attempts} submissions correct on ${formatDay(point.date)}`;
          return (
            <li
              key={point.date}
              className="flex min-w-10 flex-col items-center gap-2"
              title={summary}
            >
              <div
                aria-hidden="true"
                className="flex h-24 w-6 flex-col justify-end"
              >
                <div
                  className="flex flex-col justify-end gap-0.5"
                  style={{ height: `${height}%` }}
                >
                  {correctShare < 100 ? (
                    <div className="min-h-0.5 flex-1 rounded-t-sm bg-input" />
                  ) : null}
                  {correctShare > 0 ? (
                    <div
                      className={
                        correctShare < 100
                          ? "bg-green-500"
                          : "rounded-t-sm bg-green-500"
                      }
                      style={{ height: `${correctShare}%` }}
                    />
                  ) : null}
                </div>
              </div>
              <span
                aria-hidden="true"
                className="type-caption whitespace-nowrap"
              >
                {formatDay(point.date)}
              </span>
              <span className="sr-only">{summary}</span>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 type-caption">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-3 rounded-xs bg-green-500" />
          Correct
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-3 rounded-xs bg-input" />
          Other submissions
        </span>
        <span>
          Tallest bar:{" "}
          <span className="font-mono tabular text-ink">{count(busiest)}</span>{" "}
          {busiest === 1 ? "submission" : "submissions"}
        </span>
      </div>
    </div>
  );
}

function validAttemptsLabel(evidence: InstructorQuestionCreditEvidence) {
  if (evidence.validAttemptsToFirstCorrect !== undefined) {
    return `${evidence.validAttemptsToFirstCorrect} to first correct`;
  }
  return evidence.validAttempts === 0
    ? "—"
    : `${evidence.validAttempts}, none correct`;
}

function similarProblemLabel(evidence: InstructorQuestionCreditEvidence) {
  if (evidence.similarProblemSolved) return "Solved";
  if (evidence.similarProblemAttempted) return "Attempted, not solved";
  return "—";
}

/**
 * Evidence for the course practice-credit policy, one row per assigned
 * question. It reports what was recorded and which route that supports; the
 * instructor decides the credit. Nothing here is called a grade.
 */
function CreditEvidenceTable({
  evidence,
}: {
  evidence: InstructorQuestionCreditEvidence[];
}) {
  return (
    <div className="rounded-panel bg-sheet">
      <Table containerClassName="rounded-panel">
        <TableCaption className="sr-only">
          Practice credit evidence by assigned question
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="pl-4">
              Question
            </TableHead>
            <TableHead scope="col">Status</TableHead>
            <TableHead scope="col">Valid attempts</TableHead>
            <TableHead scope="col">Solution before first correct</TableHead>
            <TableHead scope="col">Similar problem</TableHead>
            <TableHead scope="col">Start over</TableHead>
            <TableHead scope="col" className="pr-4">
              Credit route
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {evidence.map((row) => (
            <TableRow key={row.questionId}>
              <TableCell className="min-w-56 py-2.5 pl-4">
                <div className="flex flex-col">
                  <span className="font-medium">{row.questionTitle}</span>
                  <span className="type-caption">{row.topicTitle}</span>
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {row.solved ? "Completed" : "Not solved"}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular">
                {validAttemptsLabel(row)}
              </TableCell>
              <TableCell>
                {row.workedSolutionViewedBeforeFirstCorrect ? "Yes" : "No"}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {similarProblemLabel(row)}
              </TableCell>
              <TableCell>{row.startOverUsed ? "Yes" : "—"}</TableCell>
              <TableCell className="py-2.5 pr-4">
                <div className="flex flex-col items-start gap-1">
                  <StatusChip
                    tone={ROUTE_TONES[row.route]}
                    label={PRACTICE_CREDIT_ROUTE_LABELS[row.route]}
                  />
                  {row.route === "manual_review" ? (
                    <span className="type-caption max-w-xs">
                      {MANUAL_REVIEW_REASON}
                    </span>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** The rules behind the routes, one click away instead of an intro paragraph. */
function CreditPolicyDetails() {
  return (
    <details className="group max-w-prose">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-xs type-small font-medium text-azure-500 focus-ring hover:text-azure-700 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform duration-fast group-open:rotate-90"
        />
        How each route is decided
      </summary>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 type-small text-ink">
        <li>
          A valid attempt is an answer the tutor could read and marked correct
          or incorrect; unreadable submissions, hints, solution reveals and AI
          help are not attempts. Attempts are counted across Start over.
        </li>
        <li>
          Full-credit route: a correct answer within{" "}
          {FULL_CREDIT_VALID_ATTEMPT_LIMIT} valid attempts, with the worked
          solution not revealed before it. Revealing the solution first ends
          that route for the question.
        </li>
        <li>Partial-credit route: a solved linked similar problem.</li>
        <li>
          Manual review: solved after the worked solution without a solved
          similar problem. The record cannot show whether a similar problem was
          available, so no number is derived.
        </li>
      </ul>
    </details>
  );
}

function RecentActivity({
  attempts,
}: {
  attempts: InstructorStudentAttempt[];
}) {
  const now = requestTime();
  return (
    <ol className="flex flex-col divide-y divide-rule rounded-panel bg-sheet px-4">
      {attempts.map((attempt) => {
        const verdict = attempt.verdict ? VERDICTS[attempt.verdict] : undefined;
        const meta = [
          attempt.topicTitle,
          MODE_LABELS[attempt.mode] ?? attempt.mode,
          SOURCE_LABELS[attempt.source] ?? attempt.source,
          attempt.misconceptionDetected ? "Misconception detected" : undefined,
        ].filter(Boolean);
        return (
          <li
            key={attempt.id}
            className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <Link
                className={`${linkClassName} w-fit`}
                href={`/practice/${attempt.questionId}`}
              >
                {attempt.questionTitle}
              </Link>
              <p className="type-caption">{meta.join(" · ")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {verdict ? (
                <StatusChip tone={verdict.tone} label={verdict.label} />
              ) : attempt.verdict ? (
                <StatusChip tone="neutral" label={attempt.verdict} />
              ) : null}
              <span className="type-caption whitespace-nowrap">
                <RelativeTime now={now} value={attempt.createdAt} />
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function InstructorStudentDetailPanel({
  detail,
}: {
  detail: InstructorStudentDetail;
}) {
  const {
    activity,
    attempts,
    attention,
    creditEvidence,
    misconceptions,
    summary,
    topics,
  } = detail;
  // A student is listed from their first sign-in, so a record with nothing
  // recorded is a real state rather than an error. Say so, and let the zero
  // metrics below stay truthful zeros.
  const hasActivity =
    summary.sessions > 0 ||
    summary.extraPracticeSessions > 0 ||
    summary.attempts > 0;
  const scoredAttempts =
    summary.correctAttempts + (summary.incorrectAttempts ?? 0);
  const now = requestTime();

  return (
    <div className="flex flex-col gap-10">
      <section
        aria-labelledby="student-summary-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="student-summary-heading" className="sr-only">
          Summary
        </h2>
        {hasActivity ? null : (
          <p className="type-body max-w-prose text-ink-muted">
            No practice activity yet: this student has signed in but not
            practiced with the tutor, so every count below is zero.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <MetricTile
            label="Practice sessions"
            value={count(summary.sessions)}
            delta={`${count(summary.extraPracticeSessions)} extra practice`}
          />
          <MetricTile
            label="Answer submissions"
            value={count(summary.attempts)}
          />
          <MetricTile
            label="Accuracy"
            value={formatAccuracy(summary.correctAttempts, scoredAttempts)}
            delta={
              scoredAttempts > 0
                ? `${count(summary.correctAttempts)} of ${count(scoredAttempts)} scored answers`
                : "No scored answers yet"
            }
          />
          <MetricTile label="Hints" value={count(summary.hintsUsed)} />
          <MetricTile
            label="Solutions revealed"
            value={count(summary.solutionsRevealed)}
          />
        </div>
      </section>

      {attention.length > 0 ? (
        <Zone
          id="student-attention-heading"
          title="Repeated difficulty"
          helper="Derived from recorded counts alone; each line shows the figures it came from."
        >
          <ul className="flex flex-col divide-y divide-rule rounded-panel border-l-2 border-azure-500 bg-sheet px-4">
            {attention.map((signal, index) => (
              <li
                key={`${signal.code}-${signal.topicId ?? index}`}
                className="flex flex-col gap-0.5 py-3 type-small"
              >
                <span className="font-medium text-ink">
                  {signal.topicTitle ?? "Recurring misconception"}
                </span>
                <span className="text-ink-muted">{signal.detail}</span>
              </li>
            ))}
          </ul>
        </Zone>
      ) : null}

      <Zone
        id="student-topics-heading"
        title="Topic performance"
        helper="Accuracy is the share of scored answers marked correct; it is not a mastery score."
      >
        {topics.length > 0 ? (
          <div className="rounded-panel bg-sheet">
            <Table containerClassName="rounded-panel">
              <TableCaption className="sr-only">
                Practice by syllabus topic
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="pl-4">
                    Topic
                  </TableHead>
                  <TableHead scope="col" numeric>
                    Submissions
                  </TableHead>
                  <TableHead scope="col" numeric>
                    Correct
                  </TableHead>
                  <TableHead scope="col" numeric>
                    Accuracy
                  </TableHead>
                  <TableHead scope="col" numeric>
                    Hints
                  </TableHead>
                  <TableHead scope="col" numeric>
                    Solutions
                  </TableHead>
                  <TableHead scope="col" className="pr-4">
                    Last active
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topics.map((topic) => (
                  <TableRow key={topic.topicId}>
                    <TableCell className="min-w-48 pl-4 font-medium">
                      {topic.topicTitle}
                    </TableCell>
                    <TableCell numeric>{topic.attempts}</TableCell>
                    <TableCell numeric>{topic.correctAttempts}</TableCell>
                    <TableCell numeric>
                      {formatAccuracy(
                        topic.correctAttempts,
                        topic.correctAttempts + (topic.incorrectAttempts ?? 0),
                      )}
                    </TableCell>
                    <TableCell numeric>{topic.hintsUsed}</TableCell>
                    <TableCell numeric>{topic.solutionsRevealed}</TableCell>
                    <TableCell className="whitespace-nowrap pr-4 text-ink-muted">
                      <RelativeTime now={now} value={topic.lastActiveAt} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState className="py-2">
            No topic practice has been recorded for this student yet.
          </EmptyState>
        )}
      </Zone>

      <Zone
        id="student-credit-heading"
        title="Practice credit evidence"
        helper="What the record supports under the course practice-credit policy, per assigned question. This is evidence for your decision, not a grade."
      >
        <CreditPolicyDetails />
        {creditEvidence.length > 0 ? (
          <CreditEvidenceTable evidence={creditEvidence} />
        ) : (
          <EmptyState className="py-2">
            No assigned-question practice has been recorded for this student
            yet.
          </EmptyState>
        )}
      </Zone>

      <div className="grid gap-10 lg:grid-cols-3 lg:gap-6">
        <div className="lg:col-span-2">
          <Zone
            id="student-trend-heading"
            title="Last 30 days"
            helper="Answer submissions per active day; the green part is the share marked correct."
          >
            {activity.length > 0 ? (
              <div className="rounded-panel bg-sheet p-4">
                <ActivityTrend activity={activity} />
              </div>
            ) : (
              <EmptyState className="py-2">
                No practice has been recorded in the last 30 days.
              </EmptyState>
            )}
          </Zone>
        </div>

        <Zone
          id="student-misconceptions-heading"
          title="Recorded misconceptions"
          helper="Counted in sessions from the codes the tutor recorded, never inferred from a low score."
        >
          {misconceptions.length > 0 ? (
            <dl className="flex flex-col divide-y divide-rule rounded-panel bg-sheet px-4 type-small">
              {misconceptions.map((misconception) => (
                <div
                  key={misconception.misconceptionId}
                  className="flex min-h-10 items-center justify-between gap-4 py-2"
                >
                  <dt className="min-w-0 text-ink">{misconception.label}</dt>
                  <dd className="shrink-0 font-mono tabular text-ink">
                    {count(misconception.sessions)}
                    <span className="sr-only"> sessions</span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <EmptyState className="py-2">
              No misconception codes have been recorded for this student.
            </EmptyState>
          )}
        </Zone>
      </div>

      <Zone
        id="student-recent-heading"
        title="Recent activity"
        helper="The latest recorded interactions. Submitted answers and tutor feedback text are not shown."
      >
        {attempts.length > 0 ? (
          <RecentActivity attempts={attempts} />
        ) : (
          <EmptyState className="py-2">
            This student has no recorded attempts yet.
          </EmptyState>
        )}
      </Zone>
    </div>
  );
}
