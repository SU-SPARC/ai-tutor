import { afterEach, describe, expect, it, vi } from "vitest"

import { GET as getQuestion } from "@/app/api/questions/[id]/route"
import { GET as listQuestionsRoute } from "@/app/api/questions/route"
import { POST as postTutorSession } from "@/app/api/tutor/session/route"
import {
  getContentRepository,
  getDataRepositoryMetadata,
  setContentRepositoryForTests,
} from "@/lib/data/data-store"
import { demoContentRepository } from "@/lib/data/demo-repository"
import type { ContentRepository } from "@/lib/data/repository"
import { searchLocalRetrieval } from "@/lib/ai/retrieval"
import {
  resetTutorSessionsForTests,
  setTutorSessionRepositoryForTests,
  type TutorSessionRepository,
} from "@/lib/data/tutor-session-repository"
import {
  operatingModePolicyFor,
  type OperatingModePolicy,
} from "@/lib/runtime/operating-mode"
import type { TutorQuestion } from "@/lib/types"

const draftQuestion: TutorQuestion = {
  answer: {
    acceptedAnswers: ["private-draft-answer"],
    explanation: "Unapproved explanation.",
  },
  difficulty: "intermediate",
  hints: ["Unapproved hint."],
  id: "production-hidden-draft",
  misconceptions: [],
  prompt: "UNAPPROVED PRODUCTION DRAFT",
  review: {
    status: "needs_review",
  },
  solutionSteps: ["Unapproved solution."],
  source: {
    sourceType: "generated_original",
    trustLevel: "generated_unverified",
    visibility: "public",
  },
  title: "Hidden draft",
  topicId: "binomial-models",
}

