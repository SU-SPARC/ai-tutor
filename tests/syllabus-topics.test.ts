import { describe, expect, it } from "vitest"

import nextSyllabusReviewCandidateData from "../data/demo/next-syllabus-review-candidates.json"
import syllabusReviewCandidateData from "../data/demo/syllabus-review-candidates.json"
import {
  demoQuestions,
  demoTopics,
  reviewCandidates,
} from "@/lib/data/demo-data"
import { isStudentFacingQuestion } from "@/lib/data/demo-repository"
import type { ReviewCandidate } from "@/lib/types"

const INTRO_TOPIC_ID = "introduction-probability-venn-diagrams"
const AXIOMS_TOPIC_ID = "axioms-probability-counting-methods"
const NEXT_TOPIC_IDS = [
  "conditional-probability",
  "random-variables",
  "binomial-models",
] as const
const syllabusCandidates =
  syllabusReviewCandidateData as unknown as ReviewCandidate[]
const nextSyllabusCandidates =
  nextSyllabusReviewCandidateData as unknown as ReviewCandidate[]

describe("syllabus topic catalog", () => {
  it("keeps active topics in deterministic syllabus order", () => {
    expect(
      demoTopics.map(({ id, moduleRef, order, weekNumber }) => ({
        id,
        moduleRef,
        order,
        weekNumber,
      })),
    ).toEqual([
      {
        id: INTRO_TOPIC_ID,
        moduleRef: "Week 1",
        order: 1,
        weekNumber: 1,
      },
      {
        id: AXIOMS_TOPIC_ID,
        moduleRef: "Week 2",
        order: 2,
        weekNumber: 2,
      },
      {
        id: "conditional-probability",
        moduleRef: "Week 3",
        order: 3,
        weekNumber: 3,
      },
      {
        id: "random-variables",
        moduleRef: "Week 4",
        order: 4,
        weekNumber: 4,
      },
      {
        id: "binomial-models",
        moduleRef: "Week 5",
        order: 5,
        weekNumber: 5,
      },
      {
        id: "normal-standardization",
        moduleRef: "Week 9",
        order: 9,
        weekNumber: 9,
      },
    ])
    expect(demoTopics.every((topic) => topic.active)).toBe(true)
    expect(new Set(demoTopics.map((topic) => topic.order)).size).toBe(
      demoTopics.length,
    )
  })

  it("maps existing approved questions to syllabus topics without deleting them", () => {
    expect(demoQuestions.map((question) => question.id)).toEqual(
      expect.arrayContaining([
        "demo-basic-probability-colored-tickets",
        "demo-counting-cafe-codes",
        "demo-conditional-spinner-coin",
        "demo-random-variable-bulb-sample",
        "demo-expected-value-delivery-credit",
        "dice-sum-eight",
        "five-question-quiz",
        "exam-z-score",
      ]),
    )
    expect(
      demoQuestions.find(
        (question) =>
          question.id === "demo-basic-probability-colored-tickets",
      )?.topicId,
    ).toBe(INTRO_TOPIC_ID)
    expect(
      demoQuestions.find(
        (question) => question.id === "demo-counting-cafe-codes",
      )?.topicId,
    ).toBe(AXIOMS_TOPIC_ID)
    expect(demoQuestions.every(isStudentFacingQuestion)).toBe(true)
  })

  it("creates exactly 20 review-gated questions for each new topic", () => {
    expect(syllabusCandidates).toHaveLength(40)

    for (const topicId of [INTRO_TOPIC_ID, AXIOMS_TOPIC_ID]) {
      expect(
        syllabusCandidates.filter(
          (candidate) => candidate.topicId === topicId,
        ),
      ).toHaveLength(20)
    }

    expect(
      syllabusCandidates.every(
        (candidate) =>
          candidate.review.status === "needs_review" &&
          candidate.source.trustLevel === "generated_unverified" &&
          !isStudentFacingQuestion(candidate),
      ),
    ).toBe(true)
    expect(
      syllabusCandidates.every((candidate) =>
        reviewCandidates.some((review) => review.id === candidate.id),
      ),
    ).toBe(true)
  })

  it("creates exactly 20 original review drafts for each of the next three topics", () => {
    expect(nextSyllabusCandidates).toHaveLength(60)

    for (const topicId of NEXT_TOPIC_IDS) {
      const topic = demoTopics.find((candidate) => candidate.id === topicId)
      const candidates = nextSyllabusCandidates.filter(
        (candidate) => candidate.topicId === topicId,
      )

      expect(candidates).toHaveLength(20)
      expect(
        candidates.every((candidate) => candidate.topic === topic?.title),
      ).toBe(true)
    }

    expect(new Set(nextSyllabusCandidates.map(({ id }) => id))).toHaveProperty(
      "size",
      60,
    )
    expect(
      nextSyllabusCandidates.every(
        (candidate) =>
          candidate.review.status === "needs_review" &&
          candidate.source.trustLevel === "generated_unverified" &&
          candidate.source.sourceType === "pattern_derived_original" &&
          candidate.source.visibility === "public" &&
          Boolean(candidate.patternSource) &&
          Boolean(candidate.source.originalityNote) &&
          candidate.answer.acceptedAnswers.length > 0 &&
          candidate.hints.length >= 2 &&
          candidate.solutionSteps.length >= 3 &&
          candidate.misconceptions.length > 0 &&
          !isStudentFacingQuestion(candidate),
      ),
    ).toBe(true)
    expect(
      nextSyllabusCandidates.every((candidate) =>
        reviewCandidates.some((review) => review.id === candidate.id),
      ),
    ).toBe(true)
    expect(JSON.stringify(nextSyllabusCandidates)).not.toMatch(
      /patternIds|sourceItemIds|privatePhraseHashes|sourceNumberSets|sourceStoryFamilies|rawText|extractedText/i,
    )
  })
})
