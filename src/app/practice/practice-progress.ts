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
import {
  readStudentSectionContent,
  type StudentSectionContent,
} from "@/lib/tutor/section-access";
import {
  sectionDeliveryByQuestionId,
  selectSectionQuestions,
  selectSectionTopics,
  withPinnedQuestions,
} from "@/lib/tutor/section-content";
import type {
  CourseTopic,
  StudentProgressDashboard,
  TutorQuestion,
} from "@/lib/types";

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
  return (await readPracticeVisitor()).solvedQuestionIds;
}

/**
 * Everything `/practice` needs to know about the visitor, from one identity
 * lookup: what they solved, and the course section they joined (if any),
 * whose releases narrow the question list.
 */
export async function readPracticeVisitor(): Promise<{
  section?: StudentSectionContent;
  solvedQuestionIds: string[];
}> {
  let authorization;
  try {
    authorization = await requireStudentAccess({ allowAnonymous: true });
  } catch (error) {
    if (!(error instanceof AuthenticationRequiredError)) {
      console.warn("practice: solved questions could not be read", error);
    }
    return { solvedQuestionIds: [] };
  }

  const [progress, section] = await Promise.all([
    readProgressQuietly(authorization),
    readStudentSectionContent(authorization.owner, { pinnedContent: true }),
  ]);
  return {
    section,
    solvedQuestionIds: (progress?.questions ?? [])
      .filter((question) => question.status === "completed")
      .map((question) => question.questionId),
  };
}

async function readProgressQuietly(
  authorization: Parameters<typeof getStudentProgress>[0],
): Promise<StudentProgressDashboard | null | undefined> {
  try {
    return await getStudentProgress(authorization);
  } catch (error) {
    console.warn("practice: solved questions could not be read", error);
    return null;
  }
}

/**
 * The practice list for this visitor: a section student gets the section's
 * visible released questions and topics in the section's order, with each
 * question's delivery settings; everyone else the syllabus-ordered global
 * list (`inSyllabusOrder`) and no delivery limits.
 */
export function practiceScope(
  topics: CourseTopic[],
  questions: TutorQuestion[],
  section: StudentSectionContent | undefined,
  now: Date = new Date(),
) {
  if (!section) {
    return { ...inSyllabusOrder(topics, questions), delivery: undefined };
  }
  return {
    delivery: sectionDeliveryByQuestionId(section.releases, now),
    // Each at the version the section pinned (what the tutor grades).
    questions: selectSectionQuestions(
      withPinnedQuestions(questions, section.pinnedQuestions),
      section.releases,
      now,
    ),
    topics: selectSectionTopics(topics, section.releases, now),
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