describe("production operating mode", () => {
  afterEach(() => {
    setContentRepositoryForTests(undefined)
    resetTutorSessionsForTests()
    vi.unstubAllEnvs()
  })

  it("always selects the configured database and disables demo fallback", () => {
    stubProductionEnvironment()

    expect(getDataRepositoryMetadata()).toMatchObject({
      databaseConfigured: true,
      demoFallbackEnabled: false,
      mode: "database",
      operatingMode: "production",
      source: "postgres",
    })
    expect(getContentRepository()).not.toBe(demoContentRepository)
  })

  it("returns a controlled 503 instead of demo questions after repository failure", async () => {
    stubProductionEnvironment()
    setContentRepositoryForTests(
      failingContentRepository("production database unavailable"),
    )

    const response = await listQuestionsRoute(
      new Request("https://tutor.example.edu/api/questions"),
    )
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(body).toContain("DATA_SERVICE_UNAVAILABLE")
    expect(body).not.toContain("dice-sum-eight")
    expect(body).not.toContain("production database unavailable")
  })

  it("returns a controlled 503 instead of creating an in-memory session", async () => {
    stubProductionEnvironment()
    setTutorSessionRepositoryForTests(
      failingTutorSessionRepository("session database unavailable"),
    )

    const response = await postTutorSession(
      new Request("https://tutor.example.edu/api/tutor/session", {
        body: JSON.stringify({
          anonymousStudentId: "anon-production-student",
          questionId: "dice-sum-eight",
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    )
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(body).toContain("DATA_SERVICE_UNAVAILABLE")
    expect(body).not.toContain("session database unavailable")
    expect(body).not.toContain('"session"')
  })

  it("keeps generated unapproved questions hidden in production APIs", async () => {
    stubProductionEnvironment()
    setContentRepositoryForTests({
      getQuestionById: async () => draftQuestion,
      listQuestions: async () => [draftQuestion],
      listQuestionsByTopic: async () => [draftQuestion],
    } as unknown as ContentRepository)

    const [listResponse, detailResponse] = await Promise.all([
      listQuestionsRoute(
        new Request("https://tutor.example.edu/api/questions"),
      ),
      getQuestion(
        new Request(
          "https://tutor.example.edu/api/questions/production-hidden-draft",
        ),
        {
          params: Promise.resolve({ id: draftQuestion.id }),
        },
      ),
    ])
    const [listBody, detailBody] = await Promise.all([
      listResponse.text(),
      detailResponse.text(),
    ])

    expect(listResponse.status).toBe(200)
    expect(listBody).not.toContain(draftQuestion.prompt)
    expect(detailResponse.status).toBe(404)
    expect(detailBody).not.toContain(draftQuestion.prompt)
  })

  it("does not load committed demo retrieval chunks in production", async () => {
    stubProductionEnvironment()

    const results = await searchLocalRetrieval("binomial probability", {
      audience: "student",
    })

    expect(results).toEqual([])
  })

  it("shows environment indicators only for Development and Preview", () => {
    expect(policy("development", true).indicatorLabel).toBe("Local demo")
    expect(policy("development", false).indicatorLabel).toBe("Development")
    expect(policy("preview", true).indicatorLabel).toBe("Preview demo")
    expect(policy("preview", false).indicatorLabel).toBe("Preview")
    expect(policy("test", true).indicatorLabel).toBeUndefined()
    expect(policy("staging", false).indicatorLabel).toBeUndefined()
    expect(policy("production", false).indicatorLabel).toBeUndefined()
  })

  it("allows automatic demo fallback only in local and test database modes", () => {
    expect(policy("development", false)).toMatchObject({
      allowDemoFallback: true,
      mode: "local-database",
      repositorySource: "database",
    })
    expect(policy("test", false)).toMatchObject({
      allowDemoFallback: true,
      mode: "test-database",
      repositorySource: "database",
    })
    expect(policy("preview", false)).toMatchObject({
      allowDemoFallback: false,
      mode: "preview-database",
      repositorySource: "database",
    })
    expect(policy("staging", false)).toMatchObject({
      allowDemoFallback: false,
      mode: "staging",
      repositorySource: "database",
    })
    expect(policy("production", false)).toMatchObject({
      allowDemoFallback: false,
      mode: "production",
      repositorySource: "database",
    })
  })

  it("uses the demo repository in production and staging when no database is configured", () => {
    expect(policy("staging", true)).toMatchObject({
      allowDemoFallback: false,
      mode: "staging",
      repositorySource: "demo",
    })
    expect(policy("production", true)).toMatchObject({
      allowDemoFallback: false,
      mode: "production",
      repositorySource: "demo",
    })
  })
})

function policy(
  APP_ENV: "development" | "preview" | "production" | "staging" | "test",
  APP_DEMO_MODE: boolean,
): OperatingModePolicy {
  return operatingModePolicyFor({
    APP_DEMO_MODE,
    APP_ENV,
  })
}

function stubProductionEnvironment() {
  const values = {
    AI_ENABLED: "false",
    APP_DEMO_MODE: "false",
    APP_ENV: "production",
    APP_URL: "https://tutor.example.edu",
    AUTH_CLIENT_ID: "test-client",
    AUTH_CLIENT_SECRET: "test-client-secret",
    AUTH_ISSUER_URL: "https://identity.example.edu",
    AUTH_SESSION_SECRET: "a-test-session-secret-with-32-characters",
    DATABASE_URL: "postgresql://user:password@database.example.edu/tutor",
    ERROR_TRACKING_DSN: "https://errors.example.edu/project",
    LOG_LEVEL: "info",
    RATE_LIMIT_MAX_REQUESTS: "40",
    RATE_LIMIT_WINDOW_SECONDS: "60",
  }

  for (const [name, value] of Object.entries(values)) {
    vi.stubEnv(name, value)
  }
}

function failingContentRepository(message: string): ContentRepository {
  const fail = async () => {
    throw new Error(message)
  }

  return {
    getAdminQuestions: fail,
    getApprovedQuestionById: fail,
    getApprovedQuestions: fail,
    getProfessorPracticeAnalytics: fail,
    getQuestionById: fail,
    getQuestionCounts: fail,
    getRetrievalChunks: fail,
    getReviewQueue: fail,
    getTopics: fail,
    importReviewCandidates: fail,
    listQuestions: fail,
    listQuestionsByTopic: fail,
    listTopics: fail,
    regenerateAdminQuestion: fail,
    updateAdminQuestionDetail: fail,
    updateAdminQuestions: fail,
    updateReviewCandidates: fail,
    updateReviewCandidateStatus: fail,
  } as ContentRepository
}

function failingTutorSessionRepository(
  message: string,
): TutorSessionRepository {
  const fail = async () => {
    throw new Error(message)
  }

  return {
    createSession: fail,
    getSession: fail,
    listSessionsForStudent: fail,
    recordAttempt: fail,
    recordAttemptOutcome: fail,
    revealHint: fail,
    revealStep: fail,
  } as TutorSessionRepository
}
