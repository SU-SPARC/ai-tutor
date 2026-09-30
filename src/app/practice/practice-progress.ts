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
export async function readSolvedQuestionIds(): Promise<string[]> {
  try {
    const authorization = await requireStudentAccess({ allowAnonymous: true });
    const progress = await getStudentProgress(authorization);
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
