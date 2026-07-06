import "server-only"

import { generateLlmFallback } from "@/lib/ai/llm"
import { getApprovedQuestionById } from "@/lib/data/data-store"
import { retrieveCourseContext } from "@/lib/tutor/retrieval"
import {
  DEFAULT_USAGE_POLICY,
  canUseLlmFallback,
  estimateTokens,
  getLlmFallbacksRemaining,
  recordTutorInteraction,
} from "@/lib/tutor/usage"
import type {
  Misconception,
  PracticeQuestion,
  TutorRequest,
  TutorResponse,
} from "@/lib/types"

export async function createTutorResponse(
  request: TutorRequest,
): Promise<TutorResponse> {
  const sessionId = request.sessionId || "anonymous-demo-session"
  const answer = request.answer.trim()

  if (answer.length > DEFAULT_USAGE_POLICY.maxInputCharacters) {
    return blockedResponse(
      "That answer is too long for the tutor. Please shorten it and try again.",
      sessionId,
    )
  }

  const question = request.questionId
    ? await getApprovedQuestionById(request.questionId)
    : undefined

  if (question) {
    const response = await buildRuleBasedResponse(
      question,
      answer,
      request.mode,
      sessionId,
    )
    recordTutorInteraction(sessionId, response.usage.estimatedTokens, response.source)
    return response
  }

  const retrievedContext = await retrieveCourseContext(
    `${request.topicId ?? ""} ${answer}`,
    request.topicId,
  )

  if (retrievedContext.length > 0) {
    const response: TutorResponse = {
      source: "retrieval",
      verdict: "guidance",
      message:
        "I found an approved course pattern that is close to your question.",
      hints: [retrievedContext[0].body],
      steps: [],
      misconceptions: [],
      retrievedContext,
      usage: usageFor(sessionId, answer),
    }
    recordTutorInteraction(sessionId, response.usage.estimatedTokens, response.source)
    return response
  }

  if (!request.allowLlmFallback) {
    return blockedResponse(
      "No approved rule or retrieval match was found, and LLM fallback was not requested.",
      sessionId,
    )
  }

  const fallbackCheck = canUseLlmFallback(sessionId, estimateTokens(answer))

  if (!fallbackCheck.allowed) {
    return blockedResponse(fallbackCheck.reason, sessionId)
  }

  const fallback = await generateLlmFallback(answer)

  if (!fallback.ok) {
    return blockedResponse(fallback.reason, sessionId)
  }

  const response: TutorResponse = {
    source: "llm",
    verdict: "guidance",
    message: fallback.text,
    hints: [],
    steps: [],
    misconceptions: [],
    retrievedContext: [],
    usage: usageFor(sessionId, answer),
  }
  recordTutorInteraction(sessionId, response.usage.estimatedTokens, response.source)
  return response
}

async function buildRuleBasedResponse(
  question: PracticeQuestion,
  answer: string,
  mode: TutorRequest["mode"],
  sessionId: string,
): Promise<TutorResponse> {
  if (mode === "hint") {
    return {
      source: "rule",
      verdict: "guidance",
      message: "Start with the approved pattern for this question.",
      hints: question.hints.slice(0, 2),
      steps: [],
      misconceptions: [],
      retrievedContext: await retrieveCourseContext(
        question.prompt,
        question.topicId,
      ),
      usage: usageFor(sessionId, answer),
    }
  }

  if (mode === "solution") {
    return {
      source: "rule",
      verdict: "guidance",
      message: question.answer.explanation,
      hints: [],
      steps: question.solutionSteps,
      misconceptions: [],
      retrievedContext: await retrieveCourseContext(
        question.prompt,
        question.topicId,
      ),
      usage: usageFor(sessionId, answer),
    }
  }

  const isCorrect = answerMatches(question, answer)
  const misconceptions = isCorrect
    ? []
    : matchingMisconceptions(question.misconceptions, answer)

  return {
    source: "rule",
    verdict: isCorrect ? "correct" : "incorrect",
    message: isCorrect
      ? "Correct. Your answer matches the approved solution."
      : "Not quite. Use the hint before jumping to the full solution.",
    hints: isCorrect ? [] : question.hints.slice(0, 1),
    steps: isCorrect ? question.solutionSteps : [],
    misconceptions,
    retrievedContext: [],
    usage: usageFor(sessionId, answer),
  }
}

function answerMatches(question: PracticeQuestion, answer: string) {
  const normalizedAnswer = normalizeText(answer)

  if (
    question.answer.acceptedAnswers.some(
      (acceptedAnswer) => normalizeText(acceptedAnswer) === normalizedAnswer,
    )
  ) {
    return true
  }

  const submittedNumber = parseSubmittedNumber(answer)

  if (
    typeof submittedNumber === "number" &&
    typeof question.answer.numericValue === "number"
  ) {
    const tolerance = question.answer.tolerance ?? 0.001
    return Math.abs(submittedNumber - question.answer.numericValue) <= tolerance
  }

  return false
}

function matchingMisconceptions(
  misconceptions: Misconception[],
  answer: string,
) {
  const normalizedAnswer = normalizeText(answer)

  return misconceptions
    .filter((misconception) =>
      misconception.matchTerms.some((term) =>
        normalizedAnswer.includes(normalizeText(term)),
      ),
    )
    .map((misconception) => misconception.feedback)
}

function parseSubmittedNumber(answer: string) {
  const compact = answer.trim().replaceAll(",", "")
  const fractionMatch = compact.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/)

  if (fractionMatch) {
    const numerator = Number(fractionMatch[1])
    const denominator = Number(fractionMatch[2])
    return denominator === 0 ? undefined : numerator / denominator
  }

  const percentMatch = compact.match(/^(-?\d+(?:\.\d+)?)%$/)

  if (percentMatch) {
    return Number(percentMatch[1]) / 100
  }

  const numericMatch = compact.match(/-?\d+(?:\.\d+)?/)
  return numericMatch ? Number(numericMatch[0]) : undefined
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").trim()
}

function usageFor(sessionId: string, input: string) {
  return {
    estimatedTokens: estimateTokens(input),
    llmFallbacksRemaining: getLlmFallbacksRemaining(sessionId),
  }
}

function blockedResponse(message: string, sessionId: string): TutorResponse {
  return {
    source: "blocked",
    verdict: "blocked",
    message,
    hints: [],
    steps: [],
    misconceptions: [],
    retrievedContext: [],
    usage: {
      estimatedTokens: 0,
      llmFallbacksRemaining: getLlmFallbacksRemaining(sessionId),
    },
  }
}
