import "server-only"

import {
  demoQuestions,
  demoTopics,
  retrievalChunks,
  reviewCandidates,
} from "@/lib/data/demo-data"
import {
  isApprovedPublicTrustedContent,
  type RetrievalChunk,
  type ReviewCandidate,
  type ReviewStatus,
  type TutorQuestion,
} from "@/lib/types"

let reviewQueue: ReviewCandidate[] = reviewCandidates.map(cloneReviewCandidate)

export async function getTopics() {
  return demoTopics
}

export async function getApprovedQuestions() {
  return demoQuestions.filter(isStudentFacingQuestion)
}

export function getApprovedQuestionById(questionId: string) {
  return demoQuestions.find(
    (question) => question.id === questionId && isStudentFacingQuestion(question),
  )
}

export function getRetrievalChunks() {
  return retrievalChunks.filter(isStudentFacingRetrievalChunk)
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
      review: {
        ...candidate.review,
        status,
      },
    }

    return updated
  })

  return updated
}

export function resetReviewQueueForTests() {
  reviewQueue = reviewCandidates.map(cloneReviewCandidate)
}

export function isStudentFacingQuestion(question: TutorQuestion) {
  return isApprovedPublicTrustedContent(question)
}

export function isStudentFacingRetrievalChunk(chunk: RetrievalChunk) {
  return isApprovedPublicTrustedContent(chunk)
}

function cloneReviewCandidate(candidate: ReviewCandidate): ReviewCandidate {
  return {
    ...candidate,
    answer: {
      ...candidate.answer,
      acceptedAnswers: [...candidate.answer.acceptedAnswers],
    },
    hints: [...candidate.hints],
    misconceptions: candidate.misconceptions.map((misconception) => ({
      ...misconception,
      matchTerms: [...misconception.matchTerms],
    })),
    review: { ...candidate.review },
    solutionSteps: [...candidate.solutionSteps],
    source: {
      ...candidate.source,
      patternIds: candidate.source.patternIds
        ? [...candidate.source.patternIds]
        : undefined,
    },
  }
}
