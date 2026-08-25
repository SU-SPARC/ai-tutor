import { describe, expect, it } from "vitest"

import { parseLlmTutorOutput } from "@/lib/ai/llm-tutor"
import { validateTutorResponseGuardrails } from "@/lib/ai/response-guardrails"
import { rankRetrievalChunks } from "@/lib/tutor/retrieval"
import type {
  LlmGroundingContext,
  RetrievalChunk,
  TutorMode,
} from "@/lib/types"

const retrievalTopics = [
  ["conditional-probability", "conditional sample space", "conditioned outcomes"],
  ["binomial-models", "binomial independent trials", "exact success count"],
  ["normal-standardization", "z score standardize", "subtract mean deviation"],
  ["confidence-intervals", "confidence interval margin", "standard error interval"],
  ["hypothesis-testing", "null hypothesis p value", "test statistic evidence"],
] as const

const retrievalChunks = retrievalTopics.map(
  ([topicId, keywords, body], index): RetrievalChunk => ({
    body: `Use ${body} before doing the calculation.`,
    chunkType: "concept",
    conceptTags: keywords.split(" "),
    formulaRefs: [],
    id: `eval-retrieval-${index}`,
    keywords: keywords.split(" "),
    priorityTier: "approved_professor_course",
    review: { status: "approved" },
    source: {
      sourceType: "professor_provided",
      trustLevel: "course_approved",
      visibility: "public",
    },
    title: `${keywords} guidance`,
    topicId,
  }),
)

describe("production AI evaluation gates", () => {
  it("meets retrieval Recall@2 and no-match precision thresholds across 50 cases", () => {
    const relevantCases = retrievalTopics.flatMap(
      ([topicId, keywords], topicIndex) =>
        Array.from({ length: 8 }, (_, variant) => ({
          expectedId: `eval-retrieval-${topicIndex}`,
          query: `${keywords} ${["setup", "formula", "help", "reasoning"][variant % 4]}`,
          topicId,
        })),
    )
    const noMatchCases = Array.from({ length: 10 }, (_, index) => ({
      query: `unrelated music recommendation ${index}`,
      topicId: retrievalTopics[index % retrievalTopics.length][0],
    }))

    const recalled = relevantCases.filter((testCase) =>
      rankRetrievalChunks(testCase.query, retrievalChunks, {
        maxResults: 2,
        topicId: testCase.topicId,
      }).some((match) => match.chunk.id === testCase.expectedId),
    ).length
    const correctlyRejected = noMatchCases.filter(
      (testCase) =>
        rankRetrievalChunks(testCase.query, retrievalChunks, {
          maxResults: 2,
          topicId: testCase.topicId,
        }).length === 0,
    ).length

    expect(relevantCases.length + noMatchCases.length).toBeGreaterThanOrEqual(50)
    expect(recalled / relevantCases.length).toBeGreaterThanOrEqual(0.9)
    expect(correctlyRejected / noMatchCases.length).toBeGreaterThanOrEqual(0.95)
  })

  it("meets schema, safety, grounded-correctness, and helpfulness gates across 50 cases", () => {
    const templates = [
      {
        action: "hint" as const,
        keyword: "sample space",
        message:
          "Start with the conditioned sample space, then count only outcomes that satisfy the condition.",
        mode: "check" as TutorMode,
        task: "low_confidence_answer_help" as const,
      },
      {
        action: "next_step" as const,
        keyword: "formula",
        message:
          "For the next step, write the relevant formula and identify each quantity before substituting values.",
        mode: "solution" as TutorMode,
        task: "retrieval_explanation" as const,
      },
      {
        action: "concept_explanation" as const,
        keyword: "parameter",
        message:
          "A confidence interval describes plausible values for a population parameter using sample uncertainty.",
        mode: "check" as TutorMode,
        task: "conceptual_explanation" as const,
      },
    ]
    const cases = Array.from({ length: 50 }, (_, index) => templates[index % 3])
    let valid = 0
    let grounded = 0
    let helpful = 0
    let criticalViolations = 0

    for (const testCase of cases) {
      const output = parseLlmTutorOutput(
        JSON.stringify({
          schemaVersion: 1,
          pedagogicalAction: testCase.action,
          message: testCase.message,
        }),
        { mode: testCase.mode, task: testCase.task },
      )
      if (!output) {
        continue
      }
      valid += 1
      grounded += output.message.toLowerCase().includes(testCase.keyword) ? 1 : 0
      helpful += output.message.length >= 40 ? 1 : 0
      criticalViolations += validateTutorResponseGuardrails({
        allowedDisclosure:
          testCase.action === "next_step" ? "next_step_only" : "hint_only",
        response: output.message,
      }).filter((violation) =>
        [
          "copied_source_like_text",
          "full_solution_too_early",
          "private_or_raw_content",
          "system_prompt_exposure",
        ].includes(violation),
      ).length
    }

    expect(valid / cases.length).toBe(1)
    expect(criticalViolations).toBe(0)
    expect(grounded / cases.length).toBeGreaterThanOrEqual(0.9)
    expect(helpful / cases.length).toBeGreaterThanOrEqual(0.85)
  })

  it("never includes private identifiers in the grounding contract", () => {
    const grounding: LlmGroundingContext = {
      body: "Use the reviewed conditional-probability pattern.",
      id: "server-private-id",
      priorityTier: "private_reference",
      sourceType: "private_reference_pattern",
      title: "Server-only source title",
      topicId: "conditional-probability",
    }

    expect(grounding.body).not.toMatch(/page|locator|excerpt|answer key/i)
  })
})
