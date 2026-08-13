import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  QUESTION_CHUNK_MAX_BODY_CHARACTERS,
  chunkQuestion,
  validateQuestionChunks,
} from "@/lib/ai/chunk-question"

describe("question retrieval chunks", () => {
  it("splits a question into question, solution, hint, and misconception chunks", () => {
    const chunks = chunkQuestion({
      id: "approved-demo-question",
      topic: "basic probability",
      topicId: "introduction-probability-venn-diagrams",
      title: "Basic probability",
      difficulty: "foundational",
      questionText: "A tray has 3 blue slips and 2 red slips. What is P(blue)?",
      finalAnswer: "3/5",
      answerExplanation: "Use favorable outcomes divided by total outcomes.",
      solutionSteps: ["Count 3 favorable slips out of 5 total slips."],
      hints: ["Find the denominator first."],
      misconceptions: [
        {
          id: "uses-red-count",
          matchTerms: ["2/5"],
          feedback: "That uses the red slips instead of the blue slips.",
        },
      ],
      sourceType: "original_demo",
      trustLevel: "public_original",
      reviewStatus: "approved",
      visibility: "public",
    })

    expect(chunks.map((chunk) => chunk.chunkType)).toEqual([
      "question",
      "solution_summary",
      "solution_step",
      "hint",
      "misconception",
    ])
    expect(
      chunks.every((chunk) => chunk.questionId === "approved-demo-question"),
    ).toBe(true)
    expect(
      chunks.every(
        (chunk) => chunk.body.length <= QUESTION_CHUNK_MAX_BODY_CHARACTERS,
      ),
    ).toBe(true)
    expect(validateQuestionChunks(chunks, { visibility: "public" })).toEqual([])
  })

  it("prepares separate student and admin/dev chunk outputs without OpenAI calls", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "question-chunks-"))
    const demoInput = path.join(tempDir, "demo-questions.json")
    const approvedGeneratedInput = path.join(
      tempDir,
      "approved-generated-questions.json",
    )
    const reviewQueueInput = path.join(tempDir, "review-queue.json")
    const reviewCandidatesInput = path.join(tempDir, "review-candidates.json")
    const publicOutput = path.join(tempDir, "public-question-chunks.json")
    const privateOutput = path.join(tempDir, "private-question-chunks.json")

    mkdirSync(tempDir, { recursive: true })
    writeFileSync(
      demoInput,
      `${JSON.stringify(
        [
          {
            id: "demo-safe",
            topic: "basic probability",
            topicId: "introduction-probability-venn-diagrams",
            difficulty: "foundational",
            questionText:
              "A basket has 1 marked card and 3 plain cards. What is P(marked)?",
            finalAnswer: "1/4",
            solutionSteps: ["Use 1 marked card out of 4 total cards."],
            hints: ["Count the total cards."],
            misconceptions: [
              {
                id: "uses-plain-count",
                feedback: "Use marked cards as favorable outcomes.",
              },
            ],
            sourceMetadata: {
              sourceType: "original_demo",
              visibility: "public",
            },
            reviewStatus: "approved",
            trustLevel: "original_demo",
          },
        ],
        null,
        2,
      )}\n`,
    )
    writeFileSync(
      approvedGeneratedInput,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          visibility: "public",
          questions: [
            {
              id: "approved-generated-safe",
              topic: "counting",
              topicId: "axioms-probability-counting-methods",
              difficulty: "foundational",
              questionText:
                "Choose 2 labels from 5 labels. How many groups are possible?",
              finalAnswer: "10",
              solutionSteps: ["Compute C(5,2) = 10."],
              hints: ["Order does not matter."],
              misconceptions: [
                {
                  id: "uses-permutation",
                  hook: "Treating groups as ordered.",
                  feedback: "Use combinations because order does not matter.",
                },
              ],
              sourceMetadata: {
                sourceType: "generated_original",
                visibility: "public",
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
    writeFileSync(
      reviewQueueInput,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          visibility: "private",
          reviewQueue: [
            {
              id: "review-generated-safe",
              topic: "binomial models",
              topicId: "binomial-models",
              difficulty: "intermediate",
              question:
                "A tool runs 4 independent checks. What is P(exactly 1 success)?",
              answer: "C(4,1)p(1-p)^3",
              solutionSteps: ["Use the binomial exact-count formula."],
              hints: ["Identify n and k."],
              misconceptions: [
                {
                  id: "missing-combination",
                  hook: "Using one order only.",
                  feedback: "Include the combination term.",
                },
              ],
              reviewStatus: "needs_review",
            },
          ],
        },
        null,
        2,
      )}\n`,
    )
    writeFileSync(
      reviewCandidatesInput,
      `${JSON.stringify(
        [
          {
            id: "candidate-generated-safe",
            topicId: "conditional-probability",
            topic: "conditional probability",
            title: "Conditional draft",
            prompt:
              "Given a selected item is tagged, what fraction are urgent?",
            difficulty: "foundational",
            answer: {
              acceptedAnswers: ["2/7"],
              explanation: "Restrict the denominator to tagged items.",
            },
            solutionSteps: ["Use the restricted sample space."],
            hints: ["Condition first."],
            misconceptions: [
              {
                id: "uses-full-total",
                matchTerms: ["2/10"],
                feedback: "Use only tagged items in the denominator.",
              },
            ],
            source: {
              sourceType: "pattern_derived_original",
              trustLevel: "generated_unverified",
              visibility: "public",
            },
            review: {
              status: "needs_review",
            },
          },
        ],
        null,
        2,
      )}\n`,
    )

    execFileSync(
      "node",
      [
        "scripts/prepare-question-chunks.mjs",
        "--demo-questions",
        demoInput,
        "--approved-generated",
        approvedGeneratedInput,
        "--review-queue",
        reviewQueueInput,
        "--review-candidates",
        reviewCandidatesInput,
        "--public-output",
        publicOutput,
        "--private-output",
        privateOutput,
      ],
      { cwd: process.cwd(), stdio: "pipe" },
    )

    const publicPayload = JSON.parse(readFileSync(publicOutput, "utf8"))
    const privatePayload = JSON.parse(readFileSync(privateOutput, "utf8"))

    expect(publicPayload.safety.callsOpenAI).toBe(false)
    expect(privatePayload.safety.callsOpenAI).toBe(false)
    expect(publicPayload.chunks).toHaveLength(10)
    expect(privatePayload.chunks).toHaveLength(10)
    expect([
      ...new Set(
        publicPayload.chunks.map(
          (chunk: { questionId: string }) => chunk.questionId,
        ),
      ),
    ]).toEqual(["demo-safe", "approved-generated-safe"])
    expect([
      ...new Set(
        privatePayload.chunks.map(
          (chunk: { questionId: string }) => chunk.questionId,
        ),
      ),
    ]).toEqual(["candidate-generated-safe", "review-generated-safe"])
    expect(
      publicPayload.chunks.every(
        (chunk: { reviewStatus: string; trustLevel: string }) =>
          chunk.reviewStatus === "approved" &&
          chunk.trustLevel !== "generated_unverified",
      ),
    ).toBe(true)
    expect(
      privatePayload.chunks.every(
        (chunk: {
          reviewStatus: string
          trustLevel: string
          visibility: string
        }) =>
          chunk.reviewStatus === "needs_review" &&
          chunk.trustLevel === "generated_unverified" &&
          chunk.visibility === "private",
      ),
    ).toBe(true)
  })
})
