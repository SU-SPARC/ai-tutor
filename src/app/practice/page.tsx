import { PracticeWorkspace } from "@/components/tutor/practice-workspace";
import { normalizeSummary } from "@/lib/api/question-serialization";
import { requirePracticePageAccess } from "@/lib/auth/practice-page-access";
import { getApprovedQuestions, getTopics } from "@/lib/data/data-store";
import { getServerEnv } from "@/lib/env/server";

export const dynamic = "force-dynamic";

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

  const [topics, questions] = await Promise.all([
    getTopics(),
    getApprovedQuestions(),
  ]);
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
    <PracticeWorkspace
      aiHelpEnabled={env.AI_ENABLED}
      initialQuestionId={initialQuestionId}
      initialSessionId={initialSessionId}
      initialTopicId={initialTopicId}
      topics={topics}
      questions={questions.map(normalizeSummary)}
    />
  );
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
