import "server-only"

import type {
  ReviewCandidate,
  ReviewStatus,
  RetrievalChunk,
  Topic,
  TutorMode,
  TutorQuestion,
  TutorResponse,
  TutorSource,
  TutorVerdict,
  UsageSummary,
} from "@/lib/types"

export type ReviewAction = "approve" | "reject"

export type QuestionCounts = {
  byTopic: Record<string, number>
  total: number
}

export type DataRepositoryMetadata = {
  databaseConfigured: boolean
  demoFallbackEnabled: boolean
  mode: "database" | "demo"
  reason: string
  source: "demo-json" | "postgres"
}

export type ContentRepository = {
  getQuestionById(questionId: string): Promise<TutorQuestion | undefined>
  getApprovedQuestionById(questionId: string): Promise<TutorQuestion | undefined>
  getApprovedQuestions(): Promise<TutorQuestion[]>
  getQuestionCounts(): Promise<QuestionCounts>
  getRetrievalChunks(): Promise<RetrievalChunk[]>
  getReviewQueue(): Promise<ReviewCandidate[]>
  getTopics(): Promise<Topic[]>
  listQuestions(): Promise<TutorQuestion[]>
  listQuestionsByTopic(topicId: string): Promise<TutorQuestion[]>
  listTopics(): Promise<Topic[]>
  updateReviewCandidateStatus(
    candidateId: string,
    action: ReviewAction,
    reviewedBy?: string,
  ): Promise<ReviewCandidate | undefined>
}

export type TutorAttemptInput = {
  answerPreview?: string
  estimatedTokens: number
  mode?: TutorMode
  questionId?: string
  sessionId: string
  source: TutorSource
  topicId?: string
  verdict?: TutorVerdict
}

export type TutorCacheRecord = {
  expiresAt: Date
  requestHash: string
  response: TutorResponse
}

export type UsageRepository = {
  canUseLlmFallback(
    sessionId: string,
    estimatedTokens: number,
  ): Promise<{ allowed: boolean; reason: string }>
  getGlobalUsageSummary(): Promise<UsageSummary>
  getLlmFallbacksRemaining(sessionId: string): Promise<number>
  getSessionUsage(sessionId: string): Promise<UsageSummary>
  readTutorCache(requestHash: string): Promise<TutorCacheRecord | undefined>
  recordTutorAttempt(input: TutorAttemptInput): Promise<void>
  recordTutorInteraction(
    sessionId: string,
    estimatedTokens: number,
    source: TutorSource,
  ): Promise<void>
  writeTutorCache(record: TutorCacheRecord): Promise<void>
}

export function reviewStatusForAction(action: ReviewAction): ReviewStatus {
  return action === "approve" ? "approved" : "rejected"
}
