import "server-only"

import { getServerEnv } from "@/lib/env/server"
import {
  createUsageScope,
  getBudgetFallbacksRemaining,
  releaseLlmBudget,
  reserveLlmBudget,
  resetUsageControlForTests,
  settleLlmBudget,
  type LlmBudgetReservation,
  type LlmTokenSettlement,
  type UsageScope,
} from "@/lib/tutor/usage-control"
import type { LlmUsageLimitReason } from "@/lib/types"

export type TokenBudgetRecord = {
  anonymousStudentId: string
  sessionId: string
  questionId: string
  llmCallsUsed: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  createdAt: string
}

export type TokenBudgetLimits = {
  maxDailyLlmCallsPerAnonymousStudent: number
  maxInputCharactersPerMessage: number
  maxLlmCallsPerQuestionSession: number
  maxOutputTokensRequested: number
}

export type TokenBudgetReservation = {
  record: TokenBudgetRecord
  usageReservation: LlmBudgetReservation
}

type TokenBudgetResult =
  | {
      allowed: true
      reservation: TokenBudgetReservation
    }
  | {
      allowed: false
      reason: LlmUsageLimitReason
    }

type TokenBudgetScopeInput = {
  anonymousStudentId: string
  questionId: string
  sessionId: string
  topicId?: string
}

type ReserveTokenBudgetInput = TokenBudgetScopeInput & {
  estimatedInputTokens: number
  estimatedOutputTokens: number
  scope: UsageScope
  studentMessage: string
  totalTokens: number
}

const completedRecords: TokenBudgetRecord[] = []
const pendingRecords = new Map<string, TokenBudgetRecord>()
const MAX_TEST_RECORDS = 1_000

export function getTokenBudgetLimits(): TokenBudgetLimits {
  const env = getServerEnv()

  return {
    maxDailyLlmCallsPerAnonymousStudent: env.MAX_LLM_CALLS_PER_STUDENT_PER_DAY,
    maxInputCharactersPerMessage: env.MAX_TUTOR_INPUT_CHARS,
    maxLlmCallsPerQuestionSession: env.MAX_LLM_CALLS_PER_SESSION,
    maxOutputTokensRequested: env.MAX_LLM_OUTPUT_TOKENS,
  }
}

export function createTokenBudgetScope({
  anonymousStudentId,
  questionId,
  sessionId,
  topicId,
}: TokenBudgetScopeInput) {
  return createUsageScope({
    questionId,
    sessionId,
    studentId: anonymousStudentId,
    topicId,
  })
}

export function validateTokenBudgetInput(studentMessage: string) {
  if (
    studentMessage.length > getTokenBudgetLimits().maxInputCharactersPerMessage
  ) {
    return {
      allowed: false as const,
      reason: "input_too_long" as const,
    }
  }

  return { allowed: true as const }
}

export async function reserveTokenBudget({
  anonymousStudentId,
  estimatedInputTokens,
  estimatedOutputTokens,
  questionId,
  scope,
  sessionId,
  studentMessage,
  totalTokens,
}: ReserveTokenBudgetInput): Promise<TokenBudgetResult> {
  const inputCheck = validateTokenBudgetInput(studentMessage)
  if (!inputCheck.allowed) {
    return inputCheck
  }

  const budget = await reserveLlmBudget({ scope, totalTokens })
  if (!budget.allowed) {
    return budget
  }

  const remaining = await getBudgetFallbacksRemaining(sessionId)
  const record: TokenBudgetRecord = {
    anonymousStudentId,
    sessionId,
    questionId,
    llmCallsUsed: Math.max(
      1,
      getTokenBudgetLimits().maxLlmCallsPerQuestionSession - remaining,
    ),
    estimatedInputTokens,
    estimatedOutputTokens,
    createdAt: new Date().toISOString(),
  }
  pendingRecords.set(budget.reservation.id, record)

  return {
    allowed: true,
    reservation: {
      record,
      usageReservation: budget.reservation,
    },
  }
}

export async function settleTokenBudget(
  reservation: TokenBudgetReservation,
  settlement: LlmTokenSettlement,
) {
  await settleLlmBudget(reservation.usageReservation, settlement)
  const record = pendingRecords.get(reservation.usageReservation.id)
  pendingRecords.delete(reservation.usageReservation.id)

  if (record) {
    completedRecords.push(record)
    if (completedRecords.length > MAX_TEST_RECORDS) {
      completedRecords.splice(0, completedRecords.length - MAX_TEST_RECORDS)
    }
  }
}

export async function releaseTokenBudget(reservation: TokenBudgetReservation) {
  pendingRecords.delete(reservation.usageReservation.id)
  await releaseLlmBudget(reservation.usageReservation)
}

export function getTokenBudgetRecordsForTests() {
  return completedRecords.map((record) => ({ ...record }))
}

export function resetTokenBudgetForTests() {
  completedRecords.length = 0
  pendingRecords.clear()
  resetUsageControlForTests()
}
