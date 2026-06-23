import "server-only"

import {
  demoQuestions,
  demoTopics,
  retrievalChunks,
  reviewCandidates,
} from "@/lib/data/demo-data"
import type { ReviewCandidate, ReviewStatus } from "@/lib/types"

let reviewQueue: ReviewCandidate[] = reviewCandidates.map((candidate) => ({
  ...candidate,
}))

export async function getTopics() {
  return demoTopics
}

export async function getApprovedQuestions() {
  return demoQuestions
}

export function getApprovedQuestionById(questionId: string) {
  return demoQuestions.find((question) => question.id === questionId)
}

export function getRetrievalChunks() {
  return retrievalChunks
}

export async function getReviewQueue() {
  return reviewQueue
}

export function updateReviewCandidateStatus(
  candidateId: string,
  action: "approve" | "reject",
) {
  const status: ReviewStatus = action === "approve" ? "approved" : "rejected"
  let updated: ReviewCandidate | undefined

  reviewQueue = reviewQueue.map((candidate) => {
    if (candidate.id !== candidateId) {
      return candidate
    }

    updated = {
      ...candidate,
      status,
    }

    return updated
  })

  return updated
}

export function resetReviewQueueForTests() {
  reviewQueue = reviewCandidates.map((candidate) => ({ ...candidate }))
}
