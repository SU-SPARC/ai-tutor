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

  const topics = await getTopics();
  const topic = topics.find((item) => item.id === topicId);

  if (!topic) {
    notFound();
  }

  const [topicQuestions, allQuestions, { isGuest, progress }] = await Promise.all([
    listQuestionsByTopic(topic.id),
    getApprovedQuestions(),
    readOwnProgress(),
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
    <TopicScreen
      model={model}
      nextTopic={
        next
          ? { href: next.href, title: next.title, weekNumber: next.weekNumber }
          : undefined
      }
      topics={syllabus.topics}
    />
  );
}

/** Same rule as `/learn`: guest is the owner kind, not "no progress". */
async function readOwnProgress(): Promise<{
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
    progress: await getStudentProgress(authorization),
  };
}
