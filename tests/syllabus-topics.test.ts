import { describe, expect, it } from "vitest"

import followingSyllabusReviewCandidateData from "../data/demo/following-syllabus-review-candidates.json"
import nextSyllabusReviewCandidateData from "../data/demo/next-syllabus-review-candidates.json"
import nextUncoveredSyllabusReviewCandidateData from "../data/demo/next-uncovered-syllabus-review-candidates.json"
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
const FOLLOWING_TOPIC_IDS = [
  "continuous-random-variables",
  "normal-standardization",
  "moment-generating-functions-joint-distributions",
] as const
const NEXT_UNCOVERED_TOPIC_IDS = [
  "independent-random-variables-sums-correlation",
  "chebyshev-law-large-numbers",
  "central-limit-theorem",
] as const
const followingSyllabusCandidates =
  followingSyllabusReviewCandidateData as unknown as ReviewCandidate[]
const nextUncoveredSyllabusCandidates =
  nextUncoveredSyllabusReviewCandidateData as unknown as ReviewCandidate[]
const syllabusCandidates =
  syllabusReviewCandidateData as unknown as ReviewCandidate[]
const nextSyllabusCandidates =
  nextSyllabusReviewCandidateData as unknown as ReviewCandidate[]

const probabilityTopics = demoTopics.filter(
  (topic) => topic.courseId === "probability-statistics",
)
const calculusTopics = demoTopics.filter(
  (topic) => topic.courseId === "calculus-1",
)

