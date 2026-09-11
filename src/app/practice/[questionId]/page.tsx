import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PracticeWorkspace } from "@/components/tutor/practice-workspace"
import { normalizeSummary } from "@/lib/api/question-serialization"
import { requirePracticePageAccess } from "@/lib/auth/practice-page-access"
import {
  getApprovedQuestionById,
  getApprovedQuestions,
  getTopics,
} from "@/lib/data/data-store"
import { getServerEnv } from "@/lib/env/server"
import { studentQuestionTitle } from "@/lib/labels"

export const dynamic = "force-dynamic"

type PracticeQuestionPageProps = {
  params: Promise<{ questionId: string }>
}

export async function generateMetadata({
  params,
}: PracticeQuestionPageProps): Promise<Metadata> {
  const { questionId } = await params
  const question = await getApprovedQuestionById(questionId)
  if (!question) {
    return { title: "Question not found" }
  }
  return {
    title: `${studentQuestionTitle(question.title)} · Practice`,
    description: question.prompt.slice(0, 150),
  }
}

export default async function PracticeQuestionPage({
  params,
}: PracticeQuestionPageProps) {
  const { questionId } = await params
  const env = getServerEnv()
  await requirePracticePageAccess(
    env,
    `/practice/${encodeURIComponent(questionId)}`,
  )

  const question = await getApprovedQuestionById(questionId)
  if (!question) {
    notFound()
  }

  const [topics, questions] = await Promise.all([
    getTopics(),
    getApprovedQuestions(),
  ])

  return (
    <PracticeWorkspace
      aiHelpEnabled={env.AI_ENABLED}
      initialQuestionId={question.id}
      topics={topics}
      questions={questions.map(normalizeSummary)}
    />
  )
}
