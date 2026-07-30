import { PracticeWorkspace } from "@/components/tutor/practice-workspace"
import { getApprovedQuestions, getTopics } from "@/lib/data/data-store"

type PracticePageProps = {
  searchParams: Promise<{
    questionId?: string | string[]
    topicId?: string | string[]
  }>
}

export default async function PracticePage({
  searchParams,
}: PracticePageProps) {
  const [topics, questions] = await Promise.all([
    getTopics(),
    getApprovedQuestions(),
  ])
  const { questionId: requestedQuestionId, topicId: requestedTopicId } =
    await searchParams
  const initialQuestionId =
    typeof requestedQuestionId === "string" &&
    questions.some((question) => question.id === requestedQuestionId)
      ? requestedQuestionId
      : undefined
  const initialTopicId =
    typeof requestedTopicId === "string" &&
    topics.some((topic) => topic.id === requestedTopicId)
      ? requestedTopicId
      : undefined

  return (
    <PracticeWorkspace
      initialQuestionId={initialQuestionId}
      initialTopicId={initialTopicId}
      topics={topics}
      questions={questions}
    />
  )
}
