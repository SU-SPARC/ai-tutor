import type { Metadata } from "next";

import { PracticeWorkspace } from "@/components/tutor/practice-workspace";
import { normalizeSummary } from "@/lib/api/question-serialization";
import { requirePracticePageAccess } from "@/lib/auth/practice-page-access";
import { CourseSelectionSync } from "@/components/course/course-selection-sync";
import { getSelectedCourseId } from "@/lib/course-selection";
import { getApprovedQuestions, getTopics } from "@/lib/data/data-store";
import { getServerEnv } from "@/lib/env/server";

import {
  inCourse,
  inferPracticeCourseId,
  inSyllabusOrder,
  readSolvedQuestionIds,
} from "./practice-progress";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Practice" };

type PracticePageProps = {
  searchParams: Promise<{
    questionId?: string | string[];
    sessionId?: string | string[];
    topicId?: string | string[];
  }>;
};

export default async function PracticePage({
  searchParams,
}: PracticePageProps) {
  const {
    questionId: requestedQuestionId,
    sessionId: requestedSessionId,
    topicId: requestedTopicId,
  } = await searchParams;
  const env = getServerEnv();
  await requirePracticePageAccess(
    env,
    practiceReturnPath({
      questionId: requestedQuestionId,
      sessionId: requestedSessionId,
      topicId: requestedTopicId,
    }),
  );

  // Read every course once, then show one: a link that names a question or
  // topic decides the course, otherwise the remembered course does.
  const [everyTopic, everyQuestion, selectedCourseId] = await Promise.all([
    getTopics(),
    getApprovedQuestions(),
    getSelectedCourseId(),
  ]);
  const courseId = inferPracticeCourseId(
    {
      questionId:
        typeof requestedQuestionId === "string"
          ? requestedQuestionId
          : undefined,
      topicId:
        typeof requestedTopicId === "string" ? requestedTopicId : undefined,
    },
    everyTopic,
    everyQuestion,
    selectedCourseId,
  );
  const solvedQuestionIds = await readSolvedQuestionIds(courseId);
  const { questions, topics } = inSyllabusOrder(
    ...scopedToCourse(courseId, everyTopic, everyQuestion),
  );
  const initialQuestionId =
    typeof requestedQuestionId === "string" &&
    questions.some((question) => question.id === requestedQuestionId)
      ? requestedQuestionId
      : undefined;
  const initialTopicId =
    typeof requestedTopicId === "string" &&
    topics.some((topic) => topic.id === requestedTopicId)
      ? requestedTopicId
      : undefined;
  const initialSessionId =
    typeof requestedSessionId === "string" &&
    /^[A-Za-z0-9:_-]{1,128}$/.test(requestedSessionId)
      ? requestedSessionId
      : undefined;

  return (
    <>
      {courseId !== selectedCourseId ? (
        <CourseSelectionSync courseId={courseId} />
      ) : null}
      <PracticeWorkspace
        aiHelpEnabled={env.AI_ENABLED}
        initialQuestionId={initialQuestionId}
        initialSessionId={initialSessionId}
        initialSolvedQuestionIds={solvedQuestionIds}
        initialTopicId={initialTopicId}
        topics={topics}
        questions={questions.map(normalizeSummary)}
      />
    </>
  );
}

function scopedToCourse(
  courseId: string,
  everyTopic: Awaited<ReturnType<typeof getTopics>>,
  everyQuestion: Awaited<ReturnType<typeof getApprovedQuestions>>,
) {
  const scoped = inCourse(courseId, everyTopic, everyQuestion);
  return [scoped.topics, scoped.questions] as const;
}

function practiceReturnPath(params: {
  questionId?: string | string[];
  sessionId?: string | string[];
  topicId?: string | string[];
}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.length > 0) {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query ? `/practice?${query}` : "/practice";
}
