import { describe, expect, it, beforeEach, vi } from "vitest"

import { POST as postProfessorReview } from "@/app/api/professor/review/route"
import {
  getApprovedQuestionById,
  getApprovedQuestions,
  getRetrievalChunks,
  getReviewQueue,
  isStudentFacingQuestion,
  isStudentFacingRetrievalChunk,
  resetReviewQueueForTests,
} from "@/lib/data/data-store"
import { authorizeProfessorReview } from "@/lib/tutor/professor-auth"
import { getServerEnv } from "@/lib/env/server"
import { createTutorResponse } from "@/lib/tutor/tutor-engine"
import {
  REVIEW_STATUSES,
  SOURCE_TYPES,
  TRUST_LEVELS,
  hasGeneratedQuestionDefaults,
  type TutorQuestion,
} from "@/lib/types"
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

describe("content provenance and review metadata", () => {
  beforeEach(() => {
    resetReviewQueueForTests()
  })

  it("exposes the required source, review, and trust vocabularies", () => {
    expect(SOURCE_TYPES).toEqual([
      "original_demo",
      "professor_provided",
      "generated_original",
      "pattern_derived_original",
      "private_reference_pattern",
    ])
    expect(REVIEW_STATUSES).toEqual([
      "approved",
      "needs_review",
      "rejected",
      "needs_edit",
      "needs_regeneration",
    ])
    expect(TRUST_LEVELS).toContain("generated_unverified")
  })

  it("returns only approved public trusted questions for student practice", async () => {
    const questions = await getApprovedQuestions()
    const chunks = getRetrievalChunks()

    expect(questions.length).toBeGreaterThan(0)
    expect(questions.every(isStudentFacingQuestion)).toBe(true)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.every(isStudentFacingRetrievalChunk)).toBe(true)
    expect(
      questions.every(
        (question) => question.source.trustLevel !== "generated_unverified",
      ),
    ).toBe(true)
    expect(getApprovedQuestionById("bayes-inspection-draft")).toBeUndefined()
  })

  it("keeps generated questions in needs-review status by default", async () => {
    const queue = await getReviewQueue()

    expect(queue.length).toBeGreaterThan(0)
    expect(
      queue.every(
        (candidate) =>
          hasGeneratedQuestionDefaults(candidate) &&
          candidate.source.sourceType === "pattern_derived_original" &&
          candidate.answer.acceptedAnswers.length > 0 &&
          candidate.hints.length > 0 &&
          candidate.solutionSteps.length > 0,
      ),
    ).toBe(true)
  })

  it("excludes private reference items from student-facing access", () => {
    const privateReferenceQuestion: TutorQuestion = {
      id: "private-reference-example",
      topicId: "binomial-models",
      title: "Private reference example",
      difficulty: "foundational",
      prompt: "Private reference placeholder.",
      answer: {
        acceptedAnswers: ["1"],
        explanation: "Private reference placeholder.",
      },
      hints: ["Private reference placeholder."],
      solutionSteps: ["Private reference placeholder."],
      misconceptions: [],
      source: {
        sourceType: "private_reference_pattern",
        trustLevel: "private_reference",
        visibility: "private",
      },
      review: {
        status: "approved",
      },
    }

    expect(isStudentFacingQuestion(privateReferenceQuestion)).toBe(false)
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

  it("maps review API approve and reject actions to review metadata", async () => {
    process.env.ADMIN_SECRET = "local-secret"
    resetReviewQueueForTests()

    const approveResponse = await postProfessorReview(
      new Request("http://localhost/api/professor/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-professor-token": "local-secret",
        },
        body: JSON.stringify({
          action: "approve",
          candidateId: "bayes-inspection-draft",
        }),
      }),
    )
    const approvedPayload = await approveResponse.json()

    expect(approveResponse.status).toBe(200)
    expect(approvedPayload.candidate.review.status).toBe("approved")

    const rejectResponse = await postProfessorReview(
      new Request("http://localhost/api/professor/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-professor-token": "local-secret",
        },
        body: JSON.stringify({
          action: "reject",
          candidateId: "bayes-inspection-draft",
        }),
      }),
    )
    const rejectedPayload = await rejectResponse.json()

    expect(rejectResponse.status).toBe(200)
    expect(rejectedPayload.candidate.review.status).toBe("rejected")
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
