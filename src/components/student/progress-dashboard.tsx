import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  GraduationCap,
  Lightbulb,
  ListRestart,
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
import type { StudentProgressDashboard } from "@/lib/types";

type QuestionProgress = StudentProgressDashboard["questions"][number];

const metricDefinitions = [
  {
    icon: CheckCircle2,
    key: "completedQuestions",
    label: "Questions completed",
  },
  {
    icon: BookOpenCheck,
    key: "inProgressQuestions",
    label: "Questions in progress",
  },
  {
    icon: Lightbulb,
    key: "hintsUsed",
    label: "Hints used",
  },
  {
    icon: ListRestart,
    key: "needsAnotherAttempt",
    label: "Try another attempt",
  },
] as const;

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

  const hasPracticeActivity = progress.questions.length > 0;

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-6 py-8">
        <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-3 -ml-3">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </Link>
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-normal">
                Your practice progress
              </h1>
              <Badge variant="secondary">Saved to your account</Badge>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This is a record of tutor practice activity, not a formal course
              grade.
            </p>
          </div>
          <Button asChild>
            <Link href="/practice">
              <GraduationCap className="h-4 w-4" aria-hidden="true" />
              Practice
            </Link>
          </Button>
        </header>

        <section
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          aria-label="Practice totals"
        >
          {metricDefinitions.map(({ icon: Icon, key, label }) => (
            <Card key={key} className="border-primary/10 shadow-sm">
              <CardHeader className="gap-3 p-5">
                <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-2xl font-semibold tabular-nums">
                    {progress.summary[key]}
                  </p>
                  <CardTitle className="mt-1 text-sm font-medium text-muted-foreground">
                    {label}
                  </CardTitle>
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
                Syllabus topic progress
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
                  {topic.availableQuestions > 0 ? (
                    <>
                      <Progress
                        className="mt-4"
                        aria-label={`${topic.title} practice completion`}
                        indicatorClassName="bg-cta"
                        max={topic.availableQuestions}
                        value={topic.completedQuestions}
                      />
                      <p className="mt-2 text-sm text-muted-foreground">
                        {topic.completedQuestions} of {topic.availableQuestions}{" "}
                        practice questions completed
                        {topic.inProgressQuestions > 0
                          ? ` · ${topic.inProgressQuestions} in progress`
                          : ""}
                      </p>
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

        <section aria-labelledby="another-attempt-heading">
          <div className="mb-3">
            <h2 id="another-attempt-heading" className="text-lg font-semibold">
              Questions to try again
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              These questions have an incorrect attempt and no correct attempt
              yet.
            </p>
          </div>
          {needsAnotherAttempt.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {needsAnotherAttempt.map((question) => (
                <QuestionRow key={question.questionId} question={question} />
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
              No questions currently need another attempt.
            </p>
          )}
        </section>

        <section aria-labelledby="recent-sessions-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="recent-sessions-heading" className="text-lg font-semibold">
              Recent tutor sessions
            </h2>
            <span className="text-xs text-muted-foreground">Most recent 8</span>
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
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {progress.recentSessions.map((session) => (
                    <TableRow key={session.sessionId}>
                      <TableCell className="min-w-56">
                        <span className="font-medium">
                          {session.questionTitle}
                        </span>
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
                              )}
                            >
                              Resume
                              <ArrowRight
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                            </Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Unavailable
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
              No tutor sessions yet.
            </p>
          )}
        </section>
      </section>
    </main>
  );
}

function EmptyProgressState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-start gap-4 p-6">
        <div>
          <h2 className="font-semibold">No saved practice yet</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Start a practice question to build your private progress record.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
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
            <h3 className="font-medium">{question.questionTitle}</h3>
            {question.needsAnotherAttempt ? (
              <Badge variant="outline">Try again</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {question.topicTitle} · {question.attemptCount} attempts ·{" "}
            {question.hintsUsed} hints
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link
            href={resumeHref(question.questionId, question.resumeSessionId)}
          >
            {question.status === "completed" ? "Practice again" : "Resume"}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
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
    return <Badge variant="secondary">Unavailable</Badge>;
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

function resumeHref(questionId: string, sessionId?: string) {
  const params = new URLSearchParams({ questionId });

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
