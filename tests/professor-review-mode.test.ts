import { describe, expect, it } from "vitest"

import {
  professorReviewProgress,
  sortProfessorReviewCandidates,
} from "@/lib/tutor/professor-review-mode"
import type { ReviewCandidate } from "@/lib/types"

describe("professor-friendly review mode", () => {
  it("prioritizes generated questions needing review", () => {
    const sorted = sortProfessorReviewCandidates([
      candidate({
        id: "approved-generated",
        reviewStatus: "approved",
        sourceType: "generated_original",
      }),
      candidate({
        id: "needs-review-original-demo",
        reviewStatus: "needs_review",
        sourceType: "original_demo",
      }),
      candidate({
        id: "needs-review-pattern",
        reviewPriority: "priority",
        reviewStatus: "needs_review",
        sourceType: "pattern_derived_original",
      }),
      candidate({
        id: "needs-review-generated",
        reviewStatus: "needs_review",
        sourceType: "generated_original",
      }),
    ])

    expect(sorted.map((item) => item.id).slice(0, 2)).toEqual([
      "needs-review-pattern",
      "needs-review-generated",
    ])
  })

  it("reports reviewed count and remaining priority items", () => {
    const progress = professorReviewProgress(
      [
        candidate({
          id: "priority-one",
          reviewPriority: "priority",
          reviewStatus: "needs_review",
          sourceType: "generated_original",
        }),
        candidate({
          id: "normal-one",
          reviewStatus: "needs_review",
          sourceType: "pattern_derived_original",
        }),
      ],
      3,
    )

    expect(progress).toEqual({
      remainingPriorityItems: 1,
      reviewedCount: 3,
      totalCount: 5,
    })
  })
})

function candidate({
  id,
  reviewPriority = "normal",
  reviewStatus,
  sourceType,
}: {
  id: string
  reviewPriority?: ReviewCandidate["review"]["reviewPriority"]
  reviewStatus: ReviewCandidate["review"]["status"]
  sourceType: ReviewCandidate["source"]["sourceType"]
}): ReviewCandidate {
  return {
    answer: {
      acceptedAnswers: ["1/2"],
      explanation: "Original answer explanation.",
    },
    difficulty: "foundational",
    hints: ["Use the definition."],
    id,
    misconceptions: [
      {
        feedback: "Check the relevant denominator.",
        id: "wrong-denominator",
        matchTerms: ["wrong denominator"],
      },
    ],
    patternSource: "abstract test pattern",
    prompt: "Original generated review prompt?",
    review: {
      reviewPriority,
      status: reviewStatus,
    },
    solutionSteps: ["Compute the requested probability."],
    source: {
      originalityNote: "Original generated item.",
      sourceType,
      trustLevel:
        reviewStatus === "approved"
          ? "professor_approved"
          : "generated_unverified",
      visibility: "public",
    },
    title: id,
    topicId: "basic-probability",
  }
}