describe("syllabus topic catalog", () => {
  it("keeps active topics in deterministic syllabus order", () => {
    expect(
      probabilityTopics.map(({ id, moduleRef, order, weekNumber }) => ({
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
        id: "continuous-random-variables",
        moduleRef: "Week 8",
        order: 8,
        weekNumber: 8,
      },
      {
        id: "normal-standardization",
        moduleRef: "Week 9",
        order: 9,
        weekNumber: 9,
      },
      {
        id: "moment-generating-functions-joint-distributions",
        moduleRef: "Week 10",
        order: 10,
        weekNumber: 10,
      },
      {
        id: "independent-random-variables-sums-correlation",
        moduleRef: "Week 11",
        order: 11,
        weekNumber: 11,
      },
      {
        id: "chebyshev-law-large-numbers",
        moduleRef: "Week 12",
        order: 12,
        weekNumber: 12,
      },
      {
        id: "central-limit-theorem",
        moduleRef: "Week 13",
        order: 13,
        weekNumber: 13,
      },
    ])
    expect(demoTopics.every((topic) => topic.active)).toBe(true)
    for (const topics of [probabilityTopics, calculusTopics]) {
      expect(new Set(topics.map((topic) => topic.order)).size).toBe(
        topics.length,
      )
    }
    expect(probabilityTopics.length + calculusTopics.length).toBe(
      demoTopics.length,
    )
  })

  it("follows the Calculus I schedule, one topic per line, in week order", () => {
    expect(
      calculusTopics.map(({ id, moduleRef, order, weekNumber }) => [
        order,
        weekNumber,
        id,
        moduleRef,
      ]),
    ).toEqual([
      [1, 1, "calc1-precalculus-review", "Weeks 1–2 · §1.1–1.5"],
      [2, 3, "calc1-tangents-rates-of-change", "Week 3 · §2.1"],
      [3, 3, "calc1-limits-limit-laws", "Week 3 · §2.2, 2.3"],
      [4, 4, "calc1-continuity", "Week 4 · §2.5"],
      [5, 4, "calc1-limits-involving-infinity", "Week 4 · §2.6"],
      [6, 5, "calc1-derivatives-rates-of-change", "Week 5 · §2.7"],
      [7, 5, "calc1-derivative-as-function", "Week 5 · §2.8"],
      [8, 6, "calc1-derivatives-polynomial-exponential-trig", "Week 6 · §3.1, 3.3"],
      [9, 7, "calc1-product-quotient-chain-rules", "Week 7 · §3.2, 3.4"],
      [10, 8, "calc1-implicit-differentiation", "Week 8 · §3.5"],
      [11, 8, "calc1-derivatives-inverse-log-inverse-trig", "Week 8 · §3.6"],
      [12, 9, "calc1-related-rates-linear-approximation", "Week 9 · §3.9, 3.10"],
      [13, 10, "calc1-increasing-decreasing-extreme-values", "Week 10 · §4.1, 4.2, 4.3"],
      [14, 11, "calc1-mean-value-theorem-concavity", "Week 11 · §4.3, 4.4"],
      [15, 12, "calc1-lhopitals-rule-curve-sketching", "Week 12 · §4.5, 4.6"],
      [16, 13, "calc1-antiderivatives", "Week 13 · §4.8"],
      [17, 14, "calc1-areas-distances-definite-integrals", "Week 14 · §5.1, 5.3"],
      [18, 15, "calc1-fundamental-theorem-indefinite-integrals", "Week 15 · §5.4, 5.5"],
    ])
    const probabilityIds = new Set(probabilityTopics.map((topic) => topic.id))
    expect(calculusTopics.some((topic) => probabilityIds.has(topic.id))).toBe(
      false,
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
          candidate.source.sourceType === "generated_original" &&
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

  it("creates a separate 20-draft batch for each of the following three content topics", () => {
    expect(followingSyllabusCandidates).toHaveLength(60)

    for (const topicId of FOLLOWING_TOPIC_IDS) {
      const topic = demoTopics.find((candidate) => candidate.id === topicId)
      const candidates = followingSyllabusCandidates.filter(
        (candidate) => candidate.topicId === topicId,
      )

      expect(candidates).toHaveLength(20)
      expect(
        candidates.every((candidate) => candidate.topic === topic?.title),
      ).toBe(true)
    }

    const earlierIds = new Set(
      nextSyllabusCandidates.map((candidate) => candidate.id),
    )
    expect(
      followingSyllabusCandidates.every(
        (candidate) =>
          !earlierIds.has(candidate.id) &&
          candidate.id.startsWith("generated-following-") &&
          candidate.review.status === "needs_review" &&
          candidate.source.trustLevel === "generated_unverified" &&
          candidate.source.sourceType === "generated_original" &&
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
      followingSyllabusCandidates.every((candidate) =>
        reviewCandidates.some((review) => review.id === candidate.id),
      ),
    ).toBe(true)
    expect(JSON.stringify(followingSyllabusCandidates)).not.toMatch(
      /patternIds|sourceItemIds|privatePhraseHashes|sourceNumberSets|sourceStoryFamilies|rawText|extractedText|locator/i,
    )
  })

  it("creates a separate 20-draft batch for each next uncovered syllabus topic", () => {
    expect(nextUncoveredSyllabusCandidates).toHaveLength(60)

    for (const topicId of NEXT_UNCOVERED_TOPIC_IDS) {
      const topic = demoTopics.find((candidate) => candidate.id === topicId)
      const candidates = nextUncoveredSyllabusCandidates.filter(
        (candidate) => candidate.topicId === topicId,
      )

      expect(candidates).toHaveLength(20)
      expect(
        candidates.every((candidate) => candidate.topic === topic?.title),
      ).toBe(true)
    }

    const earlierIds = new Set(
      [
        ...syllabusCandidates,
        ...nextSyllabusCandidates,
        ...followingSyllabusCandidates,
      ].map((candidate) => candidate.id),
    )
    const earlierPrompts = new Set(
      [
        ...syllabusCandidates,
        ...nextSyllabusCandidates,
        ...followingSyllabusCandidates,
      ].map((candidate) => candidate.prompt),
    )
    expect(
      nextUncoveredSyllabusCandidates.every(
        (candidate) =>
          !earlierIds.has(candidate.id) &&
          !earlierPrompts.has(candidate.prompt) &&
          candidate.id.startsWith("generated-uncovered-") &&
          candidate.review.status === "needs_review" &&
          candidate.source.trustLevel === "generated_unverified" &&
          candidate.source.sourceType === "generated_original" &&
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
      nextUncoveredSyllabusCandidates.every((candidate) =>
        reviewCandidates.some((review) => review.id === candidate.id),
      ),
    ).toBe(true)
    expect(JSON.stringify(nextUncoveredSyllabusCandidates)).not.toMatch(
      /patternIds|sourceItemIds|privatePhraseHashes|sourceNumberSets|sourceStoryFamilies|rawText|extractedText|locator/i,
    )
  })
})
