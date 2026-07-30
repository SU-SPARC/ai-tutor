import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, beforeEach, vi } from "vitest"

import { POST as postProfessorReview } from "@/app/api/professor/review/route"
import {
  getApprovedQuestionById,
  getApprovedQuestions,
  getContentRepositoryMode,
  getDataRepositoryMetadata,
  getQuestionById,
  getQuestionCounts,
  getRetrievalChunks,
  getReviewQueue,
  isStudentFacingQuestion,
  isStudentFacingRetrievalChunk,
  listQuestions,
  listQuestionsByTopic,
  listTopics,
  resetReviewQueueForTests,
  setContentRepositoryForTests,
} from "@/lib/data/data-store"
import type { ContentRepository } from "@/lib/data/repository"
import { authorizeProfessorReview } from "@/lib/tutor/professor-auth"
import { getServerEnv } from "@/lib/env/server"
import {
  checkStudentAttempt,
  createTutorResponse,
  decideTutorResponse,
  detectMisconception,
  getNextHint,
  getNextStep,
  isLlmFallbackEligible,
  shouldEscalateToLLM,
  shouldEscalateToRetrieval,
} from "@/lib/tutor/tutor-engine"
import {
  getTutorSessionState,
  getTutorAttemptSnapshotsForTests,
  resetTutorStateForTests,
} from "@/lib/tutor/tutor-state"
import {
  REVIEW_STATUSES,
  SOURCE_TYPES,
  TRUST_LEVELS,
  hasGeneratedQuestionDefaults,
  type ApprovedGeneratedQuestion,
  type GeneratedQuestionDraft,
  type GeneratedQuestionReviewItem,
  type RetrievalChunk,
  type TutorMode,
  type TutorQuestion,
} from "@/lib/types"
import demoQuestionPatterns from "../data/demo/question-patterns.json"
import followingSyllabusReviewCandidates from "../data/demo/following-syllabus-review-candidates.json"
import generatedExamples from "../data/demo/generated-examples.json"
import generatedReviewCandidates from "../data/demo/generated-review-candidates.json"
import nextSyllabusReviewCandidates from "../data/demo/next-syllabus-review-candidates.json"
import nextUncoveredSyllabusReviewCandidates from "../data/demo/next-uncovered-syllabus-review-candidates.json"
import syllabusReviewCandidates from "../data/demo/syllabus-review-candidates.json"
import ruleEngineExamples from "../data/eval/rule-engine-examples.json"
import {
  approvedPublicWhereClauseForTests,
  mapQuestionRow,
} from "@/lib/data/database-repository"

