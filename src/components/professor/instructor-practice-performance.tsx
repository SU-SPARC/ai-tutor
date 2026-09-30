import {
  formatCorrect,
  PROFESSOR_TABLE_TYPE,
} from "@/components/professor/instructor-student-table";
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
import type { ProfessorPracticeAnalytics } from "@/lib/types";

/** Fewer checked answers than this is too little to call something hard. */
const RELIABLE_ANSWERS_CHECKED = 4;

type QuestionPerformance = ProfessorPracticeAnalytics["questions"][number];
type TopicPerformance = ProfessorPracticeAnalytics["topics"][number];

type Difficulty = {
  attempts: number;
  correctAttempts: number;
  incorrectAttempts?: number;
};

function checked(row: Difficulty) {
  return row.correctAttempts + (row.incorrectAttempts ?? 0);
}

/**
 * Hardest first: rows with enough checked answers come first, lowest share
 * correct at the top; the rest follow, most answered first, and are not
 * called hard.
 */
function compareDifficulty(left: Difficulty, right: Difficulty) {
  const leftChecked = checked(left);
  const rightChecked = checked(right);
  const leftHasEvidence = leftChecked >= RELIABLE_ANSWERS_CHECKED;
  const rightHasEvidence = rightChecked >= RELIABLE_ANSWERS_CHECKED;

  if (leftHasEvidence !== rightHasEvidence) {
    return leftHasEvidence ? -1 : 1;
  }

  if (leftHasEvidence && rightHasEvidence) {
    const difference =
      left.correctAttempts / leftChecked - right.correctAttempts / rightChecked;
    if (difference !== 0) {
      return difference;
    }
  }

  return right.attempts - left.attempts;
}

function compareTopicPerformance(
  left: TopicPerformance,
  right: TopicPerformance,
) {
  return (
    compareDifficulty(left, right) ||
    compareCanonicalTopicIds(left.topicId, right.topicId) ||
    left.topicTitle.localeCompare(right.topicTitle)
  );
}

function compareQuestionPerformance(
  left: QuestionPerformance,
  right: QuestionPerformance,
) {
  return (
    compareDifficulty(left, right) ||
    compareCanonicalTopicIds(left.topicId, right.topicId) ||
    left.questionTitle.localeCompare(right.questionTitle) ||
    left.questionId.localeCompare(right.questionId)
  );
}

/**
 * The two "hardest first" tables for the questions students can see. Each
 * has an h2 and a visible line above it that says how it is ordered. Tutor
 * internals (which engine answered) stay in the research export.
 */
export function InstructorPracticePerformance({
  practice,
}: {
  practice: ProfessorPracticeAnalytics;
}) {
  const topics = [...practice.topics].sort(compareTopicPerformance);
  const questions = [...practice.questions].sort(compareQuestionPerformance);
  const demoNote =
    practice.mode === "demo"
      ? " These are sample numbers for the demo, not a real class."
      : "";

  return (
    <div className="flex flex-col gap-8">
      <section
        aria-labelledby="topic-performance-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="topic-performance-heading" className="type-h2 text-ink">
          Topics students find hardest
        </h2>
        <p id="topic-performance-note" className="type-small text-ink">
          Hardest topics first. Topics with fewer than{" "}
          {RELIABLE_ANSWERS_CHECKED} answers checked come last.{demoNote}
        </p>
        <div className="rounded-panel bg-sheet">
          <Table
            containerClassName="rounded-panel"
            className={PROFESSOR_TABLE_TYPE}
            aria-describedby="topic-performance-note"
          >
            <TableCaption className="sr-only">
              Topics, hardest first
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
                <TableHead scope="col" numeric className="pr-4">
                  Solutions viewed
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
                    <TableCell numeric>{checked(topic)}</TableCell>
                    <TableCell className="whitespace-nowrap tabular">
                      {formatCorrect(topic.correctAttempts, checked(topic))}
                    </TableCell>
                    <TableCell numeric>{topic.hintsUsed}</TableCell>
                    <TableCell numeric className="pr-4">
                      {topic.stepsRevealed}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <EmptyRow
                  columns={5}
                  message="No student has practiced a topic yet."
                />
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section
        aria-labelledby="question-performance-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="question-performance-heading" className="type-h2 text-ink">
          Questions students find hardest
        </h2>
        <p id="question-performance-note" className="type-small text-ink">
          Hardest questions first. Questions with fewer than{" "}
          {RELIABLE_ANSWERS_CHECKED} answers checked come last, most answered
          first.{demoNote}
        </p>
        <div className="rounded-panel bg-sheet">
          <Table
            stickyHeader
            containerClassName="rounded-panel lg:max-h-[70svh]"
            className={`[&_thead_th]:bg-sheet ${PROFESSOR_TABLE_TYPE}`}
            aria-describedby="question-performance-note"
          >
            <TableCaption className="sr-only">
              Questions, hardest first
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="pl-4">
                  Question
                </TableHead>
                <TableHead scope="col">Topic</TableHead>
                <TableHead scope="col" numeric>
                  Answers checked
                </TableHead>
                <TableHead scope="col">Correct</TableHead>
                <TableHead scope="col" numeric>
                  Hints used
                </TableHead>
                <TableHead scope="col" numeric className="pr-4">
                  Solutions viewed
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
                    <TableCell className="min-w-40">
                      {question.topicTitle}
                    </TableCell>
                    <TableCell numeric>{checked(question)}</TableCell>
                    <TableCell className="whitespace-nowrap tabular">
                      {formatCorrect(
                        question.correctAttempts,
                        checked(question),
                      )}
                    </TableCell>
                    <TableCell numeric>{question.hintsUsed}</TableCell>
                    <TableCell numeric className="pr-4">
                      {question.stepsRevealed}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <EmptyRow
                  columns={6}
                  message="No student has answered a question yet."
                />
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function EmptyRow({ columns, message }: { columns: number; message: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="px-4 py-6" colSpan={columns}>
        {message}
      </TableCell>
    </TableRow>
  );
}
