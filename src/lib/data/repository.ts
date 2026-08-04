import "server-only";

import type {
  AdministratorAuthorization,
  AnalyticsAuthorization,
  ProfessorReviewAuthorization,
} from "@/lib/auth/authorization";
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
} from "@/lib/types";
import type { OperatingMode } from "@/lib/runtime/operating-mode";

export type ReviewAction =
  | "approve"
  | "needs_edit"
  | "reject"
  | "request_regeneration";

export type ReviewQueueFilters = {
  difficulty?: Difficulty;
  reviewPriority?: ReviewPriority;
  status?: ReviewStatus;
  topicId?: string;
};

export type ReviewCandidateUpdate = {
  action?: ReviewAction;
  candidateIds: string[];
  difficulty?: Difficulty;
  notes?: string;
  reviewPriority?: ReviewPriority;
  topicId?: string;
};

export type ReviewCandidateImport = {
  candidates: ReviewCandidate[];
  imported: boolean;
  message: string;
  mode: "database" | "demo";
  nonDurable: boolean;
};

export type AdminQuestionFilters = {
  generatedOnly?: boolean;
  sourceType?: SourceType;
  status?: ReviewStatus;
  topicId?: string;
};

export type AdminQuestionUpdate = {
  action: ReviewAction | "mark_needs_review";
  questionIds: string[];
};

export type AdminQuestionDetailAction =
  | "approve_generated"
  | "reject_generated"
  | "request_regeneration";

export type AdminQuestionMisconceptionInput = {
  feedback: string;
  id: string;
  matchTerms: string[];
};

export type AdminQuestionDetailUpdate = {
  action?: AdminQuestionDetailAction;
  difficulty?: Difficulty;
  hints?: string[];
  misconceptions?: AdminQuestionMisconceptionInput[];
  reviewerNotes?: string;
  reviewStatus?: ReviewStatus;
  topicId?: string;
  trustLevel?: TutorQuestion["source"]["trustLevel"];
};

export type AdminQuestionRegenerationInput = {
  keepPattern?: boolean;
  mode?: "deterministic";
  questionId: string;
};

export type AdminQuestionRegenerationResult = {
  mode: "deterministic";
  original: AdminQuestion;
  preservedOriginal: boolean;
  regenerated: AdminQuestion;
};

export type QuestionCounts = {
  byTopic: Record<string, number>;
  total: number;
};

export type DataRepositoryMetadata = {
  databaseConfigured: boolean;
  demoFallbackEnabled: boolean;
  mode: "database" | "demo";
  operatingMode: OperatingMode;
  reason: string;
  source: "demo-json" | "postgres";
};

export type ContentRepository = {
  getAdminQuestions(
    authorization: AdministratorAuthorization,
    filters?: AdminQuestionFilters,
  ): Promise<AdminQuestion[]>;
  getQuestionById(questionId: string): Promise<TutorQuestion | undefined>;
  getApprovedQuestionById(
    questionId: string,
  ): Promise<TutorQuestion | undefined>;
  getApprovedQuestions(): Promise<TutorQuestion[]>;
  getQuestionCounts(): Promise<QuestionCounts>;
  getProfessorPracticeAnalytics(
    authorization: AnalyticsAuthorization,
  ): Promise<ProfessorPracticeAnalytics>;
  getRetrievalChunks(): Promise<RetrievalChunk[]>;
  getReviewQueue(
    authorization:
      | ProfessorReviewAuthorization
      | AnalyticsAuthorization
      | AdministratorAuthorization,
    filters?: ReviewQueueFilters,
  ): Promise<ReviewCandidate[]>;
  getTopics(): Promise<Topic[]>;
  importReviewCandidates(
    authorization: ProfessorReviewAuthorization,
    candidates: ReviewCandidate[],
  ): Promise<ReviewCandidateImport>;
  listQuestions(): Promise<TutorQuestion[]>;
  listQuestionsByTopic(topicId: string): Promise<TutorQuestion[]>;
  listTopics(): Promise<Topic[]>;
  regenerateAdminQuestion(
    authorization: AdministratorAuthorization,
    input: AdminQuestionRegenerationInput,
  ): Promise<AdminQuestionRegenerationResult | undefined>;
  updateAdminQuestionDetail(
    authorization: AdministratorAuthorization,
    questionId: string,
    input: AdminQuestionDetailUpdate,
  ): Promise<AdminQuestion | undefined>;
  updateReviewCandidates(
    authorization: ProfessorReviewAuthorization,
    input: ReviewCandidateUpdate,
  ): Promise<ReviewCandidate[]>;
  updateAdminQuestions(
    authorization: AdministratorAuthorization,
    input: AdminQuestionUpdate,
  ): Promise<AdminQuestion[]>;
  updateReviewCandidateStatus(
    authorization: ProfessorReviewAuthorization,
    candidateId: string,
    action: ReviewAction,
  ): Promise<ReviewCandidate | undefined>;
};

export function reviewStatusForAction(action: ReviewAction): ReviewStatus {
  if (action === "approve") {
    return "approved";
  }

  if (action === "request_regeneration") {
    return "needs_regeneration";
  }

  return action === "reject" ? "rejected" : action;
}
