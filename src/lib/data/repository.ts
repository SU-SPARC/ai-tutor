import "server-only";

import type {
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
import type { PlatformCourse } from "@/lib/course-catalog";

/**
 * Narrows a read to one course. A course owns topics, and a question's course is
 * its topic's course, so this never needs a column on the question. Omitting
 * `courseId` reads across every course, which deep links and cross-course
 * tools (for example, resolving which course a question belongs to) rely on.
 */
export type CourseScope = {
  courseId?: string;
};

export type ReviewAction =
  | "approve"
  | "needs_edit"
  | "reject"
  | "request_regeneration";

export type ReviewQueueFilters = {
  courseId?: string;
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
  courseId?: string;
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
  idempotencyKey?: string;
  keepPattern?: boolean;
  mode?: "deterministic";
  questionId: string;
  requestId?: string;
  supersedeReason?: string;
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
    authorization: ProfessorReviewAuthorization,
    filters?: AdminQuestionFilters,
  ): Promise<AdminQuestion[]>;
  getQuestionById(questionId: string): Promise<TutorQuestion | undefined>;
  getApprovedQuestionById(
    questionId: string,
  ): Promise<TutorQuestion | undefined>;
  getApprovedQuestions(scope?: CourseScope): Promise<TutorQuestion[]>;
  getQuestionCounts(scope?: CourseScope): Promise<QuestionCounts>;
  getProfessorPracticeAnalytics(
    authorization: AnalyticsAuthorization,
    scope?: CourseScope,
  ): Promise<ProfessorPracticeAnalytics>;
  getRetrievalChunks(scope?: CourseScope): Promise<RetrievalChunk[]>;
  getReviewQueue(
    authorization: ProfessorReviewAuthorization | AnalyticsAuthorization,
    filters?: ReviewQueueFilters,
  ): Promise<ReviewCandidate[]>;
  getTopics(scope?: CourseScope): Promise<Topic[]>;
  importReviewCandidates(
    authorization: ProfessorReviewAuthorization,
    candidates: ReviewCandidate[],
  ): Promise<ReviewCandidateImport>;
  listCourses(): Promise<PlatformCourse[]>;
  /**
   * The course of every topic, including topics not currently shown to
   * students. Professor tools use it to scope their own lists by course.
   */
  listTopicCourses(): Promise<Array<{ courseId: string; topicId: string }>>;
  listQuestions(scope?: CourseScope): Promise<TutorQuestion[]>;
  listQuestionsByTopic(topicId: string): Promise<TutorQuestion[]>;
  listTopics(scope?: CourseScope): Promise<Topic[]>;
  regenerateAdminQuestion(
    authorization: ProfessorReviewAuthorization,
    input: AdminQuestionRegenerationInput,
  ): Promise<AdminQuestionRegenerationResult | undefined>;
  updateAdminQuestionDetail(
    authorization: ProfessorReviewAuthorization,
    questionId: string,
    input: AdminQuestionDetailUpdate,
  ): Promise<AdminQuestion | undefined>;
  updateReviewCandidates(
    authorization: ProfessorReviewAuthorization,
    input: ReviewCandidateUpdate,
  ): Promise<ReviewCandidate[]>;
  updateAdminQuestions(
    authorization: ProfessorReviewAuthorization,
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
