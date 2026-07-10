import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createUsageScope,
  getUsageDashboard,
  reserveLlmBudget,
  resetUsageControlForTests,
  settleLlmBudget,
} from "@/lib/tutor/usage-control"

describe("LLM usage controls", () => {
  beforeEach(() => {
    resetUsageControlForTests()
    vi.stubEnv("APP_DEMO_MODE", "true")
    vi.stubEnv("USAGE_KEY_SECRET", "test-usage-secret")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("enforces a per-question daily limit across restarted sessions", async () => {
    vi.stubEnv("MAX_LLM_CALLS_PER_QUESTION_PER_DAY", "1")
    const firstScope = createUsageScope({
      questionId: "q-1",
      sessionId: "session-1",
      studentId: "student-1",
    })
    const first = await reserveLlmBudget({
      scope: firstScope,
      totalTokens: 200,
    })

    expect(first.allowed).toBe(true)
    if (!first.allowed) {
      return
    }

    await settleLlmBudget(first.reservation, {
      providerCompletionTokens: 40,
      providerPromptTokens: 80,
      providerTotalTokens: 120,
      estimatedTokens: 200,
    })

    const restartedScope = createUsageScope({
      questionId: "q-1",
      sessionId: "session-2",
      studentId: "student-1",
    })
    const denied = await reserveLlmBudget({
      scope: restartedScope,
      totalTokens: 200,
    })

    expect(denied).toEqual({
      allowed: false,
      reason: "question_daily_limit",
    })
  })

  it("enforces the session call and token limits before a provider call", async () => {
    vi.stubEnv("MAX_LLM_TOKENS_PER_SESSION", "300")
    const scope = createUsageScope({
      questionId: "q-1",
      sessionId: "session-1",
      studentId: "student-1",
    })
    const first = await reserveLlmBudget({ scope, totalTokens: 250 })

    expect(first.allowed).toBe(true)
    if (!first.allowed) {
      return
    }

    await settleLlmBudget(first.reservation, { estimatedTokens: 250 })

    await expect(
      reserveLlmBudget({ scope, totalTokens: 100 }),
    ).resolves.toEqual({
      allowed: false,
      reason: "session_token_budget",
    })
  })

  it("counts pending reservations toward the session call limit", async () => {
    vi.stubEnv("MAX_LLM_CALLS_PER_SESSION", "2")
    const firstScope = createUsageScope({
      questionId: "q-1",
      sessionId: "session-1",
      studentId: "student-1",
    })
    const secondScope = createUsageScope({
      questionId: "q-2",
      sessionId: "session-1",
      studentId: "student-1",
    })
    const thirdScope = createUsageScope({
      questionId: "q-3",
      sessionId: "session-1",
      studentId: "student-1",
    })

    await expect(
      reserveLlmBudget({ scope: firstScope, totalTokens: 100 }),
    ).resolves.toMatchObject({
      allowed: true,
    })
    await expect(
      reserveLlmBudget({ scope: secondScope, totalTokens: 100 }),
    ).resolves.toMatchObject({
      allowed: true,
    })
    await expect(
      reserveLlmBudget({ scope: thirdScope, totalTokens: 100 }),
    ).resolves.toEqual({
      allowed: false,
      reason: "session_call_limit",
    })
  })

  it("enforces student and global daily limits across questions", async () => {
    vi.stubEnv("MAX_LLM_CALLS_PER_STUDENT_PER_DAY", "2")
    vi.stubEnv("MAX_DAILY_LLM_CALLS", "3")

    const first = await reserveAndSettle("student-1", "session-1", "q-1")
    const second = await reserveAndSettle("student-1", "session-2", "q-2")
    expect(first).toBe(true)
    expect(second).toBe(true)

    const studentLimited = await reserveLlmBudget({
      scope: createUsageScope({
        questionId: "q-3",
        sessionId: "session-3",
        studentId: "student-1",
      }),
      totalTokens: 100,
    })
    expect(studentLimited).toEqual({
      allowed: false,
      reason: "student_daily_limit",
    })

    expect(await reserveAndSettle("student-2", "session-4", "q-1")).toBe(true)
    const globallyLimited = await reserveLlmBudget({
      scope: createUsageScope({
        questionId: "q-1",
        sessionId: "session-5",
        studentId: "student-3",
      }),
      totalTokens: 100,
    })
    expect(globallyLimited).toEqual({
      allowed: false,
      reason: "global_daily_limit",
    })
  })

  it("reports aggregate provider-token usage without student identifiers", async () => {
    const scope = createUsageScope({
      questionId: "q-1",
      sessionId: "session-1",
      studentId: "student-1",
    })
    const reservation = await reserveLlmBudget({ scope, totalTokens: 200 })
    expect(reservation.allowed).toBe(true)
    if (!reservation.allowed) {
      return
    }

    await settleLlmBudget(reservation.reservation, {
      providerCompletionTokens: 30,
      providerPromptTokens: 70,
      providerTotalTokens: 100,
      estimatedTokens: 200,
    })

    const dashboard = await getUsageDashboard()

    expect(dashboard.mode).toBe("demo")
    expect(dashboard.today).toMatchObject({
      inputTokens: 70,
      llmCalls: 1,
      outputTokens: 30,
      totalTokens: 100,
    })
    expect(JSON.stringify(dashboard)).not.toContain("student-1")
  })

  it("disables LLM spending outside demo mode without durable configuration", async () => {
    vi.stubEnv("APP_DEMO_MODE", "false")
    vi.stubEnv("DATABASE_URL", "")
    vi.stubEnv("USAGE_KEY_SECRET", "")

    await expect(
      reserveLlmBudget({
        scope: createUsageScope({
          questionId: "q-1",
          sessionId: "session-1",
          studentId: "student-1",
        }),
        totalTokens: 100,
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "usage_persistence_unavailable",
    })
  })
})

async function reserveAndSettle(
  studentId: string,
  sessionId: string,
  questionId: string,
) {
  const reservation = await reserveLlmBudget({
    scope: createUsageScope({ questionId, sessionId, studentId }),
    totalTokens: 100,
  })
  if (!reservation.allowed) {
    return false
  }

  await settleLlmBudget(reservation.reservation, {
    providerCompletionTokens: 20,
    providerPromptTokens: 40,
    providerTotalTokens: 60,
    estimatedTokens: 100,
  })
  return true
}
