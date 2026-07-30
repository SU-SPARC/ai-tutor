import "server-only"

import type {
  AdminQuestion,
  Difficulty,
  ProfessorPracticeAnalytics,
  ReviewCandidate,
  ReviewPriority,
  ReviewStatus,
  RetrievalChunk,
  SourceType,
  Topic,
  TutorQuestion,
} from "@/lib/types"
import type { OperatingMode } from "@/lib/runtime/operating-mode"

export type ReviewAction =
  | "approve"
  | "needs_edit"
  | "reject"
  | "request_regeneration"

export type ReviewQueueFilters = {
  difficulty?: Difficulty
  reviewPriority?: ReviewPriority
  status?: ReviewStatus
  topicId?: string
}

export type ReviewCandidateUpdate = {
  action?: ReviewAction
  candidateIds: string[]
  difficulty?: Difficulty
  notes?: string
  reviewPriority?: ReviewPriority
  reviewedBy?: string
  topicId?: string
}

export type ReviewCandidateImport = {
  candidates: ReviewCandidate[]
  imported: boolean
  message: string
  mode: "database" | "demo"
  nonDurable: boolean
}

export type AdminQuestionFilters = {
  generatedOnly?: boolean
  sourceType?: SourceType
  status?: ReviewStatus
  topicId?: string
}

export type AdminQuestionUpdate = {
  action: ReviewAction | "mark_needs_review"
  questionIds: string[]
  reviewedBy?: string
}

export type AdminQuestionDetailAction =
  | "approve_generated"
  | "reject_generated"
  | "request_regeneration"

export type AdminQuestionMisconceptionInput = {
  feedback: string
  id: string
  matchTerms: string[]
}

export type AdminQuestionDetailUpdate = {
  action?: AdminQuestionDetailAction
  difficulty?: Difficulty
  hints?: string[]
  misconceptions?: AdminQuestionMisconceptionInput[]
  reviewedBy?: string
  reviewerNotes?: string
  reviewStatus?: ReviewStatus
  topicId?: string
  trustLevel?: TutorQuestion["source"]["trustLevel"]
}

export type AdminQuestionRegenerationInput = {
  keepPattern?: boolean
  mode?: "deterministic"
  questionId: string
  reviewedBy?: string
}

export type AdminQuestionRegenerationResult = {
  mode: "deterministic"
  original: AdminQuestion
  preservedOriginal: boolean
  regenerated: AdminQuestion
}

export type QuestionCounts = {
  byTopic: Record<string, number>
  total: number
}

export type DataRepositoryMetadata = {
  databaseConfigured: boolean
  demoFallbackEnabled: boolean
  mode: "database" | "demo"
  operatingMode: OperatingMode
  reason: string
  source: "demo-json" | "postgres"
}

export type ContentRepository = {
  getAdminQuestions(filters?: AdminQuestionFilters): Promise<AdminQuestion[]>
  getQuestionById(questionId: string): Promise<TutorQuestion | undefined>
  getApprovedQuestionById(questionId: string): Promise<TutorQuestion | undefined>
  getApprovedQuestions(): Promise<TutorQuestion[]>
  getQuestionCounts(): Promise<QuestionCounts>
  getProfessorPracticeAnalytics(): Promise<ProfessorPracticeAnalytics>
  getRetrievalChunks(): Promise<RetrievalChunk[]>
  getReviewQueue(filters?: ReviewQueueFilters): Promise<ReviewCandidate[]>
  getTopics(): Promise<Topic[]>
  importReviewCandidates(
    candidates: ReviewCandidate[],
    reviewedBy?: string,
  ): Promise<ReviewCandidateImport>
  listQuestions(): Promise<TutorQuestion[]>
  listQuestionsByTopic(topicId: string): Promise<TutorQuestion[]>
  listTopics(): Promise<Topic[]>
  regenerateAdminQuestion(
    input: AdminQuestionRegenerationInput,
  ): Promise<AdminQuestionRegenerationResult | undefined>
  updateAdminQuestionDetail(
    questionId: string,
    input: AdminQuestionDetailUpdate,
  ): Promise<AdminQuestion | undefined>
  updateReviewCandidates(
    input: ReviewCandidateUpdate,
  ): Promise<ReviewCandidate[]>
  updateAdminQuestions(input: AdminQuestionUpdate): Promise<AdminQuestion[]>
  updateReviewCandidateStatus(
    candidateId: string,
    action: ReviewAction,
    reviewedBy?: string,
  ): Promise<ReviewCandidate | undefined>
}

export function reviewStatusForAction(action: ReviewAction): ReviewStatus {
  if (action === "approve") {
    return "approved"
  }

  if (action === "request_regeneration") {
    return "needs_regeneration"
  }

  return action === "reject" ? "rejected" : action
}
