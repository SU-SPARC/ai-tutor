import type {
  ProfessorTopicReviewProgress,
  ReviewCandidate,
  ReviewStatus,
} from "@/lib/types"

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
      (candidate) =>
        (candidate.review.reviewPriority ?? "normal") === "priority",
    ).length,
    reviewedCount,
    totalCount: reviewedCount + candidates.length,
  }
}

export function buildProfessorTopicReviewProgress(
  topicId: string,
  candidates: Array<Pick<ReviewCandidate, "review">>,
): ProfessorTopicReviewProgress {
  const counts = candidates.reduce(
    (current, candidate) => {
      current[candidate.review.status] += 1
      return current
    },
    {
      approved: 0,
      needs_edit: 0,
      needs_regeneration: 0,
      needs_review: 0,
      rejected: 0,
    } satisfies Record<ReviewStatus, number>,
  )

  return {
    approved: counts.approved,
    needsReview: counts.needs_review,
    rejected: counts.rejected,
    remaining:
      counts.needs_review + counts.needs_edit + counts.needs_regeneration,
    topicId,
    totalDrafts: candidates.length,
  }
}

export function advanceProfessorTopicReviewProgress(
  progress: ProfessorTopicReviewProgress,
  nextStatus: ReviewStatus,
): ProfessorTopicReviewProgress {
  if (progress.needsReview === 0) {
    return progress
  }

  return {
    ...progress,
    approved: progress.approved + (nextStatus === "approved" ? 1 : 0),
    needsReview: progress.needsReview - 1,
    rejected: progress.rejected + (nextStatus === "rejected" ? 1 : 0),
    remaining:
      nextStatus === "approved" || nextStatus === "rejected"
        ? Math.max(0, progress.remaining - 1)
        : progress.remaining,
  }
}

export function professorReviewQueuePath(topicId: string) {
  const params = new URLSearchParams({
    status: "needs_review",
    topicId,
  })
  return `/api/professor/review?${params.toString()}`
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
