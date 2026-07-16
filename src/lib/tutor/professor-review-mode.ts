import type { ReviewCandidate } from "@/lib/types"

export type ProfessorReviewProgress = {
  remainingPriorityItems: number
  reviewedCount: number
  totalCount: number
}

export function sortProfessorReviewCandidates(
  candidates: ReviewCandidate[],
): ReviewCandidate[] {
  return [...candidates].sort((left, right) => {
    return (
      generatedNeedsReviewRank(right) - generatedNeedsReviewRank(left) ||
      priorityRank(right) - priorityRank(left) ||
      left.topicId.localeCompare(right.topicId) ||
      left.title.localeCompare(right.title)
    )
  })
}

export function professorReviewProgress(
  candidates: ReviewCandidate[],
  reviewedCount: number,
): ProfessorReviewProgress {
  return {
    remainingPriorityItems: candidates.filter(
      (candidate) => (candidate.review.reviewPriority ?? "normal") === "priority",
    ).length,
    reviewedCount,
    totalCount: reviewedCount + candidates.length,
  }
}

function generatedNeedsReviewRank(candidate: ReviewCandidate) {
  return candidate.review.status === "needs_review" &&
    (candidate.source.sourceType === "generated_original" ||
      candidate.source.sourceType === "pattern_derived_original")
    ? 1
    : 0
}

function priorityRank(candidate: ReviewCandidate) {
  return (candidate.review.reviewPriority ?? "normal") === "priority" ? 1 : 0
}
