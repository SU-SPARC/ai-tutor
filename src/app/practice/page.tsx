import { PracticeWorkspace } from "@/components/tutor/practice-workspace"
import { getApprovedQuestions, getTopics } from "@/lib/data/data-store"

export default async function PracticePage() {
  const [topics, questions] = await Promise.all([
    getTopics(),
    getApprovedQuestions(),
  ])

  return <PracticeWorkspace topics={topics} questions={questions} />
}
