import {
  Table,
  TableBody,
  TableCaption,
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

/**
 * Topic and question performance for published practice: two dense tables
 * with numeric columns, each introduced by an h2 and footnoted by its caption
 * (scope, ranking rule, and whether the rows are demo fixtures). No cards,
 * no badges; a demo notice is one quiet line in the caption.
 */
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
  const demoNote =
    practice.mode === "demo"
      ? " Demo fixtures, not results from a recorded class."
      : "";

  return (
    <div className="flex flex-col gap-8">
      <section
        aria-labelledby="topic-performance-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="topic-performance-heading" className="type-h2 text-ink">
          Topic performance
        </h2>
        <div className="rounded-panel bg-sheet">
          <Table
            containerClassName="rounded-panel"
            aria-describedby="topic-performance-note"
          >
            <TableCaption className="sr-only">
              Topic performance, in syllabus order
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="pl-4">
                  Topic
                </TableHead>
                <TableHead scope="col" numeric>
                  Answer attempts
                </TableHead>
                <TableHead scope="col" numeric>
                  Correct %
                </TableHead>
                <TableHead scope="col" numeric>
                  Hints used
                </TableHead>
                <TableHead scope="col" numeric>
                  Solutions revealed
                </TableHead>
                <TableHead scope="col" numeric className="pr-4">
                  LLM fallbacks
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topics.length > 0 ? (
                topics.map((topic) => (
                  <TableRow key={topic.topicId}>
                    <TableCell className="min-w-48 pl-4 font-medium">
                      {topic.topicTitle}
                    </TableCell>
                    <TableCell numeric>{topic.attempts}</TableCell>
                    <TableCell numeric>
                      {formatAccuracy(
                        topic.correctAttempts,
                        topic.correctAttempts + (topic.incorrectAttempts ?? 0),
                      )}
                    </TableCell>
                    <TableCell numeric>{topic.hintsUsed}</TableCell>
                    <TableCell numeric>{topic.stepsRevealed}</TableCell>
                    <TableCell numeric className="pr-4">
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
        </div>
        <p id="topic-performance-note" className="type-caption max-w-prose">
          Published normal-practice sessions only. Answer attempts count checks;
          hints, solutions and LLM fallbacks are counted separately.
          {demoNote}
        </p>
      </section>

      <section
        aria-labelledby="question-performance-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="question-performance-heading" className="type-h2 text-ink">
          Question performance
        </h2>
        <div className="rounded-panel bg-sheet">
          <Table
            stickyHeader
            containerClassName="rounded-panel lg:max-h-[70svh]"
            className="[&_thead_th]:bg-sheet"
            aria-describedby="question-performance-note"
          >
            <TableCaption className="sr-only">
              Question performance, lowest correct percentage first
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="pl-4">
                  Question title
                </TableHead>
                <TableHead scope="col">Topic</TableHead>
                <TableHead scope="col" numeric>
                  Answer attempts
                </TableHead>
                <TableHead scope="col" numeric>
                  Correct %
                </TableHead>
                <TableHead scope="col" numeric>
                  Hints
                </TableHead>
                <TableHead scope="col" numeric>
                  Solutions revealed
                </TableHead>
                <TableHead scope="col" numeric className="pr-4">
                  LLM fallbacks
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {questions.length > 0 ? (
                questions.map((question) => (
                  <TableRow key={question.questionId}>
                    <TableCell className="min-w-56 pl-4 font-medium">
                      {question.questionTitle}
                    </TableCell>
                    <TableCell className="min-w-40 text-ink-muted">
                      {question.topicTitle}
                    </TableCell>
                    <TableCell numeric>{question.attempts}</TableCell>
                    <TableCell numeric>
                      {formatAccuracy(
                        question.correctAttempts,
                        question.correctAttempts + question.incorrectAttempts,
                      )}
                    </TableCell>
                    <TableCell numeric>{question.hintsUsed}</TableCell>
                    <TableCell numeric>{question.stepsRevealed}</TableCell>
                    <TableCell numeric className="pr-4">
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
        </div>
        <p id="question-performance-note" className="type-caption max-w-prose">
          Questions with at least four scored answer checks come first, lowest
          correct percentage at the top. Lower-volume questions follow by
          attempt count and are not labeled as difficult.{demoNote}
        </p>
      </section>
    </div>
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

function EmptyRow({ columns, message }: { columns: number; message: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="px-4 py-6 text-ink-muted" colSpan={columns}>
        {message}
      </TableCell>
    </TableRow>
  );
}
