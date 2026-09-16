import Link from "next/link";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
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

const VERDICT_LABELS: Record<string, string> = {
  blocked: "Blocked",
  correct: "Correct",
  guidance: "Guidance",
  incorrect: "Incorrect",
};

function formatDate(value: string | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

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

/**
 * A bar per active day, drawn with plain elements. The project has no charting
 * dependency and this does not justify adding one.
 */
function ActivityTrend({
  activity,
}: {
  activity: InstructorStudentActivityPoint[];
}) {
  const busiest = Math.max(...activity.map((point) => point.attempts), 1);

  return (
    <div className="flex items-end gap-2 overflow-x-auto pb-2">
      {activity.map((point) => {
        const height = Math.max(Math.round((point.attempts / busiest) * 96), 6);
        const correctHeight = Math.round(
          (point.correctAttempts / point.attempts) * height,
        );
        return (
          <div
            key={point.date}
            className="flex min-w-10 flex-col items-center gap-2"
          >
            <div
              aria-hidden="true"
              className="flex w-6 flex-col justify-end rounded-sm bg-muted"
              style={{ height: `${height}px` }}
            >
              <div
                className="w-full rounded-sm bg-success"
                style={{ height: `${correctHeight}px` }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground">
              {formatDay(point.date)}
            </span>
            <span className="sr-only">
              {point.correctAttempts} of {point.attempts} attempts correct on{" "}
              {point.date}
            </span>
          </div>
        );
      })}
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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="px-6">Question</TableHead>
          <TableHead className="px-6">Status</TableHead>
          <TableHead className="px-6">Valid attempts</TableHead>
          <TableHead className="px-6">Worked solution before first correct</TableHead>
          <TableHead className="px-6">Similar problem</TableHead>
          <TableHead className="px-6">Start over</TableHead>
          <TableHead className="px-6">Credit route</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {evidence.map((row) => (
          <TableRow key={row.questionId}>
            <TableCell className="px-6 py-3">
              <div className="flex flex-col">
                <span className="font-medium">{row.questionTitle}</span>
                <span className="text-xs text-muted-foreground">
                  {row.topicTitle}
                </span>
              </div>
            </TableCell>
            <TableCell className="px-6 py-3">
              {row.solved ? "Completed" : "Not solved"}
            </TableCell>
            <TableCell className="px-6 py-3">{validAttemptsLabel(row)}</TableCell>
            <TableCell className="px-6 py-3">
              {row.workedSolutionViewedBeforeFirstCorrect ? "Yes" : "No"}
            </TableCell>
            <TableCell className="px-6 py-3">{similarProblemLabel(row)}</TableCell>
            <TableCell className="px-6 py-3">
              {row.startOverUsed ? "Yes" : "—"}
            </TableCell>
            <TableCell className="px-6 py-3">
              <div className="flex flex-col gap-1">
                <Badge
                  variant={
                    row.route === "full"
                      ? "success"
                      : row.route === "partial_similar"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {PRACTICE_CREDIT_ROUTE_LABELS[row.route]}
                </Badge>
                {row.route === "manual_review" ? (
                  <span className="max-w-xs text-xs text-muted-foreground">
                    {MANUAL_REVIEW_REASON}
                  </span>
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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

  return (
    <div className="flex flex-col gap-6">
      {hasActivity ? null : (
        <Alert>
          <AlertDescription>
            No practice activity yet. This student has signed in but has not
            practised with the tutor; their figures will appear here once they
            do.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-7">
        <Metric label="Practice sessions" value={summary.sessions} />
        <Metric label="Extra practice" value={summary.extraPracticeSessions} />
        <Metric label="Answer submissions" value={summary.attempts} />
        <Metric label="Correct" value={summary.correctAttempts} />
        <Metric
          label="Accuracy"
          value={formatAccuracy(
            summary.correctAttempts,
            summary.correctAttempts + (summary.incorrectAttempts ?? 0),
          )}
        />
        <Metric label="Hints" value={summary.hintsUsed} />
        <Metric label="Solutions" value={summary.solutionsRevealed} />
      </div>

      {attention.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Repeated difficulty detected</CardTitle>
            <CardDescription>
              Derived from recorded counts alone. Each line shows the figures it
              came from so the reasoning stays checkable.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {attention.map((signal, index) => (
                <li
                  key={`${signal.code}-${signal.topicId ?? index}`}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0"
                >
                  <span className="text-sm">
                    {signal.topicTitle ? (
                      <span className="font-medium">{signal.topicTitle}</span>
                    ) : (
                      <span className="font-medium">
                        Recurring misconception
                      </span>
                    )}{" "}
                    — {signal.detail}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Topic performance</CardTitle>
          <CardDescription>
            Practice progress by syllabus topic. Accuracy is the share of answer
            submissions marked correct; it is not a mastery score.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {topics.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-6">Topic</TableHead>
                  <TableHead className="px-6">Attempts</TableHead>
                  <TableHead className="px-6">Correct</TableHead>
                  <TableHead className="px-6">Accuracy</TableHead>
                  <TableHead className="px-6">Hints</TableHead>
                  <TableHead className="px-6">Solutions</TableHead>
                  <TableHead className="px-6">Last active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topics.map((topic) => (
                  <TableRow key={topic.topicId}>
                    <TableCell className="px-6 py-3 font-medium">
                      {topic.topicTitle}
                    </TableCell>
                    <TableCell className="px-6 py-3">
                      {topic.attempts}
                    </TableCell>
                    <TableCell className="px-6 py-3">
                      {topic.correctAttempts}
                    </TableCell>
                    <TableCell className="px-6 py-3">
                      {formatAccuracy(
                        topic.correctAttempts,
                        topic.correctAttempts + (topic.incorrectAttempts ?? 0),
                      )}
                    </TableCell>
                    <TableCell className="px-6 py-3">
                      {topic.hintsUsed}
                    </TableCell>
                    <TableCell className="px-6 py-3">
                      {topic.solutionsRevealed}
                    </TableCell>
                    <TableCell className="px-6 py-3 text-muted-foreground">
                      {formatDate(topic.lastActiveAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-6 text-sm text-muted-foreground">
              No topic practice has been recorded for this student yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Practice credit evidence</CardTitle>
          <CardDescription>
            What the record supports under the course practice-credit policy,
            per assigned question. A valid attempt is an answer the tutor could
            read and marked correct or incorrect; unreadable submissions, hints,
            solution reveals, and AI help are not attempts. The full-credit
            route is a correct answer within {FULL_CREDIT_VALID_ATTEMPT_LIMIT}{" "}
            valid attempts with the worked solution not revealed before it —
            revealing the solution first ends that route for the question. The
            partial route is a solved linked similar problem. Attempts are
            counted across Start over. Manual review marks a question solved
            after the worked solution without a solved similar problem: the
            record cannot show whether a similar problem was available, so no
            number is derived. This is evidence for your decision, not a grade.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {creditEvidence.length > 0 ? (
            <CreditEvidenceTable evidence={creditEvidence} />
          ) : (
            <p className="px-6 text-sm text-muted-foreground">
              No assigned-question practice has been recorded for this student
              yet.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Practice over the last 30 days</CardTitle>
            <CardDescription>
              Answer submissions per active day; the filled portion is the share
              marked correct.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activity.length > 0 ? (
              <ActivityTrend activity={activity} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No practice has been recorded in the last 30 days.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recorded misconceptions</CardTitle>
            <CardDescription>
              Counted from the misconception codes the tutor recorded, never
              inferred from a low score.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {misconceptions.length > 0 ? (
              <ul className="flex flex-col divide-y">
                {misconceptions.map((misconception) => (
                  <li
                    key={misconception.misconceptionId}
                    className="flex items-center justify-between gap-4 py-3 first:pt-0"
                  >
                    <span className="text-sm">{misconception.label}</span>
                    <span className="text-sm font-medium">
                      {misconception.sessions}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No misconception codes have been recorded for this student.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            The most recent recorded interactions. Submitted answers and tutor
            feedback text are deliberately not shown.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {attempts.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-6">When</TableHead>
                  <TableHead className="px-6">Question</TableHead>
                  <TableHead className="px-6">Interaction</TableHead>
                  <TableHead className="px-6">Result</TableHead>
                  <TableHead className="px-6">Tutor path</TableHead>
                  <TableHead className="px-6">Misconception</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attempts.map((attempt) => (
                  <TableRow key={attempt.id}>
                    <TableCell className="px-6 py-3 text-muted-foreground">
                      {formatDate(attempt.createdAt)}
                    </TableCell>
                    <TableCell className="px-6 py-3">
                      <div className="flex flex-col">
                        <Link
                          className="font-medium text-primary hover:underline"
                          href={`/practice/${attempt.questionId}`}
                        >
                          {attempt.questionTitle}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {attempt.topicTitle}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-3">
                      {MODE_LABELS[attempt.mode] ?? attempt.mode}
                    </TableCell>
                    <TableCell className="px-6 py-3">
                      {attempt.verdict ? (
                        <Badge
                          variant={
                            attempt.verdict === "correct"
                              ? "success"
                              : attempt.verdict === "incorrect"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {VERDICT_LABELS[attempt.verdict] ?? attempt.verdict}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-6 py-3 text-muted-foreground">
                      {SOURCE_LABELS[attempt.source] ?? attempt.source}
                    </TableCell>
                    <TableCell className="px-6 py-3 text-muted-foreground">
                      {attempt.misconceptionDetected ? "Detected" : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-6 text-sm text-muted-foreground">
              This student has no recorded attempts yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
