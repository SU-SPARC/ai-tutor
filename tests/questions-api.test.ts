import { afterEach, describe, expect, it } from "vitest"

import followingSyllabusReviewCandidateData from "../data/demo/following-syllabus-review-candidates.json"
import nextSyllabusReviewCandidateData from "../data/demo/next-syllabus-review-candidates.json"
import nextUncoveredSyllabusReviewCandidateData from "../data/demo/next-uncovered-syllabus-review-candidates.json"
import { GET as getQuestion } from "@/app/api/questions/[id]/route"
import { GET as listQuestionsRoute } from "@/app/api/questions/route"
import type { ContentRepository } from "@/lib/data/repository"
import { setContentRepositoryForTests } from "@/lib/data/data-store"
import type { TutorQuestion } from "@/lib/types"

const nextSyllabusCandidates =
  nextSyllabusReviewCandidateData as unknown as TutorQuestion[]
const followingSyllabusCandidates =
  followingSyllabusReviewCandidateData as unknown as TutorQuestion[]
const nextUncoveredSyllabusCandidates =
  nextUncoveredSyllabusReviewCandidateData as unknown as TutorQuestion[]

afterEach(() => {
  setContentRepositoryForTests(undefined)
})

function request(url: string) {
  return new Request(url)
}

const draftQuestion: TutorQuestion = {
  id: "draft-secret",
  topicId: "binomial-models",
  title: "Unapproved draft",
  difficulty: "intermediate",
  prompt: "SECRET DRAFT PROMPT that students must never see.",
  answer: { acceptedAnswers: ["1"], explanation: "" },
  hints: [],
  solutionSteps: [],
  misconceptions: [],
  source: {
    sourceType: "generated_original",
    trustLevel: "generated_unverified",
    visibility: "public",
  },
  review: { status: "needs_review" },
}

describe("questions API", () => {
  it("lists approved questions as summaries without answers", async () => {
    const response = await listQuestionsRoute(
      request("http://test/api/questions"),
    )
    const payload = (await response.json()) as {
      count: number
      questions: Array<Record<string, unknown>>
    }

    expect(response.status).toBe(200)
    expect(payload.count).toBeGreaterThan(0)
    for (const question of payload.questions) {
      expect(question).not.toHaveProperty("answer")
      expect(question).not.toHaveProperty("solutionSteps")
      expect(question).toHaveProperty("difficultyLabel")
    }
  })

  it("filters by topic and difficulty", async () => {
    const response = await listQuestionsRoute(
      request(
        "http://test/api/questions?topic=binomial-models&difficulty=intermediate",
      ),
    )
    const payload = (await response.json()) as {
      questions: Array<{ topicId: string; difficulty: string }>
    }

    expect(response.status).toBe(200)
    for (const question of payload.questions) {
      expect(question.topicId).toBe("binomial-models")
      expect(question.difficulty).toBe("intermediate")
    }
  })

  it("supports keyword search", async () => {
    const response = await listQuestionsRoute(
      request("http://test/api/questions?q=z-score"),
    )
    const payload = (await response.json()) as { questions: unknown[] }

    expect(response.status).toBe(200)
    expect(payload.questions.length).toBeGreaterThan(0)
  })

  it("rejects invalid difficulty and sourceType", async () => {
    const badDifficulty = await listQuestionsRoute(
      request("http://test/api/questions?difficulty=impossible"),
    )
    const badSource = await listQuestionsRoute(
      request("http://test/api/questions?sourceType=leaked_textbook"),
    )

    expect(badDifficulty.status).toBe(400)
    expect(badSource.status).toBe(400)
  })

  it("returns full detail for an approved question", async () => {
    const response = await getQuestion(request("http://test/api/questions/x"), {
      params: Promise.resolve({ id: "exam-z-score" }),
    })
    const payload = (await response.json()) as {
      question: { hints: string[]; solutionSteps: string[]; answer: unknown }
    }

    expect(response.status).toBe(200)
    expect(payload.question.solutionSteps.length).toBeGreaterThan(0)
    expect(payload.question.answer).toBeTruthy()
  })

  it("returns 404 for unknown ids", async () => {
    const response = await getQuestion(request("http://test/api/questions/x"), {
      params: Promise.resolve({ id: "does-not-exist" }),
    })

    expect(response.status).toBe(404)
  })

  it("never serves an unapproved draft, even if the repository returns one", async () => {
    setContentRepositoryForTests({
      getQuestionById: async () => draftQuestion,
      getApprovedQuestionById: async () => draftQuestion,
    } as unknown as ContentRepository)

    const response = await getQuestion(request("http://test/api/questions/x"), {
      params: Promise.resolve({ id: "draft-secret" }),
    })
    const body = await response.text()

    expect(response.status).toBe(404)
    expect(body).not.toContain("SECRET DRAFT PROMPT")
  })

  it("never lists or retrieves next-syllabus review drafts", async () => {
    const response = await listQuestionsRoute(
      request("http://test/api/questions"),
    )
    const payload = (await response.json()) as {
      questions: Array<{ id: string }>
    }
    const studentIds = new Set(payload.questions.map((question) => question.id))

    expect(
      nextSyllabusCandidates.every(
        (candidate) => !studentIds.has(candidate.id),
      ),
    ).toBe(true)

    const detail = await getQuestion(request("http://test/api/questions/x"), {
      params: Promise.resolve({ id: nextSyllabusCandidates[0].id }),
    })

    expect(detail.status).toBe(404)
  })

  it("never lists or retrieves following-syllabus review drafts", async () => {
    const response = await listQuestionsRoute(
      request("http://test/api/questions"),
    )
    const payload = (await response.json()) as {
      questions: Array<{ id: string }>
    }
    const studentIds = new Set(payload.questions.map((question) => question.id))

    expect(
      followingSyllabusCandidates.every(
        (candidate) => !studentIds.has(candidate.id),
      ),
    ).toBe(true)

    const detail = await getQuestion(request("http://test/api/questions/x"), {
      params: Promise.resolve({ id: followingSyllabusCandidates[0].id }),
    })

    expect(detail.status).toBe(404)
  })

  it("never lists or retrieves next-uncovered review drafts", async () => {
    const response = await listQuestionsRoute(
      request("http://test/api/questions"),
    )
    const payload = (await response.json()) as {
      questions: Array<{ id: string }>
    }
    const studentIds = new Set(payload.questions.map((question) => question.id))

    expect(
      nextUncoveredSyllabusCandidates.every(
        (candidate) => !studentIds.has(candidate.id),
      ),
    ).toBe(true)

    const detail = await getQuestion(request("http://test/api/questions/x"), {
      params: Promise.resolve({ id: nextUncoveredSyllabusCandidates[0].id }),
    })

    expect(detail.status).toBe(404)
  })
})
