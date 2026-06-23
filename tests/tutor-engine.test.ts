import { describe, expect, it, beforeEach, vi } from "vitest"

import { authorizeProfessorReview } from "@/lib/tutor/professor-auth"
import { getServerEnv } from "@/lib/env/server"
import { createTutorResponse } from "@/lib/tutor/tutor-engine"
import {
  DEFAULT_USAGE_POLICY,
  canUseLlmFallback,
  recordTutorInteraction,
  resetUsageForTests,
} from "@/lib/tutor/usage"

describe("tutor engine", () => {
  beforeEach(() => {
    resetUsageForTests()
  })

  it("uses approved rule-based answers before retrieval or LLM fallback", async () => {
    const response = await createTutorResponse({
      answer: "2/5",
      allowLlmFallback: true,
      mode: "check",
      questionId: "dice-sum-eight",
      sessionId: "rule-test",
    })

    expect(response.source).toBe("rule")
    expect(response.verdict).toBe("correct")
    expect(response.steps).toHaveLength(3)
  })

  it("returns deterministic misconception feedback for common wrong patterns", async () => {
    const response = await createTutorResponse({
      answer: "2/36",
      mode: "check",
      questionId: "dice-sum-eight",
      sessionId: "misconception-test",
    })

    expect(response.source).toBe("rule")
    expect(response.verdict).toBe("incorrect")
    expect(response.misconceptions[0]).toContain("all 36 dice outcomes")
  })

  it("blocks overlong student input before doing tutor work", async () => {
    const response = await createTutorResponse({
      answer: "x".repeat(DEFAULT_USAGE_POLICY.maxInputCharacters + 1),
      mode: "check",
      questionId: "dice-sum-eight",
      sessionId: "length-test",
    })

    expect(response.source).toBe("blocked")
    expect(response.verdict).toBe("blocked")
  })

  it("uses approved retrieval chunks when no question rule matches", async () => {
    const response = await createTutorResponse({
      answer: "How do I standardize a normal score with a mean?",
      mode: "hint",
      sessionId: "retrieval-test",
      topicId: "normal-standardization",
    })

    expect(response.source).toBe("retrieval")
    expect(response.retrievedContext[0]?.id).toBe("z-score-formula")
  })

  it("enforces per-session LLM fallback limits", () => {
    recordTutorInteraction("quota-test", 10, "llm")
    recordTutorInteraction("quota-test", 10, "llm")

    expect(canUseLlmFallback("quota-test", 10)).toEqual({
      allowed: false,
      reason: "The session has reached its LLM fallback limit.",
    })
  })

  it("exposes the configured daily LLM fallback limit in policy", () => {
    expect(DEFAULT_USAGE_POLICY.maxDailyLlmFallbacks).toBe(100)
  })
})

describe("professor review authorization", () => {
  const originalToken = process.env.ADMIN_SECRET

  beforeEach(() => {
    vi.unstubAllEnvs()
    if (originalToken === undefined) {
      delete process.env.ADMIN_SECRET
    } else {
      process.env.ADMIN_SECRET = originalToken
    }
  })

  it("fails closed when no professor token is configured", () => {
    delete process.env.ADMIN_SECRET

    const result = authorizeProfessorReview(new Headers())

    expect(result.authorized).toBe(false)
    expect(result.status).toBe(503)
  })

  it("accepts the configured professor token", () => {
    process.env.ADMIN_SECRET = "local-secret"
    const headers = new Headers({ "x-professor-token": "local-secret" })

    const result = authorizeProfessorReview(headers)

    expect(result.authorized).toBe(true)
  })
})

describe("server environment helper", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    delete process.env.APP_DEMO_MODE
    delete process.env.MAX_DAILY_LLM_CALLS
    delete process.env.MAX_LLM_CALLS_PER_SESSION
    delete process.env.OPENAI_MODEL
  })

  it("provides safe defaults when optional local env values are missing", () => {
    const env = getServerEnv()

    expect(env.APP_DEMO_MODE).toBe(true)
    expect(env.MAX_DAILY_LLM_CALLS).toBe(100)
    expect(env.MAX_LLM_CALLS_PER_SESSION).toBe(2)
    expect(env.OPENAI_MODEL).toBe("gpt-4.1-mini")
  })
})
