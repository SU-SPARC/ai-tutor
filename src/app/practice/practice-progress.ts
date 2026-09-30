import "server-only";

import {
  sortQuestionsForSyllabus,
  sortTopicsForSyllabus,
} from "@/components/learn/learn-order";
import {
  AuthenticationRequiredError,
  requireStudentAccess,
} from "@/lib/auth/authorization";
import { getStudentProgress } from "@/lib/data/student-progress";
import type { CourseTopic, TutorQuestion } from "@/lib/types";

/**
 * The questions this visitor has already solved, from the same progress
 * `/learn` reads (`getStudentProgress`): a signed-in student's, or a guest's
 * through the anonymous identity their stored sessions belong to. A visitor
 * with neither has solved nothing.
 *
 * Solved marks are a courtesy, not a gate: if progress cannot be read, the
 * page still renders with every question unmarked rather than failing.
 */
export async function readSolvedQuestionIds(
  courseId?: string,
): Promise<string[]> {
  try {
    const authorization = await requireStudentAccess({ allowAnonymous: true });
    // Solved marks are per course: a question solved in another course never
    // marks anything here.
    const progress = await getStudentProgress(authorization, { courseId });
    return (progress?.questions ?? [])
      .filter((question) => question.status === "completed")
      .map((question) => question.questionId);
  } catch (error) {
    if (!(error instanceof AuthenticationRequiredError)) {
      console.warn("practice: solved questions could not be read", error);
    }
    return [];
  }
}

/**
 * The course a practice page is showing. A direct link names a question or a
 * topic, and that decides the course; with neither, the remembered course
 * stands. A link to something that does not exist falls back the same way.
 */
export function inferPracticeCourseId(
  input: { questionId?: string; topicId?: string },
  everyTopic: CourseTopic[],
  everyQuestion: TutorQuestion[],
  selectedCourseId: string,
) {
  const topicCourseIds = new Map(
    everyTopic.map((topic) => [topic.id, topic.courseId]),
  );
  const question = input.questionId
    ? everyQuestion.find((candidate) => candidate.id === input.questionId)
    : undefined;
  const topicId = question?.topicId ?? input.topicId;
  return (topicId ? topicCourseIds.get(topicId) : undefined) ?? selectedCourseId;
}

/** Narrows topics and questions to one course, through each question's topic. */
export function inCourse(
  courseId: string,
  everyTopic: CourseTopic[],
  everyQuestion: TutorQuestion[],
) {
  const topics = everyTopic.filter((topic) => topic.courseId === courseId);
  const topicIds = new Set(topics.map((topic) => topic.id));
  return {
    questions: everyQuestion.filter((question) =>
      topicIds.has(question.topicId),
    ),
    topics,
  };
}

/**
 * Topics and questions in syllabus order, the order `/learn` numbers them in,
 * so "Question 3 of 6" means the same question on both pages.
 */
export function inSyllabusOrder(
  topics: CourseTopic[],
  questions: TutorQuestion[],
) {
  return {
    questions: sortQuestionsForSyllabus(questions),
    topics: sortTopicsForSyllabus(topics),
  };
}
