import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import followingSyllabusReviewCandidateData from "../data/demo/following-syllabus-review-candidates.json"
import nextUncoveredSyllabusReviewCandidateData from "../data/demo/next-uncovered-syllabus-review-candidates.json"
import {
  GET as getAdminQuestions,
  PATCH as patchAdminQuestions,
} from "@/app/api/admin/questions/route"
import {
  resetReviewQueueForTests,
  setContentRepositoryForTests,
} from "@/lib/data/data-store"
import type { ContentRepository } from "@/lib/data/repository"
import type { AdminQuestion } from "@/lib/types"

const TOKEN = "admin-secret"
const followingSyllabusIds = new Set(
  followingSyllabusReviewCandidateData.map((candidate) => candidate.id),
)
const nextUncoveredSyllabusIds = new Set(
  nextUncoveredSyllabusReviewCandidateData.map((candidate) => candidate.id),
)

describe("admin questions API", () => {
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

  it("returns read-only demo state with required sections and details", async () => {
    const response = await getAdminQuestions(
      new Request("http://test/api/admin/questions"),
    )
    const payload = (await response.json()) as {
      dashboard: {
        questions: AdminQuestion[]
        readOnly: boolean
        sections: Record<string, string[]>
      }
    }
    const serialized = JSON.stringify(payload)

    expect(response.status).toBe(200)
    expect(payload.dashboard.readOnly).toBe(true)
    expect(payload.dashboard.sections).toMatchObject({
      approved_student_facing: expect.any(Array),
      generated_original: expect.any(Array),
      pattern_derived_original_candidates: expect.any(Array),
      professor_provided: expect.any(Array),
    })
    expect(payload.dashboard.questions.length).toBeGreaterThan(0)
    expect(
      payload.dashboard.questions.some(
        (question) =>
          question.prompt &&
          question.solutionSteps.length > 0 &&
          question.hints.length > 0 &&
          question.misconceptions.length > 0,
      ),
    ).toBe(true)
    expect(serialized).not.toMatch(
      /privatePhraseHashes|sourceItemIds|sourceNumberSets|sourceStoryFamilies|raw extracted|source page|answer key|copied from/i,
    )
  })

  it("filters by status, topic, source type, and generated-only", async () => {
    const response = await getAdminQuestions(
      new Request(
        "http://test/api/admin/questions?status=needs_review&topicId=conditional-probability&sourceType=pattern_derived_original&generatedOnly=true",
      ),
    )
    const payload = (await response.json()) as {
      dashboard: { questions: AdminQuestion[] }
    }

    expect(response.status).toBe(200)
    expect(payload.dashboard.questions.length).toBeGreaterThan(0)
    expect(
      payload.dashboard.questions.every(
        (question) =>
          question.review.status === "needs_review" &&
          question.topicId === "conditional-probability" &&
          question.source.sourceType === "pattern_derived_original",
      ),
    ).toBe(true)
  })

  it("shows all 60 following-syllabus drafts in the admin review section", async () => {
    const response = await getAdminQuestions(
      new Request(
        "http://test/api/admin/questions?status=needs_review&sourceType=pattern_derived_original&generatedOnly=true",
      ),
    )
    const payload = (await response.json()) as {
      dashboard: {
        questions: AdminQuestion[]
        sections: Record<string, string[]>
      }
    }
    const returnedIds = new Set(
      payload.dashboard.questions.map((question) => question.id),
    )
    const reviewSectionIds = new Set(
      payload.dashboard.sections.pattern_derived_original_candidates,
    )

    expect(response.status).toBe(200)
    expect(followingSyllabusIds.size).toBe(60)
    expect(
      [...followingSyllabusIds].every(
        (candidateId) =>
          returnedIds.has(candidateId) && reviewSectionIds.has(candidateId),
      ),
    ).toBe(true)
  })

  it("shows all 60 next-uncovered drafts in the admin review section", async () => {
    const response = await getAdminQuestions(
      new Request(
        "http://test/api/admin/questions?status=needs_review&sourceType=pattern_derived_original&generatedOnly=true",
      ),
    )
    const payload = (await response.json()) as {
      dashboard: {
        questions: AdminQuestion[]
        sections: Record<string, string[]>
      }
    }
    const returnedIds = new Set(
      payload.dashboard.questions.map((question) => question.id),
    )
    const reviewSectionIds = new Set(
      payload.dashboard.sections.pattern_derived_original_candidates,
    )

    expect(response.status).toBe(200)
    expect(nextUncoveredSyllabusIds.size).toBe(60)
    expect(
      [...nextUncoveredSyllabusIds].every(
        (candidateId) =>
          returnedIds.has(candidateId) && reviewSectionIds.has(candidateId),
      ),
    ).toBe(true)
  })

  it("requires ADMIN_SECRET for mutations and keeps demo mode read-only", async () => {
    const unauthenticated = await patchAdminQuestions(
      mutationRequest({ action: "reject", questionId: "dice-sum-eight" }, ""),
    )
    const readOnly = await patchAdminQuestions(
      mutationRequest({ action: "reject", questionId: "dice-sum-eight" }, TOKEN),
    )

    expect(unauthenticated.status).toBe(401)
    expect(readOnly.status).toBe(503)
  })

  it("applies database-backed admin mutations through the repository boundary", async () => {
    const question = adminQuestionFixture({
      id: "db-generated-question",
      reviewStatus: "approved",
      trustLevel: "professor_approved",
    })
    setContentRepositoryForTests(contentRepositoryFixture(question))

    const response = await patchAdminQuestions(
      mutationRequest({
        action: "mark_needs_review",
        questionId: question.id,
      }),
    )
    const payload = (await response.json()) as {
      questions: AdminQuestion[]
    }

    expect(response.status).toBe(200)
    expect(payload.questions[0]).toMatchObject({
      id: question.id,
      review: { status: "needs_review" },
      source: { trustLevel: "generated_unverified" },
    })
  })
})

function mutationRequest(body: unknown, token = TOKEN) {
  return new Request("http://test/api/admin/questions", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-professor-token": token } : {}),
    },
    method: "PATCH",
  })
}

function contentRepositoryFixture(question: AdminQuestion): ContentRepository {
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
          active: true,
          description: "Generated topic",
          id: current.topicId,
          moduleRef: "Week 1",
          order: 1,
          title: current.topicTitle ?? current.topicId,
          weekNumber: 1,
        },
      ]
    },
    async updateAdminQuestions(input) {
      current = {
        ...current,
        review: {
          ...current.review,
          status:
            input.action === "mark_needs_review"
              ? "needs_review"
              : current.review.status,
        },
        source: {
          ...current.source,
          trustLevel:
            input.action === "mark_needs_review"
              ? "generated_unverified"
              : current.source.trustLevel,
        },
      }
      return [current]
    },
    async updateAdminQuestionDetail() {
      return current
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
