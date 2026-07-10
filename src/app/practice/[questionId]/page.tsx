import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PracticeWorkspace } from "@/components/tutor/practice-workspace"
import {
  getApprovedQuestionById,
  getApprovedQuestions,
  getTopics,
} from "@/lib/data/data-store"
import { getServerEnv } from "@/lib/env/server"

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
    title: `${question.title} · Practice`,
    description: question.prompt.slice(0, 150),
  }
}

export default async function PracticeQuestionPage({
  params,
}: PracticeQuestionPageProps) {
  const { questionId } = await params

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
      initialQuestionId={question.id}
      maxTutorInputChars={getServerEnv().MAX_TUTOR_INPUT_CHARS}
      topics={topics}
      questions={questions}
    />
  )
}
