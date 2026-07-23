import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST as regenerateAdminQuestion } from "@/app/api/admin/questions/[id]/regenerate/route"
import {
  resetReviewQueueForTests,
  setContentRepositoryForTests,
} from "@/lib/data/data-store"
import type {
  AdminQuestionRegenerationInput,
  ContentRepository,
} from "@/lib/data/repository"
import { generateDeterministicRegeneratedQuestion } from "@/lib/tutor/generated-question-regeneration"
import type { AdminQuestion } from "@/lib/types"

const TOKEN = "admin-secret"

describe("admin question regeneration API", () => {
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
    const unauthenticated = await postRegenerate("generated-regeneration", "", {
      keepPattern: true,
    })
    const readOnly = await postRegenerate("generated-regeneration", TOKEN, {
      keepPattern: true,
    })

    expect(unauthenticated.status).toBe(401)
    expect(readOnly.status).toBe(503)
  })

  it("creates a deterministic needs-review replacement and preserves the old version", async () => {
    const original = adminQuestionFixture({
      id: "generated-regeneration",
      reviewStatus: "approved",
      trustLevel: "professor_approved",
    })
    setContentRepositoryForTests(contentRepositoryFixture(original))

    const response = await postRegenerate(original.id, TOKEN, {
      keepPattern: true,
    })
    const payload = (await response.json()) as {
      mode: "deterministic"
      original: AdminQuestion
      preservedOriginal: boolean
      regenerated: AdminQuestion
    }
    const serialized = JSON.stringify(payload)

    expect(response.status).toBe(200)
    expect(payload.mode).toBe("deterministic")
    expect(payload.preservedOriginal).toBe(true)
    expect(payload.original).toMatchObject({
      id: original.id,
      review: { status: "needs_regeneration" },
      source: { trustLevel: "generated_unverified" },
      topicId: original.topicId,
    })
    expect(payload.regenerated).toMatchObject({
      review: { status: "needs_review" },
      source: {
        patternIds: original.source.patternIds,
        trustLevel: "generated_unverified",
        visibility: "public",
      },
      topicId: original.topicId,
    })
    expect(payload.regenerated.id).not.toBe(original.id)
    expect(payload.regenerated.prompt).not.toBe(original.prompt)
    expect(serialized).not.toMatch(
      /source page|answer key|copied from|raw extracted|private chunk|textbook page/i,
    )
  })

  it("can regenerate without keeping the old abstract pattern id", async () => {
    const original = adminQuestionFixture({
      id: "generated-without-pattern",
      reviewStatus: "needs_review",
      trustLevel: "generated_unverified",
    })
    setContentRepositoryForTests(contentRepositoryFixture(original))

    const response = await postRegenerate(original.id, TOKEN, {
      keepPattern: false,
    })
    const payload = (await response.json()) as {
      regenerated: AdminQuestion
    }

    expect(response.status).toBe(200)
    expect(payload.regenerated.source.patternIds).toBeUndefined()
    expect(payload.regenerated.topicId).toBe(original.topicId)
  })

  it("rejects unsupported request body fields and modes", async () => {
    const original = adminQuestionFixture({
      id: "generated-invalid-regeneration",
      reviewStatus: "needs_review",
      trustLevel: "generated_unverified",
    })
    const regenerateSpy = vi.fn()
    setContentRepositoryForTests(
      contentRepositoryFixture(original, regenerateSpy),
    )

    const unsupportedField = await postRegenerate(original.id, TOKEN, {
      sourcePage: 12,
    })
    const unsupportedMode = await postRegenerate(original.id, TOKEN, {
      mode: "llm",
    })

    expect(unsupportedField.status).toBe(400)
    expect(unsupportedMode.status).toBe(400)
    expect(regenerateSpy).not.toHaveBeenCalled()
  })

  it("generates original deterministic content from topic and pattern signals", () => {
    const original = adminQuestionFixture({
      id: "generated-helper",
      reviewStatus: "needs_review",
      trustLevel: "generated_unverified",
    })
    const regenerated = generateDeterministicRegeneratedQuestion({
      id: "generated-helper-regen-1",
      keepPattern: true,
      original,
      sequence: 1,
    })

    expect(regenerated.topicId).toBe(original.topicId)
    expect(regenerated.source.trustLevel).toBe("generated_unverified")
    expect(regenerated.review.status).toBe("needs_review")
    expect(regenerated.prompt).not.toBe(original.prompt)
    expect(JSON.stringify(regenerated)).not.toMatch(
      /source page|answer key|copied from|raw extracted|private chunk|textbook page/i,
    )
  })
})

