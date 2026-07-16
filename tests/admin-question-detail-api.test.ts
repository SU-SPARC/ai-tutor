import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PATCH as patchAdminQuestion } from "@/app/api/admin/questions/[id]/route"
import {
  resetReviewQueueForTests,
  setContentRepositoryForTests,
} from "@/lib/data/data-store"
import type {
  AdminQuestionDetailUpdate,
  ContentRepository,
} from "@/lib/data/repository"
import type { AdminQuestion } from "@/lib/types"

const TOKEN = "admin-secret"

describe("admin question detail API", () => {
  beforeEach(() => {
    resetReviewQueueForTests()
    vi.stubEnv("ADMIN_SECRET", TOKEN)
    vi.stubEnv("APP_DEMO_MODE", "true")
    vi.stubEnv("DATABASE_URL", "")
  })

  afterEach(() => {
    setContentRepositoryForTests(undefined)
    vi.unstubAllEnvs()
  })

  it("requires ADMIN_SECRET and keeps demo mode read-only", async () => {
    const unauthenticated = await patchQuestion(
      "generated-detail",
      { action: "approve_generated" },
      "",
    )
    const readOnly = await patchQuestion("generated-detail", {
      action: "approve_generated",
    })

    expect(unauthenticated.status).toBe(401)
    expect(readOnly.status).toBe(503)
  })

  it("approves a generated question and updates safe review metadata", async () => {
    const question = adminQuestionFixture({
      id: "generated-detail",
      reviewStatus: "needs_review",
      trustLevel: "generated_unverified",
    })
    setContentRepositoryForTests(contentRepositoryFixture(question))

    const response = await patchQuestion(question.id, {
      action: "approve_generated",
      difficulty: "challenge",
      hints: ["Compare successes with the total count."],
      misconceptions: [
        {
          feedback: "Use successes divided by total trials.",
          id: "uses-successes-only",
          matchTerms: ["8"],
        },
      ],
      reviewerNotes: "Approved after checking the arithmetic.",
      topic: "normal-standardization",
    })
    const payload = (await response.json()) as { question: AdminQuestion }

    expect(response.status).toBe(200)
    expect(payload.question).toMatchObject({
      difficulty: "challenge",
      hints: ["Compare successes with the total count."],
      id: question.id,
      misconceptions: [
        {
          feedback: "Use successes divided by total trials.",
          id: "uses-successes-only",
          matchTerms: ["8"],
        },
      ],
      review: {
        notes: "Approved after checking the arithmetic.",
        reviewedBy: "admin",
        status: "approved",
      },
      source: { trustLevel: "professor_approved" },
      topicId: "normal-standardization",
    })
  })

  it("supports rejecting generated questions and requesting regeneration", async () => {
    const question = adminQuestionFixture({
      id: "generated-actions",
      reviewStatus: "needs_review",
      trustLevel: "generated_unverified",
    })
    setContentRepositoryForTests(contentRepositoryFixture(question))

    const rejected = await patchQuestion(question.id, {
      action: "reject_generated",
    })
    const rejectedPayload = (await rejected.json()) as {
      question: AdminQuestion
    }
    const regeneration = await patchQuestion(question.id, {
      action: "request_regeneration",
    })
    const regenerationPayload = (await regeneration.json()) as {
      question: AdminQuestion
    }

    expect(rejected.status).toBe(200)
    expect(rejectedPayload.question).toMatchObject({
      review: { status: "rejected" },
      source: { trustLevel: "generated_unverified" },
    })
    expect(regeneration.status).toBe(200)
    expect(regenerationPayload.question).toMatchObject({
      review: { status: "needs_regeneration" },
      source: { trustLevel: "generated_unverified" },
    })
  })

  it("validates body shape and rejects unsafe fields before writing", async () => {
    const question = adminQuestionFixture({
      id: "generated-safety",
      reviewStatus: "needs_review",
      trustLevel: "generated_unverified",
    })
    const updateSpy = vi.fn()
    setContentRepositoryForTests(contentRepositoryFixture(question, updateSpy))

    const unsafeField = await patchQuestion(question.id, {
      prompt: "Do not write this raw prompt.",
    })
    const copiedSource = await patchQuestion(question.id, {
      reviewerNotes: "Copied from textbook page 122.",
    })
    const nestedPrivateLocator = await patchQuestion(question.id, {
      misconceptions: [
        {
          feedback: "Valid feedback text.",
          id: "valid-feedback",
          sourcePage: 122,
        },
      ],
    })
    const privateTrust = await patchQuestion(question.id, {
      trustLevel: "private_reference",
    })

    expect(unsafeField.status).toBe(400)
    expect(copiedSource.status).toBe(400)
    expect(nestedPrivateLocator.status).toBe(400)
    expect(privateTrust.status).toBe(400)
    expect(updateSpy).not.toHaveBeenCalled()
    expect(await copiedSource.text()).not.toContain("textbook page 122")
  })

  it("rejects invalid edit values", async () => {
    const question = adminQuestionFixture({
      id: "generated-invalid-values",
      reviewStatus: "needs_review",
      trustLevel: "generated_unverified",
    })
    setContentRepositoryForTests(contentRepositoryFixture(question))

    const invalidDifficulty = await patchQuestion(question.id, {
      difficulty: "very-hard",
    })
    const invalidStatus = await patchQuestion(question.id, {
      reviewStatus: "published",
    })
    const invalidHints = await patchQuestion(question.id, {
      hints: ["Use proportions.", ""],
    })
    const duplicateMisconceptions = await patchQuestion(question.id, {
      misconceptions: [
        { feedback: "First.", id: "duplicate", matchTerms: [] },
        { feedback: "Second.", id: "duplicate", matchTerms: [] },
      ],
    })

    expect(invalidDifficulty.status).toBe(400)
    expect(invalidStatus.status).toBe(400)
    expect(invalidHints.status).toBe(400)
    expect(duplicateMisconceptions.status).toBe(400)
  })
})

