import { PracticeWorkspace } from "@/components/tutor/practice-workspace";
import { getApprovedQuestions, getTopics } from "@/lib/data/data-store";

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
  const [topics, questions] = await Promise.all([
    getTopics(),
    getApprovedQuestions(),
  ]);
  const {
    questionId: requestedQuestionId,
    sessionId: requestedSessionId,
    topicId: requestedTopicId,
  } = await searchParams;
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
      initialQuestionId={initialQuestionId}
      initialSessionId={initialSessionId}
      initialTopicId={initialTopicId}
      topics={topics}
      questions={questions}
    />
  );
}