describe("tutor engine", () => {
  beforeEach(() => {
    resetTutorStateForTests()
  })

  afterEach(() => {
    setContentRepositoryForTests(undefined)
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
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
    expect(response.responseLabel).toBe("approved_course_content")
    expect(response.usage.contextUsed).toBe(false)
    expect(response.usage.fallbackUsed).toBe(false)
    expect(response.progress?.state).toBe("solved")
    expect(response.progress?.solved).toBe(true)
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
    expect(response.hints).toHaveLength(1)
    expect(response.steps).toHaveLength(0)
    expect(response.progress?.state).toBe("misconception_detected")
  })

  it("uses the shared misconception library when no question-specific match exists", async () => {
    const response = await createTutorResponse({
      answer: "Use normal approximation even though np<5.",
      mode: "check",
      questionId: "exam-z-score",
      sessionId: "library-misconception-test",
    })

    expect(response.source).toBe("rule")
    expect(response.verdict).toBe("incorrect")
    expect(response.misconceptions[0]).toContain("normal approximation")
    expect(response.progress?.state).toBe("misconception_detected")
  })

  it("does not repeat identical misconception feedback for the same answer", async () => {
    const first = await createTutorResponse({
      answer: "2/36",
      mode: "check",
      questionId: "dice-sum-eight",
      sessionId: "repeat-misconception-test",
    })
    const second = await createTutorResponse({
      answer: "2/36",
      mode: "check",
      questionId: "dice-sum-eight",
      sessionId: "repeat-misconception-test",
    })

    expect(first.misconceptions).toHaveLength(1)
    expect(second.misconceptions).toHaveLength(0)
    expect(second.hints).toHaveLength(2)
    expect(second.progress?.wrongAttemptCount).toBe(2)
  })

  it("asks for an answer before revealing new check-mode guidance", async () => {
    const response = await createTutorResponse({
      answer: "",
      mode: "check",
      questionId: "dice-sum-eight",
      sessionId: "empty-answer-test",
    })

    expect(response.source).toBe("rule")
    expect(response.verdict).toBe("guidance")
    expect(response.hints).toHaveLength(0)
    expect(response.steps).toHaveLength(0)
    expect(response.progress?.state).toBe("working")
  })

  it("reveals approved hints one at a time", async () => {
    const first = await createTutorResponse({
      answer: "",
      mode: "hint",
      questionId: "dice-sum-eight",
      sessionId: "hint-reveal-test",
    })
    const second = await createTutorResponse({
      answer: "",
      mode: "hint",
      questionId: "dice-sum-eight",
      sessionId: "hint-reveal-test",
    })

    expect(first.source).toBe("rule")
    expect(first.hints).toHaveLength(1)
    expect(first.steps).toHaveLength(0)
    expect(first.progress?.hintsRevealed).toBe(1)
    expect(second.hints).toHaveLength(2)
    expect(second.progress?.hintsRevealed).toBe(2)
    expect(second.progress?.state).toBe("hinting")
  })

  it("reveals approved solution steps one at a time", async () => {
    const first = await createTutorResponse({
      answer: "",
      mode: "solution",
      questionId: "dice-sum-eight",
      sessionId: "step-reveal-test",
    })
    const second = await createTutorResponse({
      answer: "",
      mode: "solution",
      questionId: "dice-sum-eight",
      sessionId: "step-reveal-test",
    })

    expect(first.source).toBe("rule")
    expect(first.steps).toHaveLength(1)
    expect(first.hints).toHaveLength(0)
    expect(first.progress?.stepsRevealed).toBe(1)
    expect(first.progress?.state).toBe("step_reveal")
    expect(second.steps).toHaveLength(2)
    expect(second.progress?.stepsRevealed).toBe(2)
  })

  it("returns the approved explanation after all solution steps are visible", async () => {
    const sessionId = "all-steps-visible-test"

    await createTutorResponse({
      answer: "",
      mode: "solution",
      questionId: "dice-sum-eight",
      sessionId,
    })
    await createTutorResponse({
      answer: "",
      mode: "solution",
      questionId: "dice-sum-eight",
      sessionId,
    })
    await createTutorResponse({
      answer: "",
      mode: "solution",
      questionId: "dice-sum-eight",
      sessionId,
    })
    const response = await createTutorResponse({
      answer: "",
      mode: "solution",
      questionId: "dice-sum-eight",
      sessionId,
    })

    expect(response.steps).toHaveLength(3)
    expect(response.message).toContain("five equally likely ordered outcomes")
    expect(response.progress?.stepsRevealed).toBe(3)
  })

  it("becomes LLM-fallback eligible once hints alone are exhausted, without any steps revealed", async () => {
    const question = await getQuestionById("dice-sum-eight")

    expect(question).toBeDefined()

    if (!question) {
      return
    }

    const state = getTutorSessionState("hints-only-eligibility-test", question.id)

    expect(isLlmFallbackEligible(question, state)).toBe(false)

    const exhaustedHintsState = {
      ...state,
      hintsRevealed: question.hints.length,
    }

    expect(isLlmFallbackEligible(question, exhaustedHintsState)).toBe(true)
    expect(
      shouldEscalateToRetrieval({
        answer: "still stuck",
        mode: "check",
        question,
        state: exhaustedHintsState,
      }),
    ).toBe(true)
  })

  it("reveals the full solution in one call via mode: full_solution, without marking the question solved", async () => {
    const response = await createTutorResponse({
      answer: "",
      mode: "full_solution",
      questionId: "dice-sum-eight",
      sessionId: "full-solution-reveal-test",
    })

    expect(response.steps).toHaveLength(3)
    expect(response.message).toContain("five equally likely ordered outcomes")
    expect(response.progress?.solved).toBe(false)
  })

  it("exposes reusable rule-engine helpers for attempts, hints, steps, and escalation", async () => {
    const question = await getQuestionById("dice-sum-eight")

    expect(question).toBeDefined()

    if (!question) {
      return
    }

    const state = getTutorSessionState("helper-test", question.id)
    const correctAttempt = checkStudentAttempt(question, "40%")
    const misconception = detectMisconception(question, "2/36")
    const firstHint = getNextHint(question, state)
    const firstStep = getNextStep(question, state)
    const blockedFullSolution = getNextStep(question, state, {
      fullSolutionRequested: true,
    })
    const fullSolution = getNextStep(question, state, {
      allowFullSolution: true,
      fullSolutionRequested: true,
    })

    expect(correctAttempt.answerCheck.isCorrect).toBe(true)
    expect(misconception?.id).toBe("uses-full-sample-space")
    expect(firstHint.hints).toHaveLength(1)
    expect(firstHint.state.state).toBe("hinting")
    expect(firstStep.steps).toHaveLength(1)
    expect(firstStep.state.state).toBe("step_reveal")
    expect(blockedFullSolution.steps).toHaveLength(1)
    expect(blockedFullSolution.message).toContain("not available yet")
    expect(fullSolution.steps).toHaveLength(question.solutionSteps.length)
    expect(fullSolution.message).toBe(question.answer.explanation)
    expect(
      shouldEscalateToRetrieval({
        answer: "still stuck",
        mode: "check",
        question,
        state: {
          ...state,
          hintsRevealed: question.hints.length,
          stepsRevealed: question.solutionSteps.length,
        },
      }),
    ).toBe(true)
    expect(
      shouldEscalateToLLM({
        allowLlmFallback: true,
        answer: "still stuck",
        mode: "check",
        retrievalMatches: 0,
        state,
      }),
    ).toBe(true)
  })

  it("decides full-solution responses only when explicitly allowed", async () => {
    const question = await getQuestionById("dice-sum-eight")

    expect(question).toBeDefined()

    if (!question) {
      return
    }

    const blocked = await decideTutorResponse({
      answer: "",
      mode: "full_solution",
      question,
      sessionId: "full-solution-blocked",
      state: getTutorSessionState("full-solution-blocked", question.id),
    })
    const allowed = await decideTutorResponse({
      allowFullSolution: true,
      answer: "",
      mode: "full_solution",
      question,
      sessionId: "full-solution-allowed",
      state: getTutorSessionState("full-solution-allowed", question.id),
    })

    expect(blocked.response.steps).toHaveLength(1)
    expect(blocked.response.message).toContain("not available yet")
    expect(allowed.response.steps).toHaveLength(question.solutionSteps.length)
    expect(allowed.response.message).toBe(question.answer.explanation)
  })

  it("matches public rule-engine eval examples", async () => {
    expect(ruleEngineExamples.visibility).toBe("public")

    for (const example of ruleEngineExamples.examples) {
      expect(["check", "hint", "solution"]).toContain(example.mode)

      const response = await createTutorResponse({
        answer: example.studentAnswer,
        mode: example.mode as TutorMode,
        questionId: example.questionId,
        sessionId: example.id,
      })

      expect(response.source).toBe(example.expectedSource)
      expect(response.verdict).toBe(example.expectedVerdict)
      expect(response.progress?.state).toBe(example.expectedState)
    }
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
    expect(response.responseLabel).toBe("approved_course_content")
    expect(response.usage.contextUsed).toBe(true)
    expect(response.usage.fallbackUsed).toBe(false)
    expect(response.progress?.state).toBe("retrieval_guidance")
    expect(response.progress?.retrievalUsed).toBe(true)
    expect(response.progress?.llmUsed).toBe(false)
  })

  it("labels generated approved and private-reference retrieval responses", async () => {
    setContentRepositoryForTests(
      contentRepositoryWithChunks([
        retrievalChunkFixture({
          body: "Use the approved generated exact-count pattern with independent trials.",
          id: "generated-approved-label",
          keywords: ["generated", "exact", "count", "independent", "trials"],
          priorityTier: "approved_generated",
          sourceType: "generated_original",
          topicId: "generated-label-topic",
          trustLevel: "professor_approved",
        }),
        retrievalChunkFixture({
          body: "Raw private textbook page text that should not be returned.",
          id: "private-reference-label",
          keywords: ["private", "reference", "bayes", "base", "evidence"],
          llmSafeSummary:
            "Use Bayes' rule with the base rate and conditional evidence rate.",
          priorityTier: "private_reference",
          sourceType: "private_reference_pattern",
          topicId: "private-label-topic",
          trustLevel: "private_reference",
          visibility: "private",
        }),
      ]),
    )

    const generated = await createTutorResponse({
      answer: "generated approved exact count independent trials",
      mode: "hint",
      sessionId: "generated-approved-label-test",
      topicId: "generated-label-topic",
    })
    const privateGrounded = await createTutorResponse({
      answer: "private reference bayes base rate evidence",
      mode: "hint",
      sessionId: "private-reference-label-test",
      topicId: "private-label-topic",
    })

    expect(generated.source).toBe("retrieval")
    expect(generated.responseLabel).toBe("generated_approved_content")
    expect(privateGrounded.source).toBe("retrieval")
    expect(privateGrounded.responseLabel).toBe(
      "private_reference_grounded_explanation",
    )
    expect(privateGrounded.hints[0]).toContain("Use Bayes' rule")
    expect(privateGrounded.hints[0]).not.toContain("Raw private")
  })

  it("blocks LLM fallback unless explicit fallback is requested", async () => {
    const response = await createTutorResponse({
      answer: "orion quilting advice",
      allowLlmFallback: false,
      mode: "hint",
      sessionId: "llm-explicit-block-test",
    })

    expect(response.source).toBe("blocked")
    expect(response.message).toContain("LLM fallback was not requested")
    expect(response.progress?.state).toBe("blocked")
  })

  it("calls the LLM fallback even for requests that don't look like probability/statistics", async () => {
    const fetchImpl = mockLlmResponse("Here's some general guidance.")

    const response = await createTutorResponse({
      answer: "orion quilting advice",
      allowLlmFallback: true,
      mode: "hint",
      sessionId: "llm-off-domain-test",
    })

    expect(response.source).toBe("llm")
    expect(response.progress?.llmUsed).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("surfaces the LLM's own message when AI is disabled, without blocking", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    vi.stubEnv("AI_ENABLED", "false")
    vi.stubEnv("OPENROUTER_API_KEY", "")
    vi.stubGlobal("fetch", fetchImpl)

    const response = await createTutorResponse({
      answer: "What is a confidence interval?",
      allowLlmFallback: true,
      mode: "hint",
      sessionId: "llm-missing-key-test",
    })

    expect(response.source).toBe("llm")
    expect(response.usage.fallbackUsed).toBe(false)
    expect(response.message).toContain("LLM fallback is disabled")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("avoids LLM when retrieval has enough context for a templated response", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    vi.stubEnv("OPENROUTER_API_KEY", "test-key")
    vi.stubGlobal("fetch", fetchImpl)

    const response = await createTutorResponse({
      answer: "How do I standardize a normal score with a mean?",
      allowLlmFallback: true,
      mode: "hint",
      sessionId: "llm-retrieval-context-test",
      topicId: "normal-standardization",
    })

    expect(response.source).toBe("retrieval")
    expect(response.verdict).toBe("guidance")
    expect(response.hints[0]).toContain("z = (x - mean)")
    expect(
      response.retrievedContext.some((chunk) => chunk.id === "z-score-formula"),
    ).toBe(true)
    expect(response.responseLabel).toBe("approved_course_content")
    expect(response.usage.contextUsed).toBe(true)
    expect(response.usage.fallbackUsed).toBe(false)
    expect(response.progress?.state).toBe("retrieval_guidance")
    expect(response.progress?.llmUsed).toBe(false)
    expect(response.progress?.retrievalUsed).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("labels general probability help beyond approved course/demo content", async () => {
    mockLlmResponse(
      "A confidence interval describes plausible values for an unknown population parameter.",
    )

    const response = await createTutorResponse({
      answer: "What is a confidence interval?",
      allowLlmFallback: true,
      mode: "hint",
      sessionId: "llm-general-help-test",
    })

    expect(response.source).toBe("llm")
    expect(response.retrievedContext).toHaveLength(0)
    expect(response.responseLabel).toBe("general_ai_help")
    expect(response.usage.contextUsed).toBe(false)
    expect(response.usage.fallbackUsed).toBe(true)
    expect(response.message).toContain(
      "general AI help beyond approved course/demo content",
    )
    expect(response.progress?.llmUsed).toBe(true)
  })

  it("skips a self-referential retrieval echo and goes straight to real LLM help", async () => {
    const fetchImpl = mockLlmResponse(
      "Try listing the outcomes that satisfy the conditional probability first.",
    )

    await exhaustApprovedHelp("no-self-echo-test")
    const response = await createTutorResponse({
      answer: "I still don't understand this at all.",
      allowLlmFallback: true,
      mode: "check",
      questionId: "dice-sum-eight",
      sessionId: "no-self-echo-test",
    })

    expect(response.source).toBe("llm")
    expect(response.message).not.toContain("I found an approved course pattern")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("uses LLM fallback for low-confidence answer coaching without grading correct", async () => {
    const fetchImpl = mockLlmResponse(
      "Focus on identifying the conditioned sample space first, then compare your expression with that smaller denominator.",
    )

    await exhaustApprovedHelp("llm-low-confidence-test")
    const response = await createTutorResponse({
      answer: "I am not sure how to express this setup.",
      allowLlmFallback: true,
      mode: "check",
      questionId: "dice-sum-eight",
      sessionId: "llm-low-confidence-test",
    })
    const second = await createTutorResponse({
      answer: "  I AM NOT SURE HOW TO EXPRESS THIS SETUP.  ",
      allowLlmFallback: true,
      mode: "check",
      questionId: "dice-sum-eight",
      sessionId: "llm-low-confidence-test",
    })
    const payload = llmRequestPayload(fetchImpl)
    const userPrompt = payload.messages[1]?.content ?? ""

    expect(response.source).toBe("llm")
    expect(response.verdict).toBe("guidance")
    expect(response.responseLabel).toBe("approved_course_content")
    expect(response.usage.contextUsed).toBe(true)
    expect(response.usage.fallbackUsed).toBe(true)
    expect(response.progress?.state).toBe("llm_guidance")
    expect(response.progress?.solved).toBe(false)
    expect(response.steps).toHaveLength(0)
    expect(userPrompt).toContain("low_confidence_answer_help")
    expect(userPrompt).toContain('"confidence": 0.1')
    expect(userPrompt).not.toContain("2/5")
    expect(second.source).toBe("llm")
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(
      getTutorAttemptSnapshotsForTests().findLast(
        (attempt) => attempt.source === "llm",
      ),
    ).toMatchObject({
      contextUsed: true,
      fallbackUsed: true,
      responseLabel: "approved_course_content",
      source: "llm",
    })
  })

  it("surfaces the LLM's own message when the provider request fails", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("bad request", { status: 400 }))
    vi.stubEnv("OPENROUTER_API_KEY", "test-key")
    vi.stubGlobal("fetch", fetchImpl)

    await exhaustApprovedHelp("llm-failure-retrieval-test")
    const response = await createTutorResponse({
      answer: "I am not sure how to express this setup.",
      allowLlmFallback: true,
      mode: "check",
      questionId: "dice-sum-eight",
      sessionId: "llm-failure-retrieval-test",
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(response.source).toBe("llm")
    expect(response.usage.fallbackUsed).toBe(false)
    expect(response.message).toContain("rejected the fallback request")
    expect(response.progress?.llmUsed).toBe(true)
  })

  it("records lightweight tutor attempt snapshots", async () => {
    const response = await createTutorResponse({
      answer: "1/5",
      mode: "check",
      questionId: "dice-sum-eight",
      sessionId: "attempt-snapshot-test",
    })
    const attempts = getTutorAttemptSnapshotsForTests()

    expect(response.verdict).toBe("incorrect")
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({
      answerPreview: "1/5",
      mode: "check",
      questionId: "dice-sum-eight",
      sessionId: "attempt-snapshot-test",
      source: "rule",
      contextUsed: false,
      fallbackUsed: false,
      responseLabel: "approved_course_content",
      verdict: "incorrect",
    })
  })

})

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>

type LlmRequestPayload = {
  max_tokens?: number
  messages: Array<{
    content?: string
    role?: string
  }>
}

function mockLlmResponse(text: string): FetchMock {
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: text } }],
          usage: {
            completion_tokens: 20,
            prompt_tokens: 50,
            total_tokens: 70,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  )

  vi.stubEnv("OPENROUTER_API_KEY", "test-key")
  vi.stubGlobal("fetch", fetchImpl)

  return fetchImpl
}

function llmRequestPayload(fetchImpl: FetchMock) {
  const init = fetchImpl.mock.calls[0]?.[1]
  const body = typeof init?.body === "string" ? init.body : ""

  if (!body) {
    throw new Error("Expected LLM fallback request body.")
  }

  return JSON.parse(body) as LlmRequestPayload
}

async function exhaustApprovedHelp(sessionId: string) {
  for (let index = 0; index < 3; index += 1) {
    await createTutorResponse({
      answer: "",
      mode: "hint",
      questionId: "dice-sum-eight",
      sessionId,
    })
  }

  for (let index = 0; index < 3; index += 1) {
    await createTutorResponse({
      answer: "",
      mode: "solution",
      questionId: "dice-sum-eight",
      sessionId,
    })
  }
}

function contentRepositoryWithChunks(
  retrievalChunks: RetrievalChunk[],
): ContentRepository {
  return {
    async getAdminQuestions() {
      return []
    },
    async getApprovedQuestionById() {
      return undefined
    },
    async getApprovedQuestions() {
      return []
    },
    async getQuestionById() {
      return undefined
    },
    async getQuestionCounts() {
      return {
        byTopic: {},
        total: 0,
      }
    },
    async getProfessorPracticeAnalytics() {
      return {
        commonMisconceptions: [],
        generatedQuestionOutcomes: {
          approved: 0,
          needs_edit: 0,
          needs_regeneration: 0,
          needs_review: 0,
          rejected: 0,
        },
        mode: "demo",
        questions: [],
        summary: {
          totalAttempts: 0,
          totalHintsUsed: 0,
          totalStepsRevealed: 0,
          totalTutorSessions: 0,
        },
        topics: [],
      }
    },
    async getRetrievalChunks() {
      return retrievalChunks
    },
    async getReviewQueue() {
      return []
    },
    async getTopics() {
      return []
    },
    async listQuestions() {
      return []
    },
    async listQuestionsByTopic() {
      return []
    },
    async listTopics() {
      return []
    },
    async importReviewCandidates() {
      return {
        candidates: [],
        imported: true,
        message: "Imported into test repository.",
        mode: "demo",
        nonDurable: true,
      }
    },
    async updateReviewCandidates() {
      return []
    },
    async updateAdminQuestions() {
      return []
    },
    async updateAdminQuestionDetail() {
      return undefined
    },
    async regenerateAdminQuestion() {
      return undefined
    },
    async updateReviewCandidateStatus() {
      return undefined
    },
  }
}

function retrievalChunkFixture(
  overrides: Partial<{
    body: string
    id: string
    keywords: string[]
    llmSafeSummary: string
    priorityTier: RetrievalChunk["priorityTier"]
    sourceType: RetrievalChunk["source"]["sourceType"]
    topicId: string
    trustLevel: RetrievalChunk["source"]["trustLevel"]
    visibility: RetrievalChunk["source"]["visibility"]
  }>,
): RetrievalChunk {
  return {
    body: overrides.body ?? "Use an approved public retrieval pattern.",
    chunkType: "concept",
    conceptTags: ["label test", overrides.topicId ?? "label-topic"],
    formulaRefs: [],
    id: overrides.id ?? "label-test",
    keywords: overrides.keywords ?? ["label", "test"],
    llmSafeSummary: overrides.llmSafeSummary,
    priorityTier: overrides.priorityTier ?? "safe_demo",
    review: {
      status: "approved",
    },
    source: {
      sourceType: overrides.sourceType ?? "original_demo",
      trustLevel: overrides.trustLevel ?? "public_original",
      visibility: overrides.visibility ?? "public",
    },
    title: "Label test retrieval chunk",
    topicId: overrides.topicId ?? "label-topic",
  }
}

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
    const chunks = await getRetrievalChunks()

    expect(questions.length).toBeGreaterThan(0)
    expect(questions.every(isStudentFacingQuestion)).toBe(true)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.every(isStudentFacingRetrievalChunk)).toBe(true)
    expect(
      questions.every(
        (question) => question.source.trustLevel !== "generated_unverified",
      ),
    ).toBe(true)
    expect(
      await getApprovedQuestionById("generated-bayes-campus-badges-1"),
    ).toBeUndefined()
    for (const candidate of generatedReviewCandidates) {
      expect(await getApprovedQuestionById(candidate.id)).toBeUndefined()
    }
  })

  it("exposes a consistent student-facing data repository API", async () => {
    const [topics, questions, conditionalQuestions, counts] = await Promise.all(
      [
        listTopics(),
        listQuestions(),
        listQuestionsByTopic("conditional-probability"),
        getQuestionCounts(),
      ],
    )
    const question = await getQuestionById("dice-sum-eight")

    expect(topics).toHaveLength(11)
    expect(questions).toHaveLength(8)
    expect(question?.id).toBe("dice-sum-eight")
    expect(conditionalQuestions.map((item) => item.id)).toEqual([
      "demo-conditional-spinner-coin",
      "dice-sum-eight",
    ])
    expect(counts.total).toBe(questions.length)
    expect(counts.byTopic["conditional-probability"]).toBe(2)
    expect(
      questions.every(
        (item) =>
          item.review.status === "approved" &&
          item.source.visibility === "public" &&
          item.source.trustLevel !== "generated_unverified",
      ),
    ).toBe(true)
  })

  it("falls back to demo data when configured database reads are unavailable", async () => {
    try {
      vi.stubEnv("APP_DEMO_MODE", "false")
      vi.stubEnv("DATABASE_URL", "postgres://user:pass@example.test/db")

      const [questions, counts] = await Promise.all([
        listQuestions(),
        getQuestionCounts(),
      ])

      expect(getContentRepositoryMode()).toBe("database")
      expect(questions.map((question) => question.id)).toContain(
        "dice-sum-eight",
      )
      expect(counts.total).toBe(8)
      expect(
        questions.every(
          (question) => question.source.trustLevel !== "generated_unverified",
        ),
      ).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("reports clear repository metadata for demo and database modes", () => {
    try {
      vi.stubEnv("APP_DEMO_MODE", "true")
      vi.stubEnv("DATABASE_URL", "")

      expect(getDataRepositoryMetadata()).toMatchObject({
        databaseConfigured: false,
        demoFallbackEnabled: true,
        mode: "demo",
        source: "demo-json",
      })

      vi.stubEnv("APP_DEMO_MODE", "false")
      vi.stubEnv("DATABASE_URL", "postgres://user:pass@example.test/db")

      expect(getDataRepositoryMetadata()).toMatchObject({
        databaseConfigured: true,
        demoFallbackEnabled: true,
        mode: "database",
        source: "postgres",
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("keeps generated questions in needs-review status by default", async () => {
    const queue = await getReviewQueue()
    const additionalDrafts = queue.filter((candidate) =>
      candidate.id.startsWith("generated-additional-"),
    )

    expect(queue).toHaveLength(
      generatedReviewCandidates.length +
        syllabusReviewCandidates.length +
        nextSyllabusReviewCandidates.length +
        followingSyllabusReviewCandidates.length +
        nextUncoveredSyllabusReviewCandidates.length,
    )
    expect(additionalDrafts).toHaveLength(12)
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

  it("keeps generated review candidate files public-safe", () => {
    const forbiddenPublicKeys = [
      "locator",
      "sourceItemIds",
      "privatePhraseHashes",
      "sourceNumberSets",
      "sourceStoryFamilies",
      "patternIds",
    ]
    const serialized = JSON.stringify([
      ...generatedReviewCandidates,
      ...syllabusReviewCandidates,
      ...nextSyllabusReviewCandidates,
      ...followingSyllabusReviewCandidates,
      ...nextUncoveredSyllabusReviewCandidates,
    ])
    const additionalDrafts = generatedReviewCandidates.filter((candidate) =>
      candidate.id.startsWith("generated-additional-"),
    )

    expect(generatedReviewCandidates).toHaveLength(14)
    expect(additionalDrafts).toHaveLength(12)
    expect(
      generatedReviewCandidates.every(
        (candidate) =>
          candidate.prompt.length > 0 &&
          candidate.patternSource.length > 0 &&
          candidate.review.status === "needs_review" &&
          candidate.source.sourceType === "pattern_derived_original" &&
          candidate.source.trustLevel === "generated_unverified" &&
          candidate.source.visibility === "public" &&
          typeof candidate.source.originalityNote === "string" &&
          candidate.source.originalityNote.includes("Original") &&
          candidate.answer.acceptedAnswers.length > 0 &&
          candidate.hints.length > 0 &&
          candidate.solutionSteps.length > 0 &&
          candidate.misconceptions.length > 0,
      ),
    ).toBe(true)
    expect(serialized).not.toMatch(
      /textbook|source page|answer key|worked example|copied from|free throw/i,
    )

    for (const key of forbiddenPublicKeys) {
      expect(serialized).not.toContain(key)
    }

    expect(additionalDrafts.map((candidate) => candidate.topic)).toEqual(
      expect.arrayContaining([
        "Conditional probability",
        "Bayes formula",
        "Binomial distribution",
        "Expected value",
        "Variance",
        "Counting and combinations",
      ]),
    )
  })

  it("keeps generated development examples public-safe", () => {
    const forbiddenPublicKeys = [
      "locator",
      "sourceItemIds",
      "privatePhraseHashes",
      "sourceNumberSets",
      "sourceStoryFamilies",
      "patternIds",
    ]
    const serialized = JSON.stringify(generatedExamples)

    expect(generatedExamples.visibility).toBe("public")
    expect(generatedExamples.examples.length).toBeGreaterThan(0)
    expect(
      generatedExamples.examples.every(
        (example) =>
          example.review.status === "needs_review" &&
          example.source.sourceType === "pattern_derived_original" &&
          example.source.trustLevel === "generated_unverified" &&
          example.source.visibility === "public" &&
          example.source.originalityNote.length > 0,
      ),
    ).toBe(true)
    expect(serialized).not.toMatch(
      /textbook|source page|answer key|worked example|copied from|free throw/i,
    )

    for (const key of forbiddenPublicKeys) {
      expect(serialized).not.toContain(key)
    }
  })

  it("validates public-safe demo question seed patterns", () => {
    const requiredTopics = [
      "basic probability",
      "counting",
      "conditional probability",
      "independence",
      "expected value",
      "permutations",
      "combinations",
      "Bayes rule",
      "binomial distribution",
      "hypergeometric distribution",
      "variance",
      "normal approximation",
    ]
    const serialized = JSON.stringify(demoQuestionPatterns)

    execFileSync("node", ["scripts/validate-demo-question-patterns.mjs"], {
      cwd: process.cwd(),
      stdio: "pipe",
    })
    expect(demoQuestionPatterns.visibility).toBe("public")
    expect(demoQuestionPatterns.patterns).toHaveLength(requiredTopics.length)

    for (const topic of requiredTopics) {
      expect(
        demoQuestionPatterns.patterns.some(
          (pattern) => pattern.topic === topic,
        ),
      ).toBe(true)
    }

    expect(
      demoQuestionPatterns.patterns.every(
        (pattern) =>
          pattern.id &&
          pattern.difficulty &&
          pattern.variables.length > 0 &&
          pattern.constraints.length > 0 &&
          pattern.generationNotes.length > 0 &&
          pattern.misconceptionHooks.length > 0,
      ),
    ).toBe(true)
    expect(serialized).not.toMatch(
      /sourceItemIds|privatePhraseHashes|sourceNumberSets|sourceStoryFamilies|patternIds|source page|answer key/i,
    )
  })

  it("prepares reviewable public database seed SQL from safe fixtures", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "db-seed-"))
    const outputPath = path.join(tempDir, "public-db-seed.sql")

    execFileSync("npm", ["run", "db:seed", "--", "--output", outputPath], {
      cwd: process.cwd(),
      stdio: "pipe",
    })

    const sql = readFileSync(outputPath, "utf8")

    expect(sql).toContain("insert into topics")
    expect(sql).toContain("insert into questions")
    expect(sql).toContain("insert into hints")
    expect(sql).toContain("insert into solution_steps")
    expect(sql).not.toContain("insert into question_patterns")
    expect(sql).not.toContain("generated-bayes-campus-badges-1")
    expect(sql).not.toContain("generated_unverified")
    expect(sql).not.toContain("needs_review")
    expect(sql).not.toMatch(
      /source page|answer key|worked example|copied from|verbatim|raw extracted|private chunk|embedding/i,
    )
  })

  it("optionally includes approved generated questions in seed SQL", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "db-seed-approved-"))
    const outputPath = path.join(tempDir, "public-db-seed.sql")
    const approvedGeneratedPath = path.join(
      tempDir,
      "approved-generated-questions.json",
    )

    writeFileSync(
      approvedGeneratedPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          visibility: "public",
          questions: [
            {
              id: "approved-generated-seed-fixture",
              topicId: "introduction-probability-venn-diagrams",
              topic: "basic probability",
              difficulty: "foundational",
              questionText:
                "A transit counter records 6 valid scans out of 8 scans. What fraction were valid?",
              finalAnswer: "3/4",
              solutionSteps: [
                "Use valid scans divided by total scans.",
                "6/8 simplifies to 3/4.",
              ],
              hints: ["Use valid scans over total scans."],
              misconceptions: [
                {
                  id: "uses-invalid-scans",
                  hook: "Counting invalid scans.",
                  feedback: "Use valid scans for the numerator.",
                },
              ],
              patternId: "pattern-basic-probability-complement",
              originalityNote: "Original generated fixture.",
              sourceMetadata: {
                sourceType: "generated_original",
                visibility: "public",
                originalityNote: "Original generated fixture.",
              },
              reviewStatus: "approved",
              trustLevel: "professor_approved",
            },
          ],
        },
        null,
        2,
      )}\n`,
    )

    execFileSync(
      "npm",
      [
        "run",
        "db:seed",
        "--",
        "--output",
        outputPath,
        "--include-approved-generated",
        "--approved-generated-input",
        approvedGeneratedPath,
      ],
      { cwd: process.cwd(), stdio: "pipe" },
    )

    const sql = readFileSync(outputPath, "utf8")

    expect(sql).toContain("approved-generated-seed-fixture")
    expect(sql).toContain("insert into misconceptions")
    expect(sql).toContain("professor_approved")
    expect(sql).not.toContain("generated_unverified")
    expect(sql).not.toContain("needs_review")
  })

  it("defines the requested public-safe database tables", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "db/migrations/001_initial_schema.sql"),
      "utf8",
    )
    const requiredTables = [
      "topics",
      "questions",
      "solution_steps",
      "hints",
      "misconceptions",
      "tutor_sessions",
      "attempts",
      "ai_usage",
      "ai_response_cache",
    ]

    for (const tableName of requiredTables) {
      expect(migration).toMatch(
        new RegExp(`create table if not exists ${tableName}\\b`),
      )
    }

    expect(migration).toContain("review_status")
    expect(migration).toContain("trust_level")
    expect(migration).toContain("source_type")
    expect(migration).toContain("app_public_questions")
    expect(migration).not.toMatch(/create table if not exists .*embedding/i)
    expect(migration).not.toMatch(/create table if not exists .*chunk/i)
  })

  it("rejects public database seed payloads with private fields", () => {
    const result = spawnSync(
      "node",
      [
        "-e",
        [
          "import('./scripts/prepare-public-db-seed.mjs').then(({ validatePublicSeedPayload }) => {",
          "const errors = validatePublicSeedPayload({",
          "demoQuestions: [{ id: 'unsafe', topic: 'basic probability', questionText: 'Original question?', finalAnswer: '1/2', hints: ['h'], solutionSteps: ['s'], reviewStatus: 'approved', locator: 'p. 1' }],",
          "demoPatterns: { visibility: 'public', patterns: [] },",
          "reviewCandidates: [],",
          "approvedGenerated: { visibility: 'public', questions: [] }",
          "});",
          "if (errors.length === 0) process.exit(1);",
          "console.error(errors.join('\\n'));",
          "});",
        ].join(" "),
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    )

    expect(result.status).toBe(0)
    expect(result.stderr).toContain("locator")
  })

  it("rejects unapproved generated questions when optional seed input is enabled", () => {
    const result = spawnSync(
      "node",
      [
        "-e",
        [
          "import('./scripts/prepare-public-db-seed.mjs').then(({ validatePublicSeedPayload }) => {",
          "const errors = validatePublicSeedPayload({",
          "demoQuestions: [{ id: 'safe-demo', topic: 'basic probability', questionText: 'Original question?', finalAnswer: '1/2', hints: ['h'], solutionSteps: ['s'], reviewStatus: 'approved' }],",
          "approvedGenerated: { visibility: 'public', questions: [{ id: 'draft', topic: 'basic probability', questionText: 'Original draft?', finalAnswer: '1/2', hints: ['h'], solutionSteps: ['s'], reviewStatus: 'needs_review', trustLevel: 'generated_unverified', sourceMetadata: { sourceType: 'generated_original', visibility: 'public' } }] }",
          "}, { includeApprovedGenerated: true });",
          "if (errors.length === 0) process.exit(1);",
          "console.error(errors.join('\\n'));",
          "});",
        ].join(" "),
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    )

    expect(result.status).toBe(0)
    expect(result.stderr).toContain("reviewStatus must be approved")
    expect(result.stderr).toContain("trustLevel must be professor_approved")
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

  it("keeps generated-unverified database rows out of student-facing access", () => {
    const draftQuestion = mapQuestionRow({
      accepted_answers_json: ["1/2"],
      answer_explanation: "Use the approved pattern after review.",
      difficulty: "foundational",
      hints_json: ["Identify the relevant sample space."],
      id: "db-generated-draft",
      misconceptions_json: [],
      numeric_value: null,
      originality_note: "Original generated draft.",
      pattern_id: "pattern-basic-probability-complement",
      prompt: "Original generated draft question?",
      reviewed_at: null,
      reviewed_by: null,
      review_status: "needs_review",
      solution_steps_json: ["Compute the requested probability."],
      source_type: "pattern_derived_original",
      title: "Generated draft",
      tolerance: null,
      topic_id: "basic-probability",
      trust_level: "generated_unverified",
      visibility: "public",
    })

    expect(isStudentFacingQuestion(draftQuestion)).toBe(false)
    expect(approvedPublicWhereClauseForTests()).toContain(
      "review_status = 'approved'",
    )
    expect(approvedPublicWhereClauseForTests()).toContain(
      "visibility = 'public'",
    )
  })

  it("uses the demo content repository unless database mode is explicitly enabled", () => {
    try {
      vi.stubEnv("APP_DEMO_MODE", "true")
      vi.stubEnv("DATABASE_URL", "postgres://user:pass@example.test/db")

      expect(getContentRepositoryMode()).toBe("demo")

      vi.stubEnv("APP_DEMO_MODE", "false")

      expect(getContentRepositoryMode()).toBe("database")

      vi.stubEnv("DATABASE_URL", "")

      expect(getContentRepositoryMode()).toBe("demo")
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe("problem-pattern generation pipeline", () => {
  it("generates private original question drafts from public seed patterns", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "generated-questions-"))
    const outputPath = path.join(tempDir, "generated-questions.json")

    execFileSync(
      "node",
      ["scripts/generate-questions.mjs", "--output", outputPath],
      { cwd: process.cwd(), stdio: "pipe" },
    )

    const payload = JSON.parse(readFileSync(outputPath, "utf8"))
    const questions = payload.questions as GeneratedQuestionDraft[]
    const expectedTopics = [
      "basic probability",
      "counting",
      "conditional probability",
      "independence",
      "expected value",
      "permutations",
      "combinations",
      "Bayes rule",
      "binomial distribution",
      "hypergeometric distribution",
      "variance",
      "normal approximation",
    ]

    expect(payload.visibility).toBe("private")
    expect(payload.source.type).toBe(
      "deterministic_generation_from_public_seed_patterns",
    )
    expect(questions).toHaveLength(expectedTopics.length)
    expect(
      questions.every(
        (question) =>
          question.sourceType === "generated_original" &&
          question.trustLevel === "generated_unverified" &&
          question.reviewStatus === "needs_review" &&
          question.originalityNote.length > 0 &&
          question.questionText.length > 0 &&
          question.finalAnswer.length > 0 &&
          question.solutionSteps.length > 0 &&
          question.hints.length > 0 &&
          question.misconceptions.length > 0,
      ),
    ).toBe(true)
    expect(questions.map((question) => question.topic)).toEqual(expectedTopics)
    expect(JSON.stringify(payload)).not.toMatch(
      /textbook|source page|answer key|worked example|free throw/i,
    )
  })

  it("validates generated question drafts", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "validate-generated-"))
    const outputPath = path.join(tempDir, "generated-questions.json")

    execFileSync(
      "node",
      ["scripts/generate-questions.mjs", "--output", outputPath],
      { cwd: process.cwd(), stdio: "pipe" },
    )
    const result = spawnSync(
      "node",
      ["scripts/validate-generated-questions.mjs", "--input", outputPath],
      { cwd: process.cwd(), encoding: "utf8" },
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Validated 12 generated question draft")
  })

  it("suggests private abstract patterns from course outline metadata", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "suggest-patterns-"))
    const inputPath = path.join(tempDir, "course-outline.json")
    const privateTextDir = path.join(tempDir, "private-text")
    const outputPath = path.join(tempDir, "suggested-patterns.json")
    const privatePhrase = "private fixture phrase that must not be copied"

    mkdirSync(privateTextDir)
    writeFileSync(
      inputPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          visibility: "public",
          topics: ["Conditional probability", "Expected value"],
          sectionHeadings: ["Binomial Models"],
          formulas: [
            {
              name: "Binomial exact count",
              symbolicFormula: "P(X = k) = C(n,k)p^k(1-p)^(n-k)",
            },
          ],
          learningObjectives: [
            "Apply Bayes-type reasoning.",
            "Compute expected value as a weighted average.",
          ],
          misconceptionCandidates: ["Confusing P(A | B) with P(B | A)."],
        },
        null,
        2,
      )}\n`,
    )
    writeFileSync(
      path.join(privateTextDir, "signals.txt"),
      `${privatePhrase} variance standard deviation normal`,
    )

    execFileSync(
      "node",
      [
        "scripts/suggest-patterns.mjs",
        "--input",
        inputPath,
        "--private-text-dir",
        privateTextDir,
        "--output",
        outputPath,
      ],
      { cwd: process.cwd(), stdio: "pipe" },
    )

    const payload = JSON.parse(readFileSync(outputPath, "utf8"))
    const suggestedPatterns = payload.suggestedPatterns as {
      abstractTemplate: string
      allowedGeneratedUse: string
      humanReviewNotes: string[]
      reviewStatus: string
      suggestionStatus: string
    }[]
    const serialized = JSON.stringify(payload)

    expect(payload.visibility).toBe("private")
    expect(payload.source.type).toBe(
      "course_outline_metadata_pattern_suggestions",
    )
    expect(payload.source.privateText.fileCount).toBe(1)
    expect(payload.source.privateText.usedForTopicSignalsOnly).toBe(true)
    expect(suggestedPatterns.length).toBeGreaterThan(0)
    expect(
      suggestedPatterns.every(
        (pattern) =>
          pattern.allowedGeneratedUse === "pattern_only" &&
          pattern.reviewStatus === "needs_review" &&
          pattern.suggestionStatus === "needs_human_review" &&
          pattern.abstractTemplate.length > 0 &&
          !pattern.abstractTemplate.includes("?") &&
          pattern.humanReviewNotes.length > 0,
      ),
    ).toBe(true)
    expect(payload.humanReviewNotes.length).toBeGreaterThan(0)
    expect(payload.source.privateText.matchedTopicIds).toContain(
      "normal-standardization",
    )
    expect(serialized).not.toContain(privatePhrase)
    expect(serialized).not.toMatch(
      /"prompt"|"questionText"|"solutionSteps"|source page|answer key|worked example|copied from/i,
    )
  })

  it("prepares a private review queue from generated question drafts", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "review-queue-"))
    const generatedPath = path.join(tempDir, "generated-questions.json")
    const queuePath = path.join(tempDir, "review-queue.json")

    execFileSync(
      "node",
      ["scripts/generate-questions.mjs", "--output", generatedPath],
      { cwd: process.cwd(), stdio: "pipe" },
    )
    execFileSync(
      "node",
      [
        "scripts/prepare-review-queue.mjs",
        "--input",
        generatedPath,
        "--output",
        queuePath,
      ],
      { cwd: process.cwd(), stdio: "pipe" },
    )

    const payload = JSON.parse(readFileSync(queuePath, "utf8"))
    const reviewQueue = payload.reviewQueue as GeneratedQuestionReviewItem[]

    expect(payload.visibility).toBe("private")
    expect(payload.source.type).toBe("generated_original_questions")
    expect(reviewQueue).toHaveLength(12)
    expect(
      reviewQueue.every(
        (item) =>
          item.question.length > 0 &&
          item.answer.length > 0 &&
          item.solutionSteps.length > 0 &&
          item.hints.length > 0 &&
          item.misconceptions.length > 0 &&
          item.patternId.length > 0 &&
          item.originalityNote.length > 0 &&
          item.reviewStatus === "needs_review",
      ),
    ).toBe(true)
    expect(JSON.stringify(payload)).not.toMatch(
      /source page|answer key|worked example|copied from/i,
    )
  })

  it("promotes only approved generated questions to public processed output", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "promote-approved-"))
    const queuePath = path.join(tempDir, "review-queue.json")
    const outputPath = path.join(tempDir, "approved-generated-questions.json")

    writeFileSync(
      queuePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          visibility: "private",
          reviewQueue: [
            reviewQueueFixture("approved-item", "approved"),
            reviewQueueFixture("needs-review-item", "needs_review"),
            reviewQueueFixture("rejected-item", "rejected"),
            reviewQueueFixture("needs-edit-item", "needs_edit"),
          ],
        },
        null,
        2,
      )}\n`,
    )
    execFileSync(
      "node",
      [
        "scripts/promote-approved-questions.mjs",
        "--input",
        queuePath,
        "--output",
        outputPath,
      ],
      { cwd: process.cwd(), stdio: "pipe" },
    )

    const payload = JSON.parse(readFileSync(outputPath, "utf8"))
    const questions = payload.questions as ApprovedGeneratedQuestion[]

    expect(payload.visibility).toBe("public")
    expect(questions).toHaveLength(1)
    expect(questions[0].id).toBe("approved-approved-item")
    expect(questions[0].reviewStatus).toBe("approved")
    expect(questions[0].trustLevel).toBe("professor_approved")
    expect(questions[0].sourceMetadata.sourceType).toBe("generated_original")
    expect(questions[0].sourceMetadata.originalityNote).toBe(
      "Original synthetic fixture.",
    )
    expect(JSON.stringify(payload)).not.toMatch(
      /needs-review-item|rejected-item|needs-edit-item|source page|answer key|worked example/i,
    )
  })

  it("refuses to promote approved items with copied-source signals", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "promote-blocked-"))
    const queuePath = path.join(tempDir, "review-queue.json")
    const outputPath = path.join(tempDir, "approved-generated-questions.json")
    const copiedItem = {
      ...reviewQueueFixture("copied-item", "approved"),
      question: "This question was copied from a textbook source page.",
    }

    writeFileSync(
      queuePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          visibility: "private",
          reviewQueue: [copiedItem],
        },
        null,
        2,
      )}\n`,
    )

    const result = spawnSync(
      "node",
      [
        "scripts/promote-approved-questions.mjs",
        "--input",
        queuePath,
        "--output",
        outputPath,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("cannot be promoted")
  })

  it("rejects generated drafts with missing required review fields", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "invalid-generated-"))
    const inputPath = path.join(tempDir, "generated-questions.json")

    writeFileSync(
      inputPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          visibility: "private",
          questions: [
            {
              id: "invalid-generated-question",
              patternId: "pattern-basic-probability-complement",
              topic: "basic probability",
              difficulty: "foundational",
              questionText: "Original placeholder question?",
              finalAnswer: "",
              solutionSteps: [],
              hints: [],
              misconceptions: [],
              sourceType: "generated_original",
              trustLevel: "generated_unverified",
              reviewStatus: "approved",
              originalityNote: "",
            },
          ],
        },
        null,
        2,
      )}\n`,
    )

    const result = spawnSync(
      "node",
      ["scripts/validate-generated-questions.mjs", "--input", inputPath],
      { cwd: process.cwd(), encoding: "utf8" },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("finalAnswer")
    expect(result.stderr).toContain("reviewStatus must be needs_review")
    expect(result.stderr).toContain("solutionSteps")
    expect(result.stderr).toContain("hints")
    expect(result.stderr).toContain("originalityNote")
  })

  it("warns when generated drafts overlap private patterns or source text", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "warning-generated-"))
    const inputPath = path.join(tempDir, "generated-questions.json")
    const privatePatternsPath = path.join(tempDir, "question-patterns.json")
    const privateTextDir = path.join(tempDir, "private-text")

    mkdirSync(privateTextDir)
    writeFileSync(
      inputPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          visibility: "private",
          questions: [
            {
              id: "warning-generated-question",
              patternId: "private-pattern-overlap",
              topic: "basic probability",
              difficulty: "foundational",
              questionText:
                "A private source sentence repeats exactly enough words to trigger the local overlap warning.",
              finalAnswer: "1/2",
              solutionSteps: [
                "Use favorable outcomes divided by total outcomes.",
              ],
              hints: ["Identify the sample space."],
              misconceptions: [
                {
                  id: "wrong-denominator",
                  hook: "Using the wrong total count.",
                  feedback: "Use the total number of possible outcomes.",
                },
              ],
              sourceType: "generated_original",
              trustLevel: "generated_unverified",
              reviewStatus: "needs_review",
              originalityNote: "Original synthetic warning fixture.",
            },
          ],
        },
        null,
        2,
      )}\n`,
    )
    writeFileSync(
      privatePatternsPath,
      `${JSON.stringify({
        schemaVersion: 1,
        visibility: "private",
        patterns: [
          {
            id: "private-pattern-overlap",
            title: "Private overlap pattern",
            abstractTemplate:
              "A private source sentence repeats exactly enough words to trigger the local overlap warning.",
          },
        ],
      })}\n`,
    )
    writeFileSync(
      path.join(privateTextDir, "source.txt"),
      "A private source sentence repeats exactly enough words to trigger the local overlap warning.",
    )

    const result = spawnSync(
      "node",
      [
        "scripts/validate-generated-questions.mjs",
        "--input",
        inputPath,
        "--private-patterns",
        privatePatternsPath,
        "--private-text-dir",
        privateTextDir,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    )

    expect(result.status).toBe(0)
    expect(result.stderr).toContain("WARNING")
    expect(result.stderr).toContain("private pattern")
    expect(result.stderr).toContain("private source text")
  })

  it("generates original review drafts from private abstract patterns", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "pattern-generation-"))
    const inputPath = path.join(tempDir, "question-patterns.json")
    const outputPath = path.join(tempDir, "generated-review-candidates.json")
    const auditPath = path.join(tempDir, "generation-audit.json")
    const privateTextDir = path.join(tempDir, "private-text")

    writeFileSync(
      inputPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          visibility: "private",
          patterns: [
            {
              id: "private-binomial-fixture",
              topicId: "binomial-models",
              title: "Binomial exact-count pattern",
              abstractTemplate:
                "Independent trials with fixed success probability and exact successes.",
              conceptTags: ["binomial", "exact count"],
              formulaRefs: ["P(X = k) = C(n,k)p^k(1-p)^(n-k)"],
              mappingStatus: "mapped",
              forbiddenSimilarity: {
                sourceStoryFamilies: ["free throw"],
                sourceNumberSets: [["6", "4", "0.7"]],
                privatePhraseHashes: [],
              },
            },
            {
              id: "private-unmapped-fixture",
              topicId: "needs-topic",
              title: "Unmapped pattern",
              abstractTemplate: "A pattern that still needs a topic.",
              conceptTags: ["counting"],
              formulaRefs: [],
              mappingStatus: "needs_topic_mapping",
              forbiddenSimilarity: {
                sourceStoryFamilies: [],
                sourceNumberSets: [],
                privatePhraseHashes: [],
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
    )

    execFileSync(
      "node",
      [
        "scripts/generate-review-candidates.mjs",
        "--input",
        inputPath,
        "--output",
        outputPath,
        "--audit",
        auditPath,
        "--private-text-dir",
        privateTextDir,
      ],
      { cwd: process.cwd(), stdio: "pipe" },
    )

    const candidates = JSON.parse(readFileSync(outputPath, "utf8"))
    const audit = JSON.parse(readFileSync(auditPath, "utf8"))
    const [candidate] = candidates

    expect(candidates).toHaveLength(1)
    expect(candidate.id).toBe("generated-binomial-study-app-1")
    expect(candidate.prompt).toContain("8 independent review cards")
    expect(candidate.prompt).not.toMatch(/free throw/i)
    expect(candidate.review.status).toBe("needs_review")
    expect(candidate.source.trustLevel).toBe("generated_unverified")
    expect(candidate.source).not.toHaveProperty("patternIds")
    expect(candidate.answer.numericValue).toBeGreaterThan(0.02)
    expect(candidate.answer.numericValue).toBeLessThan(0.95)
    expect(audit.generated[0].patternId).toBe("private-binomial-fixture")
    expect(audit.skipped[0].reason).toContain("topic mapping")
  })
})

