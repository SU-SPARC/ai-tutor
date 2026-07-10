import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createAiResponseCacheKey,
  getCachedAiTutorResponse,
  normalizeStudentMessage,
  saveAiTutorResponseCache,
  type AiResponseCacheKeyInput,
} from "@/lib/ai/response-cache"
import {
  createUsageScope,
  getUsageDashboard,
  resetUsageControlForTests,
} from "@/lib/tutor/usage-control"
import type { LlmGroundingContext } from "@/lib/types"

const safeContext: LlmGroundingContext = {
  body: "Use the approved conditioned sample-space summary.",
  id: "conditional-probability-summary",
  priorityTier: "safe_demo",
  sourceType: "original_demo",
  title: "Conditional probability",
  topicId: "conditional-probability",
}

describe("AI tutor response cache", () => {
  beforeEach(() => {
    resetUsageControlForTests()
    vi.stubEnv("APP_DEMO_MODE", "true")
    vi.stubEnv("USAGE_KEY_SECRET", "test-cache-secret")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("normalizes repeated student messages for the same cache key", () => {
    const base = cacheKeyInput()
    const first = createAiResponseCacheKey({
      ...base,
      studentMessage: "  HOW   do I condition on this event?  ",
    })
    const repeated = createAiResponseCacheKey({
      ...base,
      studentMessage: "how do i condition on this event?",
    })

    expect(normalizeStudentMessage("  HOW   do I condition? ")).toBe(
      "how do i condition?",
    )
    expect(repeated).toBe(first)
  })

  it("varies the key by question, context IDs, and tutor mode", () => {
    const base = cacheKeyInput()
    const original = createAiResponseCacheKey(base)
    const differentQuestion = createAiResponseCacheKey({
      ...base,
      questionId: "another-question",
    })
    const differentContext = createAiResponseCacheKey({
      ...base,
      retrievedContext: [{ ...safeContext, id: "another-context" }],
    })
    const differentMode = createAiResponseCacheKey({
      ...base,
      mode: "hint",
    })

    expect(
      new Set([original, differentQuestion, differentContext, differentMode])
        .size,
    ).toBe(4)
  })

  it("uses demo memory, isolates students, and records cache hits", async () => {
    const firstScope = createUsageScope({
      questionId: "dice-sum-eight",
      sessionId: "session-1",
      studentId: "student-1",
    })
    const secondScope = createUsageScope({
      questionId: "dice-sum-eight",
      sessionId: "session-2",
      studentId: "student-2",
    })
    const privateSentinel = "synthetic raw private textbook sentinel"
    const requestHash = createAiResponseCacheKey({
      ...cacheKeyInput(),
      retrievedContext: [{ ...safeContext, body: privateSentinel }],
      studentKeyHash: firstScope.studentKeyHash,
      studentMessage: "My personal draft answer",
    })

    await saveAiTutorResponseCache({
      contextUsed: true,
      message: "Start by listing the conditioned outcomes.",
      requestHash,
      responseLabel: "approved_course_content",
      scope: firstScope,
    })

    const cached = await getCachedAiTutorResponse(firstScope, requestHash)

    expect(cached).toEqual({
      contextUsed: true,
      message: "Start by listing the conditioned outcomes.",
      responseLabel: "approved_course_content",
    })
    expect(
      await getCachedAiTutorResponse(secondScope, requestHash),
    ).toBeUndefined()
    expect(requestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(requestHash).not.toContain(privateSentinel)
    expect(JSON.stringify(cached)).not.toContain(privateSentinel)
    expect(JSON.stringify(cached)).not.toContain("My personal draft answer")
    expect((await getUsageDashboard()).today.cacheHits).toBe(1)
  })
})

function cacheKeyInput(): AiResponseCacheKeyInput {
  return {
    allowedDisclosure: "hint_only",
    model: "test-model",
    mode: "check",
    questionId: "dice-sum-eight",
    retrievedContext: [safeContext],
    studentKeyHash: "student-key-hash",
    studentMessage: "How do I condition on this event?",
    task: "low_confidence_answer_help",
    topicId: "conditional-probability",
  }
}
