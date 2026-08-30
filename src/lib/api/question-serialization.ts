import "server-only"

import { difficultyLabel, sourceLabel } from "@/lib/labels"
import {
  SOURCE_TYPES,
  type Difficulty,
  type SourceType,
  type StudentPracticeQuestion,
  type TutorQuestion,
} from "@/lib/types"

export const DIFFICULTIES: readonly Difficulty[] = [
  "foundational",
  "intermediate",
  "challenge",
]

export type QuestionSummary = StudentPracticeQuestion
export type QuestionDetail = QuestionSummary

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
 * Public detail is intentionally the same pre-session metadata as the list.
 * Hint bodies, solution steps, answer rules/explanations, and misconception
 * feedback are disclosed only through an owned tutor session as progress
 * permits.
 */
export function normalizeDetail(question: TutorQuestion): QuestionDetail {
  return normalizeSummary(question)
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
