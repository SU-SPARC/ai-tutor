import { Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { compareCanonicalTopicIds } from "@/lib/data/canonical-syllabus-topics";
import { formatAccuracy } from "@/lib/professor/student-pseudonym";
import type { ProfessorPracticeAnalytics } from "@/lib/types";

const RELIABLE_QUESTION_ATTEMPTS = 4;

type QuestionPerformance = ProfessorPracticeAnalytics["questions"][number];

export function InstructorPracticePerformance({
  practice,
}: {
  practice: ProfessorPracticeAnalytics;
}) {
  const topics = [...practice.topics].sort(
    (left, right) =>
      compareCanonicalTopicIds(left.topicId, right.topicId) ||
      left.topicTitle.localeCompare(right.topicTitle),
  );
  const questions = [...practice.questions].sort(compareQuestionPerformance);

  return (
    <section className="flex flex-col gap-6" aria-label="Practice performance">
      {practice.mode === "demo" ? (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertTitle>Demonstration performance data</AlertTitle>
          <AlertDescription>
            These topic and question rows are public demo fixtures, not results
            from a recorded class.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Topic performance</CardTitle>
            <PracticeScopeBadge mode={practice.mode} />
          </div>
          <CardDescription>
            Published normal-practice sessions only. Answer attempts count
            checks; hints, solutions, and LLM fallbacks are reported separately.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-6">Topic</TableHead>
                <TableHead className="text-right">Answer attempts</TableHead>
                <TableHead className="text-right">Correct %</TableHead>
                <TableHead className="text-right">Hints used</TableHead>
                <TableHead className="text-right">Solutions revealed</TableHead>
                <TableHead className="px-6 text-right">LLM fallbacks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topics.length > 0 ? (
                topics.map((topic) => (
                  <TableRow key={topic.topicId}>
                    <TableCell className="px-6 font-medium">
                      {topic.topicTitle}
                    </TableCell>
                    <TableCell className="text-right">
                      {topic.attempts}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatAccuracy(
                        topic.correctAttempts,
                        topic.correctAttempts + (topic.incorrectAttempts ?? 0),
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {topic.hintsUsed}
                    </TableCell>
                    <TableCell className="text-right">
                      {topic.stepsRevealed}
                    </TableCell>
                    <TableCell className="px-6 text-right">
                      {topic.llmAttempts}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <EmptyRow
                  columns={6}
                  message="No published topic practice has been recorded yet."
                />
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Question performance</CardTitle>
          <CardDescription>
            Questions with at least four scored answer checks are ranked by
            lowest correct percentage. Lower-volume questions follow by attempt
            count and are not labeled as difficult.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-6">Question title</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead className="text-right">Answer attempts</TableHead>
                <TableHead className="text-right">Correct %</TableHead>
                <TableHead className="text-right">Hints</TableHead>
                <TableHead className="text-right">Solutions revealed</TableHead>
                <TableHead className="px-6 text-right">LLM fallbacks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {questions.length > 0 ? (
                questions.map((question) => (
                  <TableRow key={question.questionId}>
                    <TableCell className="px-6 font-medium">
                      {question.questionTitle}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {question.topicTitle}
                    </TableCell>
                    <TableCell className="text-right">
                      {question.attempts}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatAccuracy(
                        question.correctAttempts,
                        question.correctAttempts + question.incorrectAttempts,
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {question.hintsUsed}
                    </TableCell>
                    <TableCell className="text-right">
                      {question.stepsRevealed}
                    </TableCell>
                    <TableCell className="px-6 text-right">
                      {question.llmAttempts}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <EmptyRow
                  columns={7}
                  message="No published question practice has been recorded yet."
                />
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}

function compareQuestionPerformance(
  left: QuestionPerformance,
  right: QuestionPerformance,
) {
  const leftHasEvidence =
    left.correctAttempts + left.incorrectAttempts >= RELIABLE_QUESTION_ATTEMPTS;
  const rightHasEvidence =
    right.correctAttempts + right.incorrectAttempts >=
    RELIABLE_QUESTION_ATTEMPTS;

  if (leftHasEvidence !== rightHasEvidence) {
    return leftHasEvidence ? -1 : 1;
  }

  if (leftHasEvidence && rightHasEvidence) {
    const accuracyDifference =
      left.correctAttempts / (left.correctAttempts + left.incorrectAttempts) -
      right.correctAttempts / (right.correctAttempts + right.incorrectAttempts);

    if (accuracyDifference !== 0) {
      return accuracyDifference;
    }
  }

  return (
    right.attempts - left.attempts ||
    compareCanonicalTopicIds(left.topicId, right.topicId) ||
    left.questionTitle.localeCompare(right.questionTitle) ||
    left.questionId.localeCompare(right.questionId)
  );
}

function PracticeScopeBadge({
  mode,
}: {
  mode: ProfessorPracticeAnalytics["mode"];
}) {
  return (
    <Badge variant={mode === "database" ? "success" : "secondary"}>
      {mode === "database" ? "Recorded class data" : "Demo data"}
    </Badge>
  );
}

function EmptyRow({ columns, message }: { columns: number; message: string }) {
  return (
    <TableRow>
      <TableCell
        className="px-6 py-8 text-center text-muted-foreground"
        colSpan={columns}
      >
        {message}
      </TableCell>
    </TableRow>
  );
}
