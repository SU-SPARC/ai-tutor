import "server-only"

import {
  demoQuestions,
  demoTopics,
  retrievalChunks,
  reviewCandidates,
} from "@/lib/data/demo-data"
import {
  reviewStatusForAction,
  type ContentRepository,
  type QuestionCounts,
  type ReviewAction,
} from "@/lib/data/repository"
import {
  isApprovedPublicTrustedContent,
  type RetrievalChunk,
  type ReviewCandidate,
  type TutorQuestion,
} from "@/lib/types"

let reviewQueue: ReviewCandidate[] = reviewCandidates.map(cloneReviewCandidate)

export const demoContentRepository: ContentRepository = {
  async getQuestionById(questionId) {
    return listDemoQuestions().find((question) => question.id === questionId)
  },

  async getApprovedQuestionById(questionId) {
    return this.getQuestionById(questionId)
  },

  async getApprovedQuestions() {
    return this.listQuestions()
  },

  async getQuestionCounts() {
    return getQuestionCounts(listDemoQuestions())
  },

  async getRetrievalChunks() {
    return retrievalChunks.filter(isStudentFacingRetrievalChunk)
  },

  async getReviewQueue() {
    return reviewQueue
  },

  async getTopics() {
    return this.listTopics()
  },

  async listQuestions() {
    return listDemoQuestions()
  },

  async listQuestionsByTopic(topicId) {
    return listDemoQuestions().filter((question) => question.topicId === topicId)
  },

  async listTopics() {
    return demoTopics
  },

  async updateReviewCandidateStatus(
    candidateId: string,
    action: ReviewAction,
  ) {
    const status = reviewStatusForAction(action)
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
  },
}

function listDemoQuestions() {
  return demoQuestions.filter(isStudentFacingQuestion)
}

function getQuestionCounts(questions: TutorQuestion[]): QuestionCounts {
  return questions.reduce<QuestionCounts>(
    (counts, question) => {
      counts.total += 1
      counts.byTopic[question.topicId] = (counts.byTopic[question.topicId] ?? 0) + 1
      return counts
    },
    {
      byTopic: {},
      total: 0,
    },
  )
}

export function resetDemoReviewQueueForTests() {
  reviewQueue = reviewCandidates.map(cloneReviewCandidate)
}

export function isStudentFacingQuestion(question: TutorQuestion) {
  return isApprovedPublicTrustedContent(question)
}

export function isStudentFacingRetrievalChunk(chunk: RetrievalChunk) {
  return (
    isApprovedPublicTrustedContent(chunk) ||
    (chunk.review.status === "approved" &&
      chunk.source.visibility === "private" &&
      chunk.source.trustLevel === "private_reference" &&
      chunk.source.sourceType === "private_reference_pattern" &&
      Boolean(chunk.llmSafeSummary?.trim()) &&
      chunk.body === chunk.llmSafeSummary)
  )
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
