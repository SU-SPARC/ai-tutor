import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  buildLearnModel,
  buildTopicModel,
  isTopicIdShape,
  nextUnfinishedTopic,
} from "@/components/learn/learn-model";
import {
  sortQuestionsForSyllabus,
  sortTopicsForSyllabus,
} from "@/components/learn/learn-order";
import { TopicScreen } from "@/components/learn/topic-screen";
import { normalizeSummary } from "@/lib/api/question-serialization";
import {
  AuthenticationRequiredError,
  requireStudentAccess,
} from "@/lib/auth/authorization";
import {
  getApprovedQuestions,
  getTopics,
  listQuestionsByTopic,
} from "@/lib/data/data-store";
import { CourseSelectionSync } from "@/components/course/course-selection-sync";
import { getSelectedCourse } from "@/lib/course-selection";
import type { CourseScope } from "@/lib/data/repository";
import { getStudentProgress } from "@/lib/data/student-progress";
import type { StudentProgressDashboard } from "@/lib/types";

export const dynamic = "force-dynamic";

type TopicPageProps = {
  params: Promise<{ topic: string }>;
};

export async function generateMetadata({
  params,
}: TopicPageProps): Promise<Metadata> {
  const { topic: topicId } = await params;
  if (!isTopicIdShape(topicId)) {
    return { title: "Topic not found" };
  }
  const topic = (await getTopics()).find((item) => item.id === topicId);
  if (!topic) {
    return { title: "Topic not found" };
  }
  return {
    title: topic.title,
    description: topic.description,
  };
}

/**
 * H2. One topic: its questions as a dot row and a list of collapsed Sheets.
 * The id shape is checked before anything is read — an id that could not name
 * a topic is a 404, not a lookup.
 */
export default async function TopicPage({ params }: TopicPageProps) {
  const { topic: topicId } = await params;

  if (!isTopicIdShape(topicId)) {
    notFound();
  }

  // A direct link may name a topic in any course. The topic decides the
  // course, so the page shows that course's syllabus and progress and the
  // remembered course follows it.
  const allTopics = await getTopics();
  const topic = allTopics.find((item) => item.id === topicId);

  if (!topic) {
    notFound();
  }

  const scope: CourseScope = { courseId: topic.courseId };
  const topics = allTopics.filter((item) => item.courseId === topic.courseId);
  const [{ course: selectedCourse }, topicQuestions, allQuestions, { isGuest, progress }] =
    await Promise.all([
      getSelectedCourse(),
      listQuestionsByTopic(topic.id),
      getApprovedQuestions(scope),
      readOwnProgress(scope),
    ]);

  const nowIso = new Date().toISOString();
  const orderedTopics = sortTopicsForSyllabus(topics);
  // The rail shows the whole syllabus with its glyphs, so it needs the same
  // model `/learn` builds; the screen itself only renders this topic.
  const syllabus = buildLearnModel({
    isGuest,
    nowIso,
    progress,
    questions: sortQuestionsForSyllabus(allQuestions).map(normalizeSummary),
    topics: orderedTopics,
  });
  const model = buildTopicModel({
    isGuest,
    nowIso,
    progress,
    questions: sortQuestionsForSyllabus(topicQuestions).map(normalizeSummary),
    topic,
  });

  // A finished topic points forward, never at a dead end.
  const next = nextUnfinishedTopic(syllabus.topics, topic.id);

  return (
    <>
      {selectedCourse.id !== topic.courseId ? (
        <CourseSelectionSync courseId={topic.courseId} />
      ) : null}
      <TopicScreen
        model={model}
        nextTopic={
          next
            ? {
                href: next.href,
                title: next.title,
                weekNumber: next.weekNumber,
              }
            : undefined
        }
        topics={syllabus.topics}
      />
    </>
  );
}

/** Same rule as `/learn`: guest is the owner kind, not "no progress". */
async function readOwnProgress(scope: CourseScope): Promise<{
  isGuest: boolean;
  progress: StudentProgressDashboard | null;
}> {
  let authorization;

  try {
    authorization = await requireStudentAccess({ allowAnonymous: true });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return { isGuest: true, progress: null };
    }
    throw error;
  }

  return {
    isGuest: authorization.owner.kind !== "user",
    progress: await getStudentProgress(authorization, scope),
  };
}
