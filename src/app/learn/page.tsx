import type { Metadata } from "next";

import { buildLearnModel } from "@/components/learn/learn-model";
import { LearnScreen } from "@/components/learn/learn-screen";
import {
  sortQuestionsForSyllabus,
  sortTopicsForSyllabus,
} from "@/components/learn/learn-order";
import { normalizeSummary } from "@/lib/api/question-serialization";
import {
  AuthenticationRequiredError,
  requireStudentAccess,
} from "@/lib/auth/authorization";
import { getApprovedQuestions, getTopics } from "@/lib/data/data-store";
import { getStudentProgress } from "@/lib/data/student-progress";
import type { StudentProgressDashboard } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Learn · Suffolk Probability & Statistics Tutor",
  description:
    "Your syllabus, what to continue, and every practice question your professor has approved.",
};

/**
 * H1. The page a student lands on: the old dashboard and the old topic index
 * are one screen, because both existed to answer "what next?".
 *
 * Progress is read for whoever is here — a signed-in student or a browser that
 * already has an anonymous practice identity. A visitor with neither is not
 * redirected to sign in: they get the same page with the syllabus and an
 * invitation to join, because the syllabus is public and a dead end is worse
 * than an empty progress column.
 */
export default async function LearnPage() {
  const [topics, questions, progress] = await Promise.all([
    getTopics(),
    getApprovedQuestions(),
    readOwnProgress(),
  ]);

  const orderedTopics = sortTopicsForSyllabus(topics);
  const orderedQuestions = sortQuestionsForSyllabus(questions);
  const model = buildLearnModel({
    nowIso: new Date().toISOString(),
    progress,
    questions: orderedQuestions.map(normalizeSummary),
    topics: orderedTopics,
  });

  return <LearnScreen model={model} />;
}

/**
 * The student's own progress, or `null` for a true guest. `requireStudentAccess`
 * throws when there is neither a session nor an anonymous cookie; that is the
 * guest case, not an error.
 */
async function readOwnProgress(): Promise<StudentProgressDashboard | null> {
  let authorization;

  try {
    authorization = await requireStudentAccess({ allowAnonymous: true });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return null;
    }
    throw error;
  }

  return getStudentProgress(authorization);
}