function reviewQueueFixture(
  id: string,
  reviewStatus: "approved" | "needs_edit" | "needs_review" | "rejected",
): GeneratedQuestionReviewItem {
  return {
    id: `review-${id}`,
    question: `Original generated question for ${id}?`,
    answer: "1/2",
    solutionSteps: [
      "Use the intended formula.",
      "Compute the requested value.",
    ],
    hints: ["Identify the relevant quantities."],
    misconceptions: [
      {
        id: "fixture-misconception",
        hook: "Using the wrong denominator.",
        feedback: "Use the relevant sample space.",
      },
    ],
    patternId: "pattern-basic-probability-complement",
    originalityNote: "Original synthetic fixture.",
    reviewStatus,
    topic: "basic probability",
    difficulty: "foundational",
  }
}

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

    const priorityResponse = await postProfessorReview(
      new Request("http://localhost/api/professor/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-professor-token": "local-secret",
        },
        body: JSON.stringify({
          candidateId: "generated-bayes-campus-badges-1",
          reviewPriority: "priority",
        }),
      }),
    )
    const approveResponse = await postProfessorReview(
      new Request("http://localhost/api/professor/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-professor-token": "local-secret",
        },
        body: JSON.stringify({
          action: "approve",
          candidateId: "generated-bayes-campus-badges-1",
        }),
      }),
    )
    const approvedPayload = await approveResponse.json()

    expect(priorityResponse.status).toBe(200)
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
          candidateId: "generated-binomial-study-app-1",
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
    delete process.env.AI_MODEL
  })

  it("provides safe defaults when optional local env values are missing", () => {
    const env = getServerEnv()

    expect(env.APP_DEMO_MODE).toBe(true)
    expect(env.AI_MODEL).toBe("nvidia/nemotron-3-ultra-550b-a55b:free")
  })
})
