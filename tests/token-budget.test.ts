import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createTokenBudgetScope,
  getTokenBudgetLimits,
  getTokenBudgetRecordsForTests,
  reserveTokenBudget,
  resetTokenBudgetForTests,
  settleTokenBudget,
  validateTokenBudgetInput,
} from "@/lib/security/token-budget"

describe("token budget", () => {
  beforeEach(() => {
    vi.stubEnv("APP_DEMO_MODE", "true")
    vi.stubEnv("USAGE_KEY_SECRET", "test-usage-secret")
    vi.stubEnv("MAX_LLM_CALLS_PER_SESSION", "")
    vi.stubEnv("MAX_LLM_CALLS_PER_QUESTION_PER_DAY", "")
    vi.stubEnv("MAX_LLM_CALLS_PER_STUDENT_PER_DAY", "")
    vi.stubEnv("MAX_TUTOR_INPUT_CHARS", "")
    vi.stubEnv("MAX_LLM_OUTPUT_TOKENS", "")
    resetTokenBudgetForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("exposes conservative configurable defaults", () => {
    expect(getTokenBudgetLimits()).toEqual({
      maxDailyLlmCallsPerAnonymousStudent: 5,
      maxInputCharactersPerMessage: 800,
      maxLlmCallsPerQuestionSession: 3,
      maxOutputTokensRequested: 180,
    })

    vi.stubEnv("MAX_LLM_CALLS_PER_SESSION", "4")
    vi.stubEnv("MAX_LLM_CALLS_PER_STUDENT_PER_DAY", "7")
    vi.stubEnv("MAX_TUTOR_INPUT_CHARS", "600")
    vi.stubEnv("MAX_LLM_OUTPUT_TOKENS", "120")

    expect(getTokenBudgetLimits()).toEqual({
      maxDailyLlmCallsPerAnonymousStudent: 7,
      maxInputCharactersPerMessage: 600,
      maxLlmCallsPerQuestionSession: 4,
      maxOutputTokensRequested: 120,
    })
  })

  it("tracks the requested fields after a successful LLM call", async () => {
    const anonymousStudentId = "anonymous-student-1"
    const questionId = "dice-sum-eight"
    const sessionId = "session-1"
    const scope = createTokenBudgetScope({
      anonymousStudentId,
      questionId,
      sessionId,
    })
    const budget = await reserveTokenBudget({
      anonymousStudentId,
      estimatedInputTokens: 90,
      estimatedOutputTokens: 180,
      questionId,
      scope,
      sessionId,
      studentMessage: "I need help with conditional probability.",
      totalTokens: 270,
    })

    expect(budget.allowed).toBe(true)
    if (!budget.allowed) {
      return
    }

    await settleTokenBudget(budget.reservation, {
      estimatedTokens: 270,
      providerCompletionTokens: 25,
      providerPromptTokens: 75,
      providerTotalTokens: 100,
    })

    expect(getTokenBudgetRecordsForTests()).toEqual([
      {
        anonymousStudentId,
        sessionId,
        questionId,
        llmCallsUsed: 1,
        estimatedInputTokens: 90,
        estimatedOutputTokens: 180,
        createdAt: expect.any(String),
      },
    ])
  })

  it("rejects overlong LLM input without reserving a call", async () => {
    const studentMessage = "x".repeat(801)

    expect(validateTokenBudgetInput(studentMessage)).toEqual({
      allowed: false,
      reason: "input_too_long",
    })

    const budget = await reserveTokenBudget({
      anonymousStudentId: "anonymous-student-1",
      estimatedInputTokens: 201,
      estimatedOutputTokens: 180,
      questionId: "dice-sum-eight",
      scope: createTokenBudgetScope({
        anonymousStudentId: "anonymous-student-1",
        questionId: "dice-sum-eight",
        sessionId: "session-1",
      }),
      sessionId: "session-1",
      studentMessage,
      totalTokens: 381,
    })

    expect(budget).toEqual({
      allowed: false,
      reason: "input_too_long",
    })
    expect(getTokenBudgetRecordsForTests()).toHaveLength(0)
  })
})