function patchQuestion(id: string, body: unknown, token = TOKEN) {
  return patchAdminQuestion(
    new Request(`http://test/api/admin/questions/${id}`, {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-professor-token": token } : {}),
      },
      method: "PATCH",
    }),
    { params: Promise.resolve({ id }) },
  )
}

function contentRepositoryFixture(
  question: AdminQuestion,
  onUpdate?: (input: AdminQuestionDetailUpdate) => void,
): ContentRepository {
  let current = question

  return {
    async getAdminQuestions() {
      return [current]
    },
    async getApprovedQuestionById() {
      return current
    },
    async getApprovedQuestions() {
      return [current]
    },
    async getQuestionById() {
      return current
    },
    async getQuestionCounts() {
      return { byTopic: { [current.topicId]: 1 }, total: 1 }
    },
    async getProfessorPracticeAnalytics() {
      return emptyPracticeAnalytics()
    },
    async getRetrievalChunks() {
      return []
    },
    async getReviewQueue() {
      return []
    },
    async getTopics() {
      return this.listTopics()
    },
    async importReviewCandidates() {
      return {
        candidates: [],
        imported: true,
        message: "Imported test candidates.",
        mode: "demo",
        nonDurable: true,
      }
    },
    async listQuestions() {
      return [current]
    },
    async listQuestionsByTopic() {
      return [current]
    },
    async listTopics() {
      return [
        {
          description: "Generated topic",
          id: current.topicId,
          title: current.topicTitle ?? current.topicId,
        },
      ]
    },
    async updateAdminQuestionDetail(questionId, input) {
      onUpdate?.(input)

      if (questionId !== current.id) {
        return undefined
      }

      const actionStatus = reviewStatusForDetailAction(input.action)
      const nextStatus = actionStatus ?? input.reviewStatus ?? current.review.status
      const generated =
        current.source.sourceType === "generated_original" ||
        current.source.sourceType === "pattern_derived_original"
      const trustLevel = generated
        ? nextStatus === "approved"
          ? "professor_approved"
          : nextStatus === current.review.status
            ? (input.trustLevel ?? current.source.trustLevel)
            : "generated_unverified"
        : (input.trustLevel ?? current.source.trustLevel)

      current = {
        ...current,
        difficulty: input.difficulty ?? current.difficulty,
        hints: input.hints ?? current.hints,
        misconceptions: input.misconceptions ?? current.misconceptions,
        review: {
          ...current.review,
          notes:
            input.reviewerNotes !== undefined
              ? input.reviewerNotes
              : current.review.notes,
          reviewedBy: input.reviewedBy ?? current.review.reviewedBy,
          status: nextStatus,
        },
        source: {
          ...current.source,
          trustLevel,
        },
        topicId: input.topicId ?? current.topicId,
      }

      return current
    },
    async updateAdminQuestions() {
      return []
    },
    async regenerateAdminQuestion() {
      return undefined
    },
    async updateReviewCandidates() {
      return []
    },
    async updateReviewCandidateStatus() {
      return undefined
    },
  }
}

function emptyPracticeAnalytics() {
  return {
    commonMisconceptions: [],
    generatedQuestionOutcomes: {
      approved: 0,
      needs_edit: 0,
      needs_regeneration: 0,
      needs_review: 0,
      rejected: 0,
    },
    mode: "demo" as const,
    questions: [],
    summary: {
      totalAttempts: 0,
      totalHintsUsed: 0,
      totalStepsRevealed: 0,
      totalTutorSessions: 0,
    },
    topics: [],
  }
}

function reviewStatusForDetailAction(
  action: AdminQuestionDetailUpdate["action"],
): AdminQuestion["review"]["status"] | undefined {
  if (action === "approve_generated") {
    return "approved"
  }

  if (action === "reject_generated") {
    return "rejected"
  }

  if (action === "request_regeneration") {
    return "needs_regeneration"
  }

  return undefined
}

function adminQuestionFixture({
  id,
  reviewStatus,
  trustLevel,
}: {
  id: string
  reviewStatus: AdminQuestion["review"]["status"]
  trustLevel: AdminQuestion["source"]["trustLevel"]
}): AdminQuestion {
  return {
    answer: {
      acceptedAnswers: ["0.25"],
      explanation: "Divide 8 by 32.",
      numericValue: 0.25,
    },
    difficulty: "foundational",
    hints: ["Use the proportion formula."],
    id,
    misconceptions: [
      {
        feedback: "Use successes divided by total trials.",
        id: "uses-count-only",
        matchTerms: ["8"],
      },
    ],
    patternSource: "abstract proportion pattern",
    prompt:
      "A generated review question has 8 successful trials out of 32. What is the success proportion?",
    review: { status: reviewStatus },
    solutionSteps: ["Compute 8 / 32 = 0.25."],
    source: {
      originalityNote: "Original generated item from an abstract pattern.",
      sourceType: "generated_original",
      trustLevel,
      visibility: "public",
    },
    title: "Generated proportion review",
    topicId: "basic-probability",
    topicTitle: "Basic probability",
  }
}