function postRegenerate(id: string, token: string, body?: unknown) {
  return regenerateAdminQuestion(
    new Request(`http://test/api/admin/questions/${id}/regenerate`, {
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { "x-professor-token": token } : {}),
      },
      method: "POST",
    }),
    { params: Promise.resolve({ id }) },
  )
}

function contentRepositoryFixture(
  original: AdminQuestion,
  onRegenerate?: (input: AdminQuestionRegenerationInput) => void,
): ContentRepository {
  const questions = new Map<string, AdminQuestion>([[original.id, original]])

  return {
    async getAdminQuestions() {
      return [...questions.values()]
    },
    async getApprovedQuestionById(questionId) {
      return questions.get(questionId)
    },
    async getApprovedQuestions() {
      return [...questions.values()]
    },
    async getQuestionById(questionId) {
      return questions.get(questionId)
    },
    async getQuestionCounts() {
      return { byTopic: { [original.topicId]: questions.size }, total: questions.size }
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
      return [...questions.values()]
    },
    async listQuestionsByTopic(topicId) {
      return [...questions.values()].filter((question) => question.topicId === topicId)
    },
    async listTopics() {
      return [
        {
          active: true,
          description: "Generated topic",
          id: original.topicId,
          moduleRef: "Week 1",
          order: 1,
          title: original.topicTitle ?? original.topicId,
          weekNumber: 1,
        },
      ]
    },
    async regenerateAdminQuestion(input) {
      onRegenerate?.(input)

      const current = questions.get(input.questionId)

      if (
        !current ||
        !["generated_original", "pattern_derived_original"].includes(
          current.source.sourceType,
        )
      ) {
        return undefined
      }

      const regenerated = adminQuestionFromCandidate(
        generateDeterministicRegeneratedQuestion({
          id: `${current.id}-regen-1`,
          keepPattern: input.keepPattern ?? true,
          original: current,
          sequence: 1,
        }),
        current.topicTitle,
      )
      const updatedOriginal: AdminQuestion = {
        ...current,
        review: {
          ...current.review,
          notes: `Regenerated into ${regenerated.id}; old version preserved for audit.`,
          reviewedBy: input.reviewedBy ?? "admin",
          status: "needs_regeneration",
        },
        source: {
          ...current.source,
          trustLevel: "generated_unverified",
        },
      }

      questions.set(current.id, updatedOriginal)
      questions.set(regenerated.id, regenerated)

      return {
        mode: "deterministic",
        original: updatedOriginal,
        preservedOriginal: true,
        regenerated,
      }
    },
    async updateAdminQuestionDetail() {
      return undefined
    },
    async updateAdminQuestions() {
      return []
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

function adminQuestionFromCandidate(
  candidate: ReturnType<typeof generateDeterministicRegeneratedQuestion>,
  topicTitle: string | undefined,
): AdminQuestion {
  return {
    ...candidate,
    patternSource: candidate.patternSource,
    topicTitle,
  }
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
    patternSource: "conditional probability with restricted sample space",
    prompt:
      "A generated review draft has 8 successful outcomes out of 32 total outcomes. What is the success proportion?",
    review: { status: reviewStatus },
    solutionSteps: ["Compute 8 / 32 = 0.25."],
    source: {
      originalityNote: "Original generated item from an abstract pattern.",
      patternIds: ["pattern-conditional-probability"],
      sourceType: "generated_original",
      trustLevel,
      visibility: "public",
    },
    title: "Generated proportion review",
    topicId: "conditional-probability",
    topicTitle: "Conditional probability",
  }
}
