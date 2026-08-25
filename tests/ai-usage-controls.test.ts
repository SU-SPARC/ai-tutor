import { afterEach, describe, expect, it, vi } from "vitest"

import {
  accountingForGeneratedResponse,
  applyTutorAiAccounting,
  AiGenerationInProgressError,
  prepareTutorAiGeneration,
  releaseTutorAiReservation,
  resetAiUsageControlsForTests,
  type TutorAiExecutionContext,
} from "@/lib/ai/usage-controls"
import type { LlmTutorInput } from "@/lib/ai/llm-tutor"

describe("production AI usage controls", () => {
  afterEach(() => {
    vi.useRealTimers()
    resetAiUsageControlsForTests()
    vi.unstubAllEnvs()
  })

  it("caches guarded output for the same student without a provider token charge", async () => {
    enableTestAi()
    const context = executionContext("student-a")
    const prepared = await prepareTutorAiGeneration(
      context,
      promptInput(),
      estimatedTokens(),
    )

    expect(prepared.outcome).toBe("reserved")
    const accounting = accountingForGeneratedResponse(
      prepared.accounting,
      {
        contextUsed: true,
        estimatedTokens: {
          ...estimatedTokens(),
          providerCompletionTokens: 20,
          providerPromptTokens: 80,
          providerTotalTokens: 100,
        },
        fallbackUsed: true,
        providerAttempts: 1,
        tutorMessage: "Start with the conditioned sample space.",
      },
      "approved_course_content",
    )
    await applyTutorAiAccounting(accounting)

    const cached = await prepareTutorAiGeneration(
      context,
      promptInput(),
      estimatedTokens(),
    )

    expect(cached.outcome).toBe("cache_hit")
    if (cached.outcome === "cache_hit") {
      expect(cached.cacheResult).toMatchObject({
        fallbackUsed: true,
        providerAttempts: 0,
        tutorMessage: "Start with the conditioned sample space.",
      })
      expect(cached.cacheResult.estimatedTokens?.estimatedTotalTokens).toBe(0)
    }
  })

  it("never shares a cache entry across students", async () => {
    enableTestAi()
    const first = await prepareTutorAiGeneration(
      executionContext("student-a"),
      promptInput(),
      estimatedTokens(),
    )
    const accounting = accountingForGeneratedResponse(
      first.accounting,
      {
        contextUsed: false,
        fallbackUsed: true,
        providerAttempts: 1,
        tutorMessage: "Use the next approved step.",
      },
      "general_ai_help",
    )
    await applyTutorAiAccounting(accounting)

    const second = await prepareTutorAiGeneration(
      executionContext("student-b"),
      promptInput(),
      estimatedTokens(),
    )

    expect(second.outcome).toBe("reserved")
    expect(second.accounting.studentKeyHash).not.toBe(
      first.accounting.studentKeyHash,
    )
  })

  it("permits only one in-flight generation per session", async () => {
    enableTestAi()
    const firstContext = executionContext("student-a")
    await prepareTutorAiGeneration(
      firstContext,
      promptInput(),
      estimatedTokens(),
    )

    await expect(
      prepareTutorAiGeneration(
        { ...firstContext, eventId: "event:second" },
        promptInput(),
        estimatedTokens(),
      ),
    ).rejects.toBeInstanceOf(AiGenerationInProgressError)
  })

  it("expires cached guidance and invalidates it when session state changes", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-25T12:00:00Z"))
    enableTestAi()
    const context = executionContext("student-a")
    const prepared = await prepareTutorAiGeneration(
      context,
      promptInput(),
      estimatedTokens(),
    )
    await applyTutorAiAccounting(
      accountingForGeneratedResponse(
        prepared.accounting,
        {
          contextUsed: false,
          fallbackUsed: true,
          providerAttempts: 1,
          tutorMessage: "Use the event definition before selecting a formula.",
        },
        "general_ai_help",
      ),
    )

    const changedState = await prepareTutorAiGeneration(
      { ...context, eventId: "event:changed", expectedRevision: 4 },
      promptInput(),
      estimatedTokens(),
    )
    expect(changedState.outcome).toBe("reserved")
    await releaseTutorAiReservation(changedState.accounting)

    vi.advanceTimersByTime(15 * 60 * 1_000 + 1)
    const expired = await prepareTutorAiGeneration(
      { ...context, eventId: "event:expired" },
      promptInput(),
      estimatedTokens(),
    )
    expect(expired.outcome).toBe("reserved")
  })

  it("releases a failed generation without caching it", async () => {
    enableTestAi()
    const context = executionContext("student-a")
    const prepared = await prepareTutorAiGeneration(
      context,
      promptInput(),
      estimatedTokens(),
    )
    await applyTutorAiAccounting(
      accountingForGeneratedResponse(
        prepared.accounting,
        {
          contextUsed: false,
          error: "provider_unavailable",
          fallbackUsed: false,
          providerAttempts: 2,
          tutorMessage: "AI help is temporarily unavailable.",
        },
        "general_ai_help",
      ),
    )

    const retry = await prepareTutorAiGeneration(
      { ...context, eventId: "event:retry" },
      promptInput(),
      estimatedTokens(),
    )

    expect(retry.outcome).toBe("reserved")
    expect(retry.accounting.providerCalls).toBe(0)
  })
})

function enableTestAi() {
  vi.stubEnv("AI_ENABLED", "true")
  vi.stubEnv("OPENROUTER_API_KEY", "test-key")
}

function executionContext(studentId: string): TutorAiExecutionContext {
  return {
    eventId: "event:first",
    expectedRevision: 3,
    mode: "check",
    owner: { anonymousId: studentId, kind: "anonymous" },
    questionId: "question-1",
    questionVersionId: 7,
    sessionId: "session-1",
    topicId: "conditional-probability",
  }
}

function promptInput(): LlmTutorInput {
  return {
    allowedDisclosure: "hint_only",
    currentQuestion: {
      prompt: "What is the conditional probability?",
      title: "Conditional probability",
    },
    mode: "check",
    provenanceNote: "Use approved context only.",
    retrievedContext: [],
    studentMessage: "I am stuck.",
    task: "low_confidence_answer_help",
    topicId: "conditional-probability",
  }
}

function estimatedTokens() {
  return {
    estimatedInputTokens: 80,
    estimatedTotalTokens: 180,
    maxOutputTokens: 100,
  }
}
