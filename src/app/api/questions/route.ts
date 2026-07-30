import { NextResponse } from "next/server"

import {
  isValidDifficulty,
  isValidSourceType,
  matchesSearch,
  normalizeSummary,
} from "@/lib/api/question-serialization"
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable"
import {
  getApprovedQuestions,
  listQuestionsByTopic,
} from "@/lib/data/data-store"
import { isStudentFacingQuestion } from "@/lib/data/demo-repository"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const topic = searchParams.get("topic")?.trim() || undefined
  const difficulty = searchParams.get("difficulty")?.trim() || undefined
  const sourceType = searchParams.get("sourceType")?.trim() || undefined
  const query = searchParams.get("q")?.trim() || undefined

  if (difficulty && !isValidDifficulty(difficulty)) {
    return NextResponse.json(
      { error: `Invalid difficulty: ${difficulty}` },
      { status: 400 },
    )
  }

  if (sourceType && !isValidSourceType(sourceType)) {
    return NextResponse.json(
      { error: `Invalid sourceType: ${sourceType}` },
      { status: 400 },
    )
  }

  try {
    // Both reads return only approved, public, student-facing questions.
    const base = topic
      ? await listQuestionsByTopic(topic)
      : await getApprovedQuestions()

    const questions = base
      .filter(isStudentFacingQuestion)
      .filter((question) => (difficulty ? question.difficulty === difficulty : true))
      .filter((question) =>
        sourceType ? question.source.sourceType === sourceType : true,
      )
      .filter((question) => (query ? matchesSearch(question, query) : true))
      .map(normalizeSummary)

    return NextResponse.json({
      count: questions.length,
      filters: { topic, difficulty, sourceType, q: query },
      questions,
    })
  } catch {
    return dataServiceUnavailableResponse()
  }
}
