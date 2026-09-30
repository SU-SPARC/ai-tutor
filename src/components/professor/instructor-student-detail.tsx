import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import {
  formatCorrect,
  PROFESSOR_TABLE_TYPE,
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
import { formatActiveTime } from "@/lib/professor/student-usage";
import { FULL_CREDIT_VALID_ATTEMPT_LIMIT } from "@/lib/tutor/practice-credit";
import type {
  InstructorAttentionSignal,
  InstructorQuestionCreditEvidence,
  InstructorStudentActivityPoint,
  InstructorStudentAttempt,
  InstructorStudentDetail,
  InstructorStudentSummary,
  InstructorStudentTopicPerformance,
} from "@/lib/types";

/** What the student did, in the professor's words. */
const MODE_LABELS: Record<string, string> = {
  check: "Answer checked",
  full_solution: "Viewed the full solution",
  hint: "Used a hint",
  solution: "Viewed a solution step",
};

const VERDICTS: Record<string, { label: string; tone: StatusTone }> = {
  blocked: { label: "Not checked", tone: "neutral" },
  correct: { label: "Correct", tone: "correct" },
  guidance: { label: "Tutor help", tone: "neutral" },
  incorrect: { label: "Not correct", tone: "wrong" },
};

/**
 * The suggested credit for each route. Presentation only: the route itself
 * is derived in `@/lib/tutor/practice-credit` and never stored. The label is
 * always printed; the tone only repeats it.
 */
const SUGGESTED_CREDIT: Record<
  InstructorQuestionCreditEvidence["route"],
  { label: string; tone: StatusTone }
> = {
  full: { label: "Full credit", tone: "correct" },
  manual_review: { label: "Your call", tone: "review" },
  not_qualified: { label: "Not yet", tone: "neutral" },
  partial_similar: {
    label: "90% (solved a similar problem)",
    tone: "approved",
  },
};

const NUMBER = new Intl.NumberFormat("en");
const DAY_LABEL = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/**
 * The part of a bar that was not correct: a hatch and an outline, so it
 * differs from the solid green part without relying on colour.
 */
const NOT_CORRECT_FILL = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--ink-muted) 0 1.5px, transparent 1.5px 5px)",
} as const;

function count(value: number) {
  return NUMBER.format(value);
}

function plural(value: number, one: string, many: string) {
  return `${count(value)} ${value === 1 ? one : many}`;
}

function formatDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return DAY_LABEL.format(date);
}

const linkClassName =
  "inline-flex min-h-11 items-center rounded-xs font-medium text-azure-500 underline-offset-4 hover:text-azure-700 hover:underline focus-ring";

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
          <p className="type-body max-w-prose text-ink">{helper}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A number tile whose label and explanation read at 16px. */
function Tile({
  delta,
  label,
  value,
}: {
  delta?: string;
  label: string;
  value: string;
}) {
  return (
    <MetricTile
      label={<span className="type-body-strong text-ink">{label}</span>}
      value={value}
      delta={
        delta ? <span className="type-body text-ink">{delta}</span> : undefined
      }
    />
  );
}

/**
 * Answers per active day as a stacked bar: the correct part (solid green) on
 * the baseline, the rest (hatched, outlined) above it. Every bar prints its
 * figures under it ("3/5") above the date, so nothing depends on hover or on
 * telling the colours apart.
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
          return (
            <li
              key={point.date}
              className="flex min-w-12 flex-col items-center gap-1"
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
                    <div
                      className="min-h-1 flex-1 rounded-t-sm border border-ink-muted bg-sheet"
                      style={NOT_CORRECT_FILL}
                    />
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
                className="type-small whitespace-nowrap tabular text-ink"
              >
                {point.correctAttempts}/{point.attempts}
              </span>
              <span
                aria-hidden="true"
                className="type-small whitespace-nowrap text-ink-muted"
              >
                {formatDay(point.date)}
              </span>
              <span className="sr-only">
                {`${formatDay(point.date)}: ${point.correctAttempts} of ${point.attempts} answers correct`}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 type-body text-ink">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-4 rounded-xs bg-green-500" />
          Correct
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-4 rounded-xs border border-ink-muted bg-sheet"
            style={NOT_CORRECT_FILL}
          />
          Not correct (striped)
        </span>
        <span>
          Most in one day: {plural(busiest, "answer", "answers")}
        </span>
      </div>
    </div>
  );
}

/** "Solved in 2 tries", "Solved after viewing the solution", "Tried, not solved". */
function resultLabel(evidence: InstructorQuestionCreditEvidence) {
  if (evidence.solved) {
    if (evidence.workedSolutionViewedBeforeFirstCorrect) {
      return "Solved after viewing the solution";
    }
    if (evidence.validAttemptsToFirstCorrect !== undefined) {
      const tries = evidence.validAttemptsToFirstCorrect;
      return `Solved in ${tries} ${tries === 1 ? "try" : "tries"}`;
    }
    return "Solved";
  }
  return evidence.validAttempts > 0 ? "Tried, not solved" : "Not tried yet";
}

