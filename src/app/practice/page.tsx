import { PracticeWorkspace } from "@/components/tutor/practice-workspace"
import { getApprovedQuestions, getTopics } from "@/lib/data/data-store"

type PracticePageProps = {
  searchParams: Promise<{
    questionId?: string | string[]
  }>
}

export default async function PracticePage({
  searchParams,
}: PracticePageProps) {
  const [topics, questions] = await Promise.all([
    getTopics(),
    getApprovedQuestions(),
  ])
  const requestedQuestionId = (await searchParams).questionId
  const initialQuestionId =
    typeof requestedQuestionId === "string" &&
    questions.some((question) => question.id === requestedQuestionId)
      ? requestedQuestionId
      : undefined

  return (
    <PracticeWorkspace
      initialQuestionId={initialQuestionId}
      topics={topics}
      questions={questions}
    />
  )
}
