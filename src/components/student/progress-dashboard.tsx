import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  GraduationCap,
  Lightbulb,
  Play,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { studentQuestionTitle } from "@/lib/labels";
import type { StudentProgressDashboard } from "@/lib/types";

type QuestionProgress = StudentProgressDashboard["questions"][number];
type RecentSession = StudentProgressDashboard["recentSessions"][number];

const metricDefinitions = [
  {
    icon: GraduationCap,
    key: "availableQuestions",
    label: "Questions available",
  },
  {
    icon: CheckCircle2,
    key: "availableCompletedQuestions",
    label: "Completed",
  },
  {
    icon: BookOpenCheck,
    key: "inProgressQuestions",
    label: "In progress",
  },
  {
    icon: Lightbulb,
    key: "hintsUsed",
    label: "Hints used",
  },
] as const;

/**
 * The single action a returning student should take next: resume the most
 * recently active question that still needs work, otherwise start fresh.
 */
export function primaryPracticeAction(progress: StudentProgressDashboard) {
  const resumable = progress.recentSessions.find(
    (session) =>
      session.available &&
      session.status === "in_progress" &&
      session.practiceContext !== "reserve_practice",
  );
  if (resumable) {
    return {
      href: resumeHref(
        resumable.questionId,
        resumable.sessionId,
        resumable.practiceContext,
      ),
      kind: "continue" as const,
      label: "Continue practice",
      questionTitle: studentQuestionTitle(resumable.questionTitle),
    };
  }

  const retry = progress.questions.find(
    (question) => question.available && question.needsAnotherAttempt,
  );
  if (retry) {
    return {
      href: resumeHref(retry.questionId, retry.resumeSessionId),
      kind: "continue" as const,
      label: "Continue practice",
      questionTitle: studentQuestionTitle(retry.questionTitle),
    };
  }

  return {
    href: "/practice",
    kind: "start" as const,
    label:
      progress.questions.length > 0 ? "Practice more" : "Start practicing",
    questionTitle: undefined,
  };
}