function triesLabel(evidence: InstructorQuestionCreditEvidence) {
  if (evidence.validAttemptsToFirstCorrect !== undefined) {
    return `Correct on try ${evidence.validAttemptsToFirstCorrect}`;
  }
  return evidence.validAttempts === 0
    ? "—"
    : `${plural(evidence.validAttempts, "try", "tries")}, none correct`;
}

function similarProblemLabel(evidence: InstructorQuestionCreditEvidence) {
  if (evidence.similarProblemSolved) return "Solved";
  if (evidence.similarProblemAttempted) return "Tried, not solved";
  return "—";
}

/**
 * One row per assigned question: what happened and the credit the course
 * policy suggests. The instructor decides the credit; nothing here is a
 * grade.
 */
function CreditSuggestionTable({
  evidence,
}: {
  evidence: InstructorQuestionCreditEvidence[];
}) {
  return (
    <div className="rounded-panel bg-sheet">
      <Table containerClassName="rounded-panel" className={PROFESSOR_TABLE_TYPE}>
        <TableCaption className="sr-only">
          Credit suggestions by assigned question
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="pl-4">
              Question
            </TableHead>
            <TableHead scope="col">Result</TableHead>
            <TableHead scope="col" className="pr-4">
              Suggested credit
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {evidence.map((row) => {
            const credit = SUGGESTED_CREDIT[row.route];
            return (
              <TableRow key={row.questionId}>
                <TableCell className="min-w-56 py-2.5 pl-4">
                  <div className="flex flex-col">
                    <span className="font-medium">{row.questionTitle}</span>
                    <span className="type-small text-ink-muted">
                      {row.topicTitle}
                    </span>
                  </div>
                </TableCell>
                <TableCell>{resultLabel(row)}</TableCell>
                <TableCell className="py-2.5 pr-4">
                  <StatusChip tone={credit.tone} label={credit.label} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The rules behind each suggestion and the counts they were read from, one
 * click away instead of in the main table.
 */
function CreditPolicyDetails({
  evidence,
}: {
  evidence: InstructorQuestionCreditEvidence[];
}) {
  return (
    <details className="group flex flex-col gap-3">
      <summary className="inline-flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 rounded-xs type-body font-medium text-azure-500 focus-ring hover:text-azure-700 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform duration-fast group-open:rotate-90"
        />
        How credit is suggested
      </summary>
      <ul className="mt-2 flex max-w-prose list-disc flex-col gap-1.5 pl-5 type-body text-ink">
        <li>
          A try is an answer the tutor could check and mark right or wrong.
          Hints, viewing a solution and asking the tutor for help are not
          tries. Tries add up across Start over.
        </li>
        <li>
          Full credit: a correct answer within{" "}
          {FULL_CREDIT_VALID_ATTEMPT_LIMIT} tries, without viewing the solution
          first. Viewing the solution first rules out full credit for that
          question.
        </li>
        <li>90%: the student solved a similar problem.</li>
        <li>
          Your call: solved after viewing the solution, with no similar
          problem solved. The tutor can’t tell whether a similar problem was
          offered, so you decide.
        </li>
        <li>Not yet: none of the above has happened.</li>
      </ul>
      {evidence.length > 0 ? (
        <div className="mt-3 rounded-panel bg-sheet">
          <Table
            containerClassName="rounded-panel"
            className={PROFESSOR_TABLE_TYPE}
          >
            <TableCaption className="sr-only">
              The counts behind each credit suggestion
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="pl-4">
                  Question
                </TableHead>
                <TableHead scope="col">Tries</TableHead>
                <TableHead scope="col">
                  Viewed solution before first correct
                </TableHead>
                <TableHead scope="col">Similar problem</TableHead>
                <TableHead scope="col" className="pr-4">
                  Started over
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evidence.map((row) => (
                <TableRow key={row.questionId}>
                  <TableCell className="min-w-56 pl-4 font-medium">
                    {row.questionTitle}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular">
                    {triesLabel(row)}
                  </TableCell>
                  <TableCell>
                    {row.workedSolutionViewedBeforeFirstCorrect ? "Yes" : "No"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {similarProblemLabel(row)}
                  </TableCell>
                  <TableCell className="pr-4">
                    {row.startOverUsed ? "Yes" : "No"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </details>
  );
}

function attentionText(
  signal: InstructorAttentionSignal,
  topics: InstructorStudentTopicPerformance[],
) {
  switch (signal.code) {
    case "repeated_topic_difficulty":
      return `${count(signal.correctAttempts)} of ${count(signal.attempts)} answers checked were correct.`;
    case "solution_reliance": {
      const topic = topics.find(
        (candidate) => candidate.topicId === signal.topicId,
      );
      return topic
        ? `Viewed ${plural(topic.solutionsRevealed, "solution", "solutions")} and got ${count(signal.correctAttempts)} correct.`
        : `Viewed more solutions than answers they got correct.`;
    }
    case "repeated_misconception":
      return `${signal.detail.replace(/ recorded in (\d+) sessions?$/, ": made in $1 study sessions")}.`;
    default:
      return signal.detail;
  }
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
          MODE_LABELS[attempt.mode],
          attempt.misconceptionDetected ? "Made a common mistake" : undefined,
        ].filter(Boolean);
        return (
          <li
            key={attempt.id}
            className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
          >
            <div className="flex min-w-0 flex-col">
              <Link
                className={`${linkClassName} w-fit`}
                href={`/practice/${attempt.questionId}`}
              >
                {attempt.questionTitle}
              </Link>
              <p className="type-body text-ink">{meta.join(" · ")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {verdict ? (
                <StatusChip tone={verdict.tone} label={verdict.label} />
              ) : null}
              <span className="type-small whitespace-nowrap text-ink">
                <RelativeTime now={now} value={attempt.createdAt} withDate />
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Whether anything is recorded for this student. A student is listed from
 * their first sign-in, so "nothing yet" is a real state. The record page's
 * header uses the same test as the panel so the two never disagree.
 */
export function studentHasActivity(
  summary: InstructorStudentSummary,
  sketchpadMeasurementEnabled = false,
) {
  return (
    summary.sessions > 0 ||
    summary.extraPracticeSessions > 0 ||
    summary.attempts > 0 ||
    summary.aiHelpRequests > 0 ||
    (sketchpadMeasurementEnabled && summary.sketchpadActiveSeconds > 0)
  );
}

export function InstructorStudentDetailPanel({
  aiEnabled = true,
  detail,
  sketchpadMeasurementEnabled = false,
}: {
  /**
   * From the typed server environment (`AI_ENABLED`). With AI off for the
   * deployment the AI tutor tile is hidden: nobody could have asked.
   */
  aiEnabled?: boolean;
  detail: InstructorStudentDetail;
  /**
   * From the typed server environment
   * (`SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED`). While off, the sketchpad
   * tile is not rendered at all: nothing is measured yet.
   */
  sketchpadMeasurementEnabled?: boolean;
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
  // A record with nothing recorded is a real state rather than an error. Say
  // so, and let the zero numbers below stay truthful zeros.
  const hasActivity = studentHasActivity(summary, sketchpadMeasurementEnabled);
  const checkedAnswers =
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
          <p className="type-body max-w-prose text-ink">
            This student has signed in but hasn’t practiced or asked for help
            yet.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Tile
            label="Correct"
            value={formatAccuracy(summary.correctAttempts, checkedAnswers)}
            delta={
              checkedAnswers > 0
                ? `${count(summary.correctAttempts)} of ${plural(checkedAnswers, "answer checked", "answers checked")}`
                : "No answers checked yet"
            }
          />
          <Tile
            label="Study sessions"
            value={count(summary.sessions)}
            delta={`Plus ${plural(summary.extraPracticeSessions, "extra practice question", "extra practice questions")}`}
          />
          <Tile label="Hints used" value={count(summary.hintsUsed)} />
          {aiEnabled ? (
            <Tile
              label="Asked the AI tutor"
              value={count(summary.aiHelpRequests)}
              delta={
                summary.aiHelpRequests > 0
                  ? "Times they asked the AI tutor for help, across all topics since they joined. Asking is a good sign, and it’s not part of any grade. See Students by topic for each topic."
                  : "They haven’t asked the AI tutor yet."
              }
            />
          ) : null}
          <Tile
            label="Solutions viewed"
            value={count(summary.solutionsRevealed)}
          />
          {sketchpadMeasurementEnabled ? (
            <Tile
              label="Time on sketchpad"
              value={formatActiveTime(summary.sketchpadActiveSeconds)}
              delta="About how long they spent drawing on the sketchpad, all topics, since they joined. An estimate."
            />
          ) : null}
        </div>
      </section>

      {attention.length > 0 ? (
        <Zone
          id="student-attention-heading"
          title="Needs help"
          helper="Where this student is struggling, with the numbers behind it."
        >
          <ul className="flex flex-col divide-y divide-rule rounded-panel border-l-2 border-amber-500 bg-sheet px-4">
            {attention.map((signal, index) => (
              <li
                key={`${signal.code}-${signal.topicId ?? index}`}
                className="flex flex-col gap-0.5 py-3 type-body"
              >
                <span className="font-medium text-ink">
                  {signal.topicTitle ?? "The same common mistake, again"}
                </span>
                <span className="text-ink">
                  {attentionText(signal, topics)}
                </span>
              </li>
            ))}
          </ul>
        </Zone>
      ) : null}

      <Zone
        id="student-topics-heading"
        title="Topics practiced"
        helper="Correct is the share of checked answers that were right. It is not a grade."
      >
        {topics.length > 0 ? (
          <div className="rounded-panel bg-sheet">
            <Table
              containerClassName="rounded-panel"
              className={PROFESSOR_TABLE_TYPE}
            >
              <TableCaption className="sr-only">
                Practice by syllabus topic
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="pl-4">
                    Topic
                  </TableHead>
                  <TableHead scope="col" numeric>
                    Answers checked
                  </TableHead>
                  <TableHead scope="col">Correct</TableHead>
                  <TableHead scope="col" numeric>
                    Hints used
                  </TableHead>
                  <TableHead scope="col" numeric>
                    Solutions viewed
                  </TableHead>
                  <TableHead scope="col" className="pr-4">
                    Last active
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topics.map((topic) => {
                  const checked =
                    topic.correctAttempts + (topic.incorrectAttempts ?? 0);
                  return (
                    <TableRow key={topic.topicId}>
                      <TableCell className="min-w-48 pl-4 font-medium">
                        {topic.topicTitle}
                      </TableCell>
                      <TableCell numeric>{checked}</TableCell>
                      <TableCell className="whitespace-nowrap tabular">
                        {formatCorrect(topic.correctAttempts, checked)}
                      </TableCell>
                      <TableCell numeric>{topic.hintsUsed}</TableCell>
                      <TableCell numeric>{topic.solutionsRevealed}</TableCell>
                      <TableCell className="whitespace-nowrap pr-4">
                        <RelativeTime
                          now={now}
                          value={topic.lastActiveAt}
                          withDate
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState className="py-2">
            This student hasn’t practiced any topic yet.
          </EmptyState>
        )}
      </Zone>

      <Zone
        id="student-credit-heading"
        title="Credit suggestions by question"
        helper="What the course practice-credit policy suggests for each assigned question. A suggestion to help you decide, not a grade."
      >
        {creditEvidence.length > 0 ? (
          <CreditSuggestionTable evidence={creditEvidence} />
        ) : (
          <EmptyState className="py-2">
            No assigned-question practice has been recorded for this student
            yet.
          </EmptyState>
        )}
        <CreditPolicyDetails evidence={creditEvidence} />
      </Zone>

      <div className="grid gap-10 lg:grid-cols-3 lg:gap-6">
        <div className="lg:col-span-2">
          <Zone
            id="student-trend-heading"
            title="Answers per day, last 30 days"
            helper="Each bar is one day. The number under it is correct answers out of answers checked."
          >
            {activity.length > 0 ? (
              <div className="rounded-panel bg-sheet p-4">
                <ActivityTrend activity={activity} />
              </div>
            ) : (
              <EmptyState className="py-2">
                No answers in the last 30 days.
              </EmptyState>
            )}
          </Zone>
        </div>

        <Zone
          id="student-misconceptions-heading"
          title="Common mistakes"
          helper="Mistakes the tutor recognized, and in how many study sessions."
        >
          {misconceptions.length > 0 ? (
            <dl className="flex flex-col divide-y divide-rule rounded-panel bg-sheet px-4 type-body">
              {misconceptions.map((misconception) => (
                <div
                  key={misconception.misconceptionId}
                  className="flex min-h-11 items-center justify-between gap-4 py-2"
                >
                  <dt className="min-w-0 text-ink">{misconception.label}</dt>
                  <dd className="shrink-0 tabular text-ink">
                    {plural(misconception.sessions, "session", "sessions")}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <EmptyState className="py-2">
              The tutor hasn’t recognized a common mistake from this student.
            </EmptyState>
          )}
        </Zone>
      </div>

      <Zone
        id="student-recent-heading"
        title="Recent activity"
        helper="The latest things this student did. Their answers are not shown."
      >
        {attempts.length > 0 ? (
          <RecentActivity attempts={attempts} />
        ) : (
          <EmptyState className="py-2">
            This student hasn’t answered anything yet.
          </EmptyState>
        )}
      </Zone>
    </div>
  );
}
