import "server-only"

import { difficultyLabel, sourceLabel } from "@/lib/labels"
import {
  SOURCE_TYPES,
  type Difficulty,
  type SourceType,
  type TutorQuestion,
} from "@/lib/types"

export const DIFFICULTIES: readonly Difficulty[] = [
  "foundational",
  "intermediate",
  "challenge",
]

export type QuestionSummary = {
  id: string
  topicId: string
  title: string
  prompt: string
  difficulty: Difficulty
  difficultyLabel: string
  sourceType: SourceType
  sourceLabel: string
  hintCount: number
  stepCount: number
}

export type QuestionDetail = QuestionSummary & {
  hints: string[]
  solutionSteps: string[]
  answer: {
    acceptedAnswers: string[]
    explanation: string
    numericValue?: number
    tolerance?: number
  }
  misconceptions: Array<{ id: string; feedback: string }>
}

/**
 * Public list shape. Deliberately omits answers, solution steps, and
 * misconception match terms so a plain listing never leaks solutions.
 */
export function normalizeSummary(question: TutorQuestion): QuestionSummary {
  return {
    id: question.id,
    topicId: question.topicId,
    title: question.title,
    prompt: question.prompt,
    difficulty: question.difficulty,
    difficultyLabel: difficultyLabel(question.difficulty),
    sourceType: question.source.sourceType,
    sourceLabel: sourceLabel(question.source),
    hintCount: question.hints.length,
    stepCount: question.solutionSteps.length,
  }
}

/**
 * Full practice detail for a single approved question. Includes hints,
 * solution steps, and accepted answers (the same approved public content the
 * practice workspace already receives), but never internal match terms.
 */
export function normalizeDetail(question: TutorQuestion): QuestionDetail {
  return {
    ...normalizeSummary(question),
    hints: question.hints,
    solutionSteps: question.solutionSteps,
    answer: {
      acceptedAnswers: question.answer.acceptedAnswers,
      explanation: question.answer.explanation,
      numericValue: question.answer.numericValue,
      tolerance: question.answer.tolerance,
    },
    misconceptions: question.misconceptions.map((misconception) => ({
      id: misconception.id,
      feedback: misconception.feedback,
    })),
  }
}

export function isValidDifficulty(value: string): value is Difficulty {
  return (DIFFICULTIES as readonly string[]).includes(value)
}

export function isValidSourceType(value: string): value is SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(value)
}

export function matchesSearch(question: TutorQuestion, query: string) {
  const haystack = `${question.title} ${question.prompt}`.toLowerCase()
  return haystack.includes(query.toLowerCase())
}