export function ProgressDashboard({
  progress,
}: {
  progress: StudentProgressDashboard;
}) {
  const completedQuestions: QuestionProgress[] = [];
  const inProgressQuestions: QuestionProgress[] = [];
  const needsAnotherAttempt: QuestionProgress[] = [];

  for (const question of progress.questions) {
    if (question.status === "completed") {
      completedQuestions.push(question);
    } else {
      inProgressQuestions.push(question);
    }

    if (question.needsAnotherAttempt) {
      needsAnotherAttempt.push(question);
    }
  }

  const hasPracticeActivity =
    progress.questions.length > 0 ||
    (progress.summary.extraPracticeSessions ?? 0) > 0;
  const primaryAction = primaryPracticeAction(progress);

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Your progress
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A private record of your tutor practice. It is not a course
              grade.
            </p>
            {primaryAction.questionTitle ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Up next:{" "}
                <span className="font-medium text-foreground">
                  {primaryAction.questionTitle}
                </span>
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="cta" size="lg">
              <Link href={primaryAction.href}>
                <Play className="h-4 w-4" aria-hidden="true" />
                {primaryAction.label}
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/topics">Choose a topic</Link>
            </Button>
          </div>
        </header>

        <section
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          aria-label="Practice totals"
        >
          {metricDefinitions.map(({ icon: Icon, key, label }) => (
            <Card key={key}>
              <CardHeader className="gap-3 p-4">
                <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-2xl font-semibold tabular-nums">
                    {progress.summary[key]}
                  </p>
                  <CardTitle className="mt-1 text-sm font-medium text-muted-foreground">
                    {label}
                  </CardTitle>
                  {key === "availableCompletedQuestions" &&
                  progress.summary.previouslyCompletedQuestions > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      + {progress.summary.previouslyCompletedQuestions}{" "}
                      completed earlier
                    </p>
                  ) : null}
                </div>
              </CardHeader>
            </Card>
          ))}
        </section>

        {!hasPracticeActivity ? <EmptyProgressState /> : null}

        <section aria-labelledby="syllabus-progress-heading">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2
                id="syllabus-progress-heading"
                className="text-lg font-semibold"
              >
                Progress by topic
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Topics follow the course syllabus order.
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              {progress.summary.topicsStarted} topics started ·{" "}
              {progress.summary.availableQuestions} questions available
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {progress.topics.map((topic, index) => (
              <Card key={topic.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Topic {index + 1}
                      </p>
                      <h3 className="mt-1 font-semibold">{topic.title}</h3>
                    </div>
                    {topic.needsAnotherAttempt > 0 ? (
                      <Badge variant="outline">
                        {topic.needsAnotherAttempt} to try again
                      </Badge>
                    ) : null}
                  </div>
                  {topic.availableQuestions > 0 ||
                  topic.previouslyCompletedQuestions > 0 ? (
                    <>
                      {topic.availableQuestions > 0 ? (
                        <Progress
                          className="mt-4"
                          aria-label={`${topic.title} practice completion`}
                          indicatorClassName="bg-cta"
                          max={topic.availableQuestions}
                          value={topic.completedQuestions}
                        />
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-muted-foreground">
                          {topic.completedQuestions} of {topic.availableQuestions}{" "}
                          completed
                          {topic.previouslyCompletedQuestions > 0
                            ? ` · ${topic.previouslyCompletedQuestions} completed earlier`
                            : ""}
                          {topic.inProgressQuestions > 0
                            ? ` · ${topic.inProgressQuestions} in progress`
                            : ""}
                        </p>
                        {topic.availableQuestions > 0 ? (
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/practice?topicId=${topic.id}`}>
                              {topic.completedQuestions >= topic.availableQuestions
                                ? "Practice again"
                                : "Practice"}
                              <ArrowRight
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">
                      No practice questions are available for this topic yet.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {hasPracticeActivity ? (
          <section
            className="grid gap-5 lg:grid-cols-2"
            aria-label="Question progress"
          >
            <QuestionList
              emptyMessage="No questions are in progress."
              heading="In progress"
              questions={inProgressQuestions}
            />
            <QuestionList
              emptyMessage="Complete a practice question to see it here."
              heading="Completed"
              questions={completedQuestions}
            />
          </section>
        ) : null}

        {needsAnotherAttempt.length > 0 ? (
          <section aria-labelledby="another-attempt-heading">
            <div className="mb-3">
              <h2
                id="another-attempt-heading"
                className="text-lg font-semibold"
              >
                Questions to try again
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                You have not answered these correctly yet.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {needsAnotherAttempt.map((question) => (
                <QuestionRow key={question.questionId} question={question} />
              ))}
            </div>
          </section>
        ) : null}

        {hasPracticeActivity ? (
          <section aria-labelledby="recent-sessions-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2
                id="recent-sessions-heading"
                className="text-lg font-semibold"
              >
                Recent practice
              </h2>
              <span className="text-xs text-muted-foreground">
                Most recent 8
              </span>
            </div>
            {progress.recentSessions.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Question</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Attempts</TableHead>
                      <TableHead className="text-right">Hints</TableHead>
                      <TableHead>Last active</TableHead>
                      <TableHead className="text-right">
                        <span className="sr-only">Action</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {progress.recentSessions.map((session) => (
                      <RecentSessionRow
                        key={session.sessionId}
                        session={session}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
                No practice activity yet.
              </p>
            )}
          </section>
        ) : null}
      </section>
    </main>
  );
}

function RecentSessionRow({ session }: { session: RecentSession }) {
  return (
    <TableRow>
      <TableCell className="min-w-56">
        <span className="font-medium">
          {studentQuestionTitle(session.questionTitle)}
        </span>
        {session.practiceContext === "reserve_practice" ? (
          <Badge variant="success" className="ml-2">
            Extra practice
          </Badge>
        ) : null}
        <span className="mt-1 block text-xs text-muted-foreground">
          {session.topicTitle}
        </span>
      </TableCell>
      <TableCell>
        <ProgressStatusBadge
          needsAnotherAttempt={session.needsAnotherAttempt}
          status={session.status}
        />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {session.attemptCount}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {session.hintsUsed}
      </TableCell>
      <TableCell className="min-w-32 text-muted-foreground">
        {formatSessionDate(session.lastSeenAt)}
      </TableCell>
      <TableCell className="text-right">
        {session.available ? (
          <Button asChild variant="outline" size="sm">
            <Link
              href={resumeHref(
                session.questionId,
                session.sessionId,
                session.practiceContext,
              )}
            >
              {session.status === "completed" ? "Review" : "Resume"}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Not available</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function EmptyProgressState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-start gap-4 p-6">
        <div>
          <h2 className="font-semibold">No saved practice yet</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Pick a topic and answer your first question. Your progress will
            show up here.
          </p>
        </div>
        <Button asChild variant="cta">
          <Link href="/practice">
            Start practicing
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function QuestionList({
  emptyMessage,
  heading,
  questions,
}: {
  emptyMessage: string;
  heading: string;
  questions: QuestionProgress[];
}) {
  const headingId = `question-list-${heading
    .toLowerCase()
    .replaceAll(" ", "-")}`;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-3 text-lg font-semibold">
        {heading}
      </h2>
      {questions.length > 0 ? (
        <div className="space-y-3">
          {questions.map((question) => (
            <QuestionRow key={question.questionId} question={question} />
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      )}
    </section>
  );
}

function QuestionRow({ question }: { question: QuestionProgress }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">
              {studentQuestionTitle(question.questionTitle)}
            </h3>
            {!question.available ? (
              <Badge variant="secondary">No longer available</Badge>
            ) : null}
            {question.needsAnotherAttempt ? (
              <Badge variant="outline">Try again</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {question.topicTitle} · {question.attemptCount} attempts ·{" "}
            {question.hintsUsed} hints
          </p>
        </div>
        {question.available ? (
          <Button asChild variant="outline" size="sm">
            <Link
              href={resumeHref(question.questionId, question.resumeSessionId)}
            >
              {question.status === "completed"
                ? "Practice again"
                : question.resumeSessionId
                  ? "Resume"
                  : "Start"}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProgressStatusBadge({
  needsAnotherAttempt,
  status,
}: {
  needsAnotherAttempt: boolean;
  status: StudentProgressDashboard["recentSessions"][number]["status"];
}) {
  if (status === "unavailable") {
    return <Badge variant="secondary">No longer available</Badge>;
  }

  if (needsAnotherAttempt) {
    return <Badge variant="outline">Try again</Badge>;
  }

  return (
    <Badge variant={status === "completed" ? "default" : "secondary"}>
      {status === "completed" ? "Completed" : "In progress"}
    </Badge>
  );
}

function resumeHref(
  questionId: string,
  sessionId?: string,
  practiceContext?: "published" | "reserve_practice",
) {
  const params = new URLSearchParams();

  if (practiceContext !== "reserve_practice") {
    params.set("questionId", questionId);
  }

  if (sessionId) {
    params.set("sessionId", sessionId);
  }

  return `/practice?${params.toString()}`;
}

function formatSessionDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
