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
import {
  readStudentSectionContent,
  type StudentSectionContent,
} from "@/lib/tutor/section-access";
import {
  selectSectionQuestions,
  selectSectionTopics,
  withPinnedQuestions,
} from "@/lib/tutor/section-content";
import type { StudentProgressDashboard } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Learn",
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
 *
 * A student in a course section sees only that section: its released
 * questions whose topic is open (or scheduled and already open), in the
 * section's topic and question order. Everyone else sees the global list.
 */
export default async function LearnPage() {
  const [topics, questions, { isGuest, progress, section }] = await Promise.all(
    [getTopics(), getApprovedQuestions(), readOwnProgress()],
  );

  const now = new Date();
  const orderedTopics = section
    ? selectSectionTopics(topics, section.releases, now)
    : sortTopicsForSyllabus(topics);
  const orderedQuestions = section
    ? selectSectionQuestions(
        withPinnedQuestions(questions, section.pinnedQuestions),
        section.releases,
        now,
      )
    : sortQuestionsForSyllabus(questions);
  const model = buildLearnModel({
    isGuest,
    nowIso: now.toISOString(),
    progress,
    questions: orderedQuestions.map(normalizeSummary),
    topics: orderedTopics,
  });

  return <LearnScreen model={model} />;
}

/**
 * The student's own progress (`null` for a visitor with no identity yet) and
 * whether they are a guest. Guest is decided by the owner kind, not by the
 * absence of progress: a browser with anonymous practice has progress that
 * lives only in this browser. `requireStudentAccess` throws when there is
 * neither a session nor an anonymous cookie; that is the guest case, not an
 * error.
 */
async function readOwnProgress(): Promise<{
  isGuest: boolean;
  progress: StudentProgressDashboard | null;
  section: StudentSectionContent | undefined;
}> {
  let authorization;

  try {
    authorization = await requireStudentAccess({ allowAnonymous: true });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return { isGuest: true, progress: null, section: undefined };
    }
    throw error;
  }

  const [progress, section] = await Promise.all([
    getStudentProgress(authorization),
    readStudentSectionContent(authorization.owner, { pinnedContent: true }),
  ]);
  return {
    isGuest: authorization.owner.kind !== "user",
    progress,
    section,
  };
}
