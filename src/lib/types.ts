import type { AnswerSpec, CheckDetail } from "@/lib/tutor/answer/spec";
export type Difficulty = "foundational" | "intermediate" | "challenge";

export type Visibility = "public" | "private";

export type SourceType =
  | "original_demo"
  | "professor_provided"
  | "generated_original"
  | "pattern_derived_original"
  | "private_reference_pattern";

export type TrustLevel =
  | "public_original"
  | "professor_approved"
  | "course_approved"
  | "generated_unverified"
  | "private_reference";

export type ReviewStatus =
  | "approved"
  | "needs_review"
  | "rejected"
  | "needs_edit"
  | "needs_regeneration";

/**
 * The editorial state of one immutable question version. Publication is a
 * version-level decision: a question may keep one version published while a
 * newer working version moves through review.
 */
export type QuestionVersionState =
  | "draft"
  | "needs_review"
  | "revision_requested"
  | "approved"
  | "published"
  | "unpublished"
  | "rejected";

export type QuestionRecordState = "active" | "archived";

export type StudentContentReleaseState =
  | "published"
  | "unpublished"
  | "archived";

export type StudentContentEffectiveAvailability =
  | "available"
  | "scheduled"
  | "expired"
  | "unpublished"
  | "archived";

export type StudentContentPublicationState =
  | "published"
  | "unpublished"
  | "archived";

export type StudentContentAvailabilityTarget = {
  audienceType: "global";
  availableFrom?: string;
  availableUntil?: string;
  effectiveAvailability: StudentContentEffectiveAvailability;
  id: string;
  publicationState: StudentContentPublicationState;
  releaseState: StudentContentReleaseState;
  targetType: "topic" | "question";
  title: string;
  topicId?: string;
  topicTitle?: string;
};

export type StudentContentAvailabilityEvent = {
  actorDisplayName: string;
  actorUserId: string;
  fromAvailableFrom?: string;
  fromAvailableUntil?: string;
  fromReleaseState: StudentContentReleaseState;
  id: number;
  occurredAt: string;
  reason?: string;
  requestId?: string;
  targetId: string;
  targetType: "topic" | "question";
  toAvailableFrom?: string;
  toAvailableUntil?: string;
  toReleaseState: StudentContentReleaseState;
};

export type StudentContentAvailabilityDashboard = {
  assignmentScope: "global_only";
  auditEvents: StudentContentAvailabilityEvent[];
  mode: "database" | "demo";
  questions: StudentContentAvailabilityTarget[];
  readOnly: boolean;
  readOnlyReason?: string;
  topics: StudentContentAvailabilityTarget[];
};

export const QUESTION_FEEDBACK_CATEGORIES = [
  "answer_appears_incorrect",
  "wording_unclear",
  "hint_unhelpful",
  "solution_step_issue",
  "technical_problem",
  "other",
] as const;

export type QuestionFeedbackCategory =
  (typeof QUESTION_FEEDBACK_CATEGORIES)[number];

export const QUESTION_FEEDBACK_STATUSES = [
  "open",
  "triaged",
  "resolved",
  "dismissed",
] as const;

export type QuestionFeedbackStatus =
  (typeof QUESTION_FEEDBACK_STATUSES)[number];

/**
 * Minimal student-facing confirmation. Session, version, reporter, and free
 * text fields deliberately stay behind the server boundary.
 */
export type QuestionFeedbackReceipt = {
  acknowledgement: string;
  category: QuestionFeedbackCategory;
  createdAt: string;
  id: string;
  status: "open";
};

/**
 * Professor review data omits the raw student identity and its one-way key.
 * The session reference is included only on the professor-authorized surface.
 */
export type ProfessorQuestionFeedbackReport = {
  assignedToDisplayName?: string;
  category: QuestionFeedbackCategory;
  createdAt: string;
  id: string;
  message: string;
  questionId: string;
  questionTitle: string;
  questionVersionId: number;
  questionVersionNumber: number;
  resolutionNotes?: string;
  resolvedAt?: string;
  status: QuestionFeedbackStatus;
  topicId?: string;
  tutorSessionId: string;
  updatedAt: string;
};

export type ProfessorQuestionFeedbackDashboard = {
  counts: Record<QuestionFeedbackStatus, number>;
  mode: "database" | "demo";
  reports: ProfessorQuestionFeedbackReport[];
};

export type QuestionCreationMethod =
  | "manual"
  | "imported"
  | "generated"
  | "regenerated"
  | "rollback_clone";

export type QuestionRevisionMethod = "manual" | "regeneration";

export type QuestionLifecycleAction =
  | "submit"
  | "request_revision"
  | "approve"
  | "reject"
  | "publish"
  | "unpublish"
  | "rollback"
  | "archive"
  | "restore";

export type QuestionLifecycleBatchAction =
  | "request_revision"
  | "reject"
  | "publish";

export type QuestionLifecycleBatchItem = {
  expectedState: QuestionVersionState;
  questionId: string;
  versionId: number;
};

export type QuestionPublicationGateCode =
  | "invalid_answer_spec"
  | "answer_value_unparseable"
  | "tolerance_out_of_bounds"
  | "accepted_answer_inconsistent"
  | "percent_mode_missing"
  | "required_form_unsatisfiable"
  | "categorical_alias_empty"
  | "invalid_syllabus_topic"
  | "missing_question_text"
  | "missing_final_answer"
  | "invalid_answer_schema"
  | "missing_solution_steps"
  | "missing_required_hint"
  | "forbidden_private_source_metadata"
  | "invalid_source_classification"
  | "duplicate_question_id"
  | "invalid_review_state"
  | "deterministic_validation_failed"
  | "professor_approval_missing"
  | "reserved_for_later";

export type QuestionPublicationBlocker = {
  code: QuestionPublicationGateCode;
  message: string;
};

export type QuestionLifecycleBatchFailureCode =
  | "archived"
  | "idempotency_conflict"
  | "invalid_state"
  | "not_found"
  | "not_inspected"
  | "stale_state"
  | "stale_version"
  | "validation_failed";

export type QuestionLifecycleBatchFailure = QuestionLifecycleBatchItem & {
  actualState?: QuestionVersionState;
  code: QuestionLifecycleBatchFailureCode;
  message: string;
  publicationBlockers?: QuestionPublicationBlocker[];
  title?: string;
  topicId?: string;
};

export type QuestionLifecycleBatchPreviewItem =
  | (QuestionLifecycleBatchItem & {
      status: "ready";
    })
  | (QuestionLifecycleBatchFailure & {
      status: "blocked";
    });

export type QuestionLifecycleBatchPreviewResult = {
  action: "publish";
  blockedCount: number;
  items: QuestionLifecycleBatchPreviewItem[];
  readyCount: number;
};

export type QuestionVersionInspectionDto = {
  inspectedAt: string;
  professorDisplayName: string;
  professorUserId: string;
  questionId: string;
  versionId: number;
};

export type QuestionLifecycleBatchResult = {
  action: QuestionLifecycleBatchAction;
  applied: boolean;
  failures: QuestionLifecycleBatchFailure[];
  idempotent: boolean;
  questions: QuestionLifecycleDto[];
  reviewedBy?: QuestionVersionAttribution;
};

export type QuestionLifecycleEventAction =
  | QuestionLifecycleAction
  | "create_version"
  | "regenerate"
  | "migrate";

export type QuestionValidationStatus = "pending" | "valid" | "invalid";

export type ReviewPriority = "normal" | "priority";

export const SOURCE_TYPES = [
  "original_demo",
  "professor_provided",
  "generated_original",
  "pattern_derived_original",
  "private_reference_pattern",
] satisfies SourceType[];

export const TRUST_LEVELS = [
  "public_original",
  "professor_approved",
  "course_approved",
  "generated_unverified",
  "private_reference",
] satisfies TrustLevel[];

export const REVIEW_STATUSES = [
  "approved",
  "needs_review",
  "rejected",
  "needs_edit",
  "needs_regeneration",
] satisfies ReviewStatus[];

export const REVIEW_PRIORITIES = [
  "normal",
  "priority",
] satisfies ReviewPriority[];

export type TutorMode = "check" | "hint" | "solution" | "full_solution";

export type TutorSource = "rule" | "retrieval" | "llm" | "cache" | "blocked";

export type TutorState =
  | "working"
  | "hinting"
  | "step_reveal"
  | "misconception_detected"
  | "solved"
  | "retrieval_guidance"
  | "llm_guidance"
  | "blocked";

export type TutorVerdict = "correct" | "incorrect" | "guidance" | "blocked";

export type TutorResponseLabel =
  | "approved_course_content"
  | "generated_approved_content"
  | "general_ai_help"
  | "private_reference_grounded_explanation";

export type Topic = {
  active: boolean;
  description: string;
  id: string;
  keywords?: string[];
  moduleRef: string;
  order: number;
  title: string;
  weekNumber: number;
};

export type CourseTopic = Topic;

export type Hint = string;

export type SolutionStep = string;

export type Misconception = {
  feedback: string;
  id: string;
  matchTerms: string[];
};

export type SourceMetadata = {
  originalityNote?: string;
  patternIds?: string[];
  sourceType: SourceType;
  trustLevel: TrustLevel;
  visibility: Visibility;
};

export type ReviewMetadata = {
  notes?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewPriority?: ReviewPriority;
  status: ReviewStatus;
};

export type QuestionContent = {
  answer: {
    spec?: AnswerSpec;
    acceptedAnswers: string[];
    explanation: string;
    numericValue?: number;
    tolerance?: number;
  };
  difficulty: Difficulty;
  hints: Hint[];
  id: string;
  misconceptions: Misconception[];
  prompt: string;
  solutionSteps: SolutionStep[];
  title: string;
  topicId: string;
};

export type QuestionRevisionContentInput = Omit<QuestionContent, "id">;

export type TutorQuestion = QuestionContent & {
  review: ReviewMetadata;
  source: SourceMetadata;
};

export type PracticeQuestion = TutorQuestion;

/**
 * Student-facing question metadata that may cross the browser boundary before
 * a tutor session reveals any instructional content. Accepted answers,
 * explanations, hint bodies, solution steps, and misconception rules stay on
 * the server.
 */
export type StudentPracticeQuestion = {
  difficulty: Difficulty;
  difficultyLabel: string;
  hintCount: number;
  id: string;
  /**
   * Plain-language guidance on how to type the answer (for example "Enter a
   * decimal, fraction, or percentage"). Derived on the server from the answer
   * rules without exposing the expected value.
   */
  inputFormatHint: string;
  prompt: string;
  sourceLabel: string;
  sourceType: SourceType;
  stepCount: number;
  title: string;
  topicId: string;
};

export type SimilarPracticeSessionDto = {
  question: StudentPracticeQuestion;
  sessionId: string;
};

export type RetrievalChunkType =
  | "concept"
  | "example"
  | "formula"
  | "hint"
  | "misconception"
  | "pattern"
  | "question"
  | "solution_step"
  | "solution_summary";

export type RetrievalPriorityTier =
  | "approved_professor_course"
  | "approved_generated"
  | "private_reference"
  | "safe_demo"
  | "admin_dev_draft";

export type RetrievalChunk = {
  body: string;
  chunkType: RetrievalChunkType;
  conceptTags: string[];
  contentHash?: string;
  difficulty?: Difficulty;
  embeddingModel?: string;
  formulaRefs: string[];
  id: string;
  keywords: string[];
  llmSafeSummary?: string;
  priorityTier: RetrievalPriorityTier;
  questionId?: string;
  review: ReviewMetadata;
  source: SourceMetadata;
  title: string;
  topicId: string;
};

export type TutorRetrievalResult = {
  groundingContext: LlmGroundingContext[];
  matches: RetrievalMatch[];
  retrievedContext: RetrievalChunk[];
};

export type RetrievalMatch = {
  chunk: RetrievalChunk;
  priorityTier: RetrievalPriorityTier;
  score: number;
};

export type LlmGroundingContext = {
  body: string;
  id: string;
  priorityTier: RetrievalPriorityTier;
  sourceType: SourceType;
  title: string;
  topicId: string;
};

export type ReviewCandidate = QuestionContent & {
  id: string;
  patternSource: string;
  review: ReviewMetadata;
  source: SourceMetadata;
  topic?: string;
};

export type AdminQuestion = TutorQuestion & {
  patternSource?: string;
  topicTitle?: string;
};

export type QuestionVersionAttribution = {
  displayName: string;
  occurredAt: string;
  userId: string;
};

export type QuestionVersionDto = QuestionContent & {
  allowedActions: QuestionLifecycleAction[];
  contentHash: string;
  createdAt: string;
  createdBy: QuestionVersionAttribution;
  creationMethod: QuestionCreationMethod;
  generationMetadata: Record<string, unknown>;
  parentVersionId?: number;
  schemaVersion: number;
  source: SourceMetadata;
  state: QuestionVersionState;
  validationStatus: QuestionValidationStatus;
  versionId: number;
  versionNumber: number;
};

export type QuestionLifecycleEventDto = {
  action: QuestionLifecycleEventAction;
  actor: QuestionVersionAttribution;
  actorRole: "professor" | "system";
  executedBy?: QuestionVersionAttribution;
  fromState?: QuestionVersionState;
  id: number;
  /**
   * Public-safe, whitelisted event metadata. Question intake records how a
   * saved draft was produced here (input mode and model) so provenance stays
   * visible after the professor leaves the intake screen.
   */
  metadata?: Record<string, boolean | number | string>;
  note?: string;
  reasonCode?: string;
  requestId?: string;
  requestedBy?: QuestionVersionAttribution;
  toState?: QuestionVersionState;
  versionId: number;
};

export type QuestionLifecycleDto = {
  allowedActions: QuestionLifecycleAction[];
  events: QuestionLifecycleEventDto[];
  publishedVersion?: QuestionVersionDto;
  provenanceCorrectionAllowed: boolean;
  questionId: string;
  recordState: QuestionRecordState;
  regenerationAllowed: boolean;
  reserve?: QuestionReserveDisposition;
  reserveEvents?: QuestionReserveEventDto[];
  versions: QuestionVersionDto[];
  workingVersion: QuestionVersionDto;
};

export type QuestionReserveReasonCode =
  | "repetitive"
  | "save_for_later"
  | "future_topic"
  | "extra_practice"
  | "other";

export type QuestionReserveDisposition = {
  note?: string;
  practiceAllowed?: boolean;
  reasonCode: QuestionReserveReasonCode;
  reservedAt: string;
  reservedBy: QuestionVersionAttribution;
};

export type QuestionReserveEventDto = {
  action: "reserve" | "release" | "allow_practice" | "disallow_practice";
  actor: QuestionVersionAttribution;
  id: number;
  note?: string;
  reasonCode?: QuestionReserveReasonCode;
  requestId?: string;
  versionId: number;
};

export type QuestionLifecycleDashboard = {
  inspections: QuestionVersionInspectionDto[];
  mode: "database" | "demo";
  questions: QuestionLifecycleDto[];
  readOnly: boolean;
  readOnlyReason?: string;
  topics: Array<{
    id: string;
    title: string;
  }>;
};

export type ProfessorReviewTopicSummaryDto = {
  approved: number;
  needsReview: number;
  order: number;
  rejectedOrRevisionRequested: number;
  remaining: number;
  title: string;
  topicId: string;
  total: number;
};

/**
 * A deliberately narrow review-queue projection. It contains the complete
 * public-safe working-version aggregate needed for a review decision, but no
 * version history, lifecycle notes, private pattern controls, or source
 * locators.
 */
export type ProfessorQuestionReviewCandidateDto = Omit<
  QuestionContent,
  "misconceptions"
> & {
  allowedActions: QuestionLifecycleAction[];
  createdAt: string;
  createdBy: Pick<QuestionVersionAttribution, "displayName" | "occurredAt">;
  creationMethod: QuestionCreationMethod;
  id: string;
  misconceptions: Array<Pick<Misconception, "feedback" | "id">>;
  publishedVersionId?: number;
  questionId: string;
  review: {
    reviewPriority: ReviewPriority;
    status: "needs_review";
  };
  source: Pick<SourceMetadata, "originalityNote" | "sourceType" | "trustLevel">;
  state: "needs_review";
  validationStatus: QuestionValidationStatus;
  versionId: number;
  versionNumber: number;
};

export type ProfessorQuestionReviewDashboard = {
  candidates: ProfessorQuestionReviewCandidateDto[];
  mode: "database" | "demo";
  readOnly: boolean;
  readOnlyReason?: string;
  selectedTopicId?: string;
  topics: ProfessorReviewTopicSummaryDto[];
};

export type AdminQuestionSection =
  | "approved_student_facing"
  | "generated_original"
  | "pattern_derived_original_candidates"
  | "professor_provided";

export type AdminQuestionDashboard = {
  mode: "database" | "demo";
  questions: AdminQuestion[];
  readOnly: boolean;
  readOnlyReason?: string;
  sections: Record<AdminQuestionSection, string[]>;
  topics: Array<{
    id: string;
    title: string;
  }>;
};

export type PrivateExtractionItem = {
  abstractPattern: string;
  formulas: string[];
  id: string;
  locator?: {
    page?: number;
    section?: string;
  };
  misconceptionIdeas: string[];
  publicSafeSummary: string;
  topicId: string;
  type: "formula" | "misconception" | "pattern";
};

export type PrivateExtractionOutput = {
  documentId: string;
  items: PrivateExtractionItem[];
  sourceType: "book_pdf" | "course_docx" | "course_pdf" | "professor_material";
  visibility: "private";
};

export type QuestionPattern = {
  abstractTemplate: string;
  allowedGeneratedUse: "pattern_only";
  conceptTags: string[];
  forbiddenSimilarity: {
    privatePhraseHashes: string[];
    sourceNumberSets: string[][];
    sourceStoryFamilies: string[];
  };
  formulaRefs: string[];
  id: string;
  mappingStatus?: "mapped" | "needs_topic_mapping";
  misconceptionTargets: string[];
  reasoningPlan: string[];
  source: SourceMetadata & {
    sourceType: "private_reference_pattern";
    trustLevel: "private_reference";
    visibility: "private";
  };
  sourceItemIds: string[];
  title: string;
  topicId: string;
  variables: PatternVariable[];
};

export type PatternMetadata = QuestionPattern;

export type DemoQuestionPattern = {
  constraints: string[];
  difficulty: Difficulty;
  generationNotes: string[];
  id: string;
  misconceptionHooks: string[];
  template: string;
  topic: string;
  variables: DemoPatternVariable[];
};

export type DemoPatternVariable = {
  name: string;
  role: string;
  type: "category" | "count" | "decimal" | "integer" | "money" | "percent";
  values?: (number | string)[];
};

export type GeneratedQuestionDraft = {
  difficulty: Difficulty;
  finalAnswer: string;
  hints: string[];
  id: string;
  misconceptions: {
    feedback: string;
    hook: string;
    id: string;
  }[];
  originalityNote: string;
  patternId: string;
  questionText: string;
  reviewStatus: "needs_review";
  solutionSteps: string[];
  sourceType: "generated_original";
  topic: string;
  topicId: string;
  trustLevel: "generated_unverified";
};

export type GeneratedQuestionReviewItem = {
  answer: string;
  difficulty: Difficulty;
  hints: string[];
  id: string;
  misconceptions: GeneratedQuestionDraft["misconceptions"];
  originalityNote: string;
  patternId: string;
  question: string;
  reviewStatus: ReviewStatus;
  solutionSteps: string[];
  topic: string;
  topicId: string;
};

export type ApprovedGeneratedQuestion = {
  difficulty: Difficulty;
  finalAnswer: string;
  hints: string[];
  id: string;
  misconceptions: GeneratedQuestionDraft["misconceptions"];
  originalityNote: string;
  patternId: string;
  questionText: string;
  reviewStatus: "approved";
  solutionSteps: string[];
  sourceMetadata: {
    originalityNote: string;
    sourceType: "generated_original";
    visibility: "public";
  };
  topic: string;
  topicId: string;
  trustLevel: "professor_approved";
};

export type PatternVariable = {
  constraints?: string[];
  max?: number;
  min?: number;
  name: string;
  role: string;
  type: "integer" | "decimal" | "percent";
  values?: number[];
};

export function hasGeneratedQuestionDefaults(question: TutorQuestion) {
  return (
    question.review.status === "needs_review" &&
    question.source.trustLevel === "generated_unverified"
  );
}

export type TutorRequest = {
  allowLlmFallback?: boolean;
  answer: string;
  eventId?: string;
  mode: TutorMode;
  questionId?: string;
  sessionId?: string;
  topicId?: string;
};

export type TutorUsage = {
  contextUsed: boolean;
  estimatedTokens: number;
  fallbackUsed: boolean;
  llmFallbackEligible?: boolean;
};

export type TutorSessionAttempt = {
  checkDetail?: CheckDetail;
  answerPreview?: string;
  contextUsed?: boolean;
  createdAt: string;
  estimatedTokens?: number;
  fallbackUsed?: boolean;
  id: string;
  idempotencyKey?: string;
  misconceptionFeedback?: string[];
  mode?: TutorMode;
  normalizedAnswer?: string;
  responseLabel?: TutorResponseLabel;
  source?: TutorSource;
  state?: TutorState;
  submittedAnswer?: string;
  verdict?: TutorVerdict;
};

export type TutorSessionStatus =
  | "active"
  | "completed"
  | "expired"
  | "content_unpublished";

export type TutorSessionRecord = {
  attemptCount?: number;
  attempts: TutorSessionAttempt[];
  completedAt?: string;
  createdAt: string;
  currentState?: TutorState;
  engineState?: TutorSessionEngineState;
  expiresAt?: string;
  id: string;
  idempotencyKey?: string;
  lastSeenAt: string;
  llmUsed?: boolean;
  originSessionId?: string;
  practiceContext?: "published" | "reserve_practice";
  questionId: string;
  questionTitle?: string;
  questionVersionId?: number;
  questionVersion?: PracticeQuestion;
  revealedHints: number;
  revealedSteps: number;
  retrievalUsed?: boolean;
  revision?: number;
  solved?: boolean;
  status?: TutorSessionStatus;
  topicId?: string;
  wrongAttemptCount?: number;
};

export type TutorSessionEngineState = TutorProgress & {
  lastAnswerFingerprint?: string;
  lastMisconceptionIds: string[];
  questionKey: string;
  sessionId: string;
};

/**
 * Instructor analytics DTOs.
 *
 * `studentKey` is a SHA-256 digest of the tutor-session owner, derived in SQL.
 * It is stable across sessions and is the only student handle that leaves the
 * server: the raw anonymous cookie value, the authenticated user id, and the
 * user's name and email deliberately never reach an instructor surface.
 */
export type InstructorStudentSummary = {
  attempts: number;
  correctAttempts: number;
  extraPracticeSessions: number;
  firstActiveAt?: string;
  hintsUsed: number;
  incorrectAttempts: number;
  lastActiveAt?: string;
  llmAttempts: number;
  misconceptionAttempts: number;
  needsAttention: boolean;
  sessions: number;
  solutionsRevealed: number;
  solvedSessions: number;
  studentKey: string;
  topicsPracticed: number;
};

export type InstructorStudentSort =
  | "attempts"
  | "last_active"
  | "lowest_accuracy"
  | "sessions";

export type InstructorStudentListFilters = {
  limit?: number;
  offset?: number;
  search?: string;
  sort?: InstructorStudentSort;
};

export type InstructorStudentList = {
  limit: number;
  mode: "database" | "demo";
  offset: number;
  students: InstructorStudentSummary[];
  total: number;
};

export type InstructorStudentTopicPerformance = {
  attempts: number;
  correctAttempts: number;
  hintsUsed: number;
  incorrectAttempts: number;
  lastActiveAt?: string;
  misconceptionAttempts: number;
  solutionsRevealed: number;
  topicId: string;
  topicTitle: string;
};

/**
 * One recorded tutor interaction. `misconceptionDetected` reports only whether
 * the engine matched a misconception; the stored feedback text itself is not
 * returned, and neither is the submitted answer.
 */
export type InstructorStudentAttempt = {
  createdAt: string;
  id: string;
  misconceptionDetected: boolean;
  mode: string;
  questionId: string;
  questionTitle: string;
  source: string;
  topicId: string;
  topicTitle: string;
  verdict?: string;
};

export type InstructorMisconceptionCount = {
  label: string;
  misconceptionId: string;
  sessions: number;
};

export type InstructorStudentActivityPoint = {
  attempts: number;
  correctAttempts: number;
  date: string;
};

/**
 * A deterministic, explainable signal. Every entry carries the counts it was
 * derived from so the instructor can check the reasoning rather than trust a
 * ranking.
 */
export type InstructorAttentionSignal = {
  attempts: number;
  code:
    | "repeated_misconception"
    | "repeated_topic_difficulty"
    | "solution_reliance";
  correctAttempts: number;
  detail: string;
  topicId?: string;
  topicTitle?: string;
};

export type InstructorStudentDetail = {
  activity: InstructorStudentActivityPoint[];
  attention: InstructorAttentionSignal[];
  attempts: InstructorStudentAttempt[];
  misconceptions: InstructorMisconceptionCount[];
  mode: "database" | "demo";
  summary: InstructorStudentSummary;
  topics: InstructorStudentTopicPerformance[];
};

/**
 * The outcome of an explicit, professor-initiated identity reveal.
 *
 * Identity is never part of an analytics record: these fields are read from
 * the identity provider at the moment a professor asks for them and are not
 * written back into any session, attempt, or aggregate. `anonymous` is a
 * student who practised without signing in, `unlinked` an account the provider
 * no longer holds, and `unavailable` a reveal that could not be completed —
 * an unreachable provider, or a reveal that could not be written to the audit
 * trail and was therefore withheld.
 */
export type InstructorStudentIdentity =
  | { displayName: string; email?: string; status: "identified" }
  | { status: "anonymous" }
  | { status: "unavailable" }
  | { status: "unlinked" };

export type InstructorCohortAnalytics = {
  incorrectAttempts?: number;
  activeStudents: number;
  attempts: number;
  blockedAttempts: number;
  correctAttempts: number;
  excludedStaffSessions: number;
  extraPracticeSessions: number;
  hintsUsed: number;
  llmAttempts: number;
  misconceptions: InstructorMisconceptionCount[];
  mode: "database" | "demo";
  retrievalAttempts: number;
  ruleAttempts: number;
  sessions: number;
  solutionsRevealed: number;
  studentsNeedingAttention: number;
};

export type StudentProgressDashboard = {
  mode: "database" | "demo";
  questions: Array<{
    attemptCount: number;
    available: boolean;
    completedAt?: string;
    hintsUsed: number;
    lastActiveAt: string;
    needsAnotherAttempt: boolean;
    questionId: string;
    questionTitle: string;
    resumeSessionId?: string;
    status: "completed" | "in_progress";
    topicId: string;
    topicTitle: string;
  }>;
  recentSessions: Array<{
    attemptCount: number;
    available: boolean;
    hintsUsed: number;
    lastSeenAt: string;
    needsAnotherAttempt: boolean;
    questionId: string;
    questionTitle: string;
    practiceContext?: "published" | "reserve_practice";
    sessionId: string;
    status: "completed" | "in_progress" | "unavailable";
    stepsRevealed: number;
    topicId: string;
    topicTitle: string;
  }>;
  summary: {
    availableCompletedQuestions: number;
    availableQuestions: number;
    completedQuestions: number;
    extraPracticeSessions?: number;
    hintsUsed: number;
    inProgressQuestions: number;
    needsAnotherAttempt: number;
    previouslyCompletedQuestions: number;
    topicsStarted: number;
  };
  topics: Array<{
    availableQuestions: number;
    completedQuestions: number;
    id: string;
    inProgressQuestions: number;
    needsAnotherAttempt: number;
    previouslyCompletedQuestions: number;
    title: string;
  }>;
};

export type TutorResponse = {
  checkDetail?: CheckDetail;
  hints: string[];
  message: string;
  misconceptions: string[];
  progress?: TutorProgress;
  responseLabel?: TutorResponseLabel;
  retrievedContext: RetrievalChunk[];
  source: TutorSource;
  steps: string[];
  usage: TutorUsage;
  verdict: TutorVerdict;
};

export type TutorProgress = {
  attemptCount: number;
  hintsRevealed: number;
  llmUsed: boolean;
  retrievalUsed: boolean;
  solved: boolean;
  state: TutorState;
  stepsRevealed: number;
  wrongAttemptCount: number;
};

export type ProfessorTopicReviewProgress = {
  approved: number;
  needsReview: number;
  rejected: number;
  remaining: number;
  topicId: string;
  totalDrafts: number;
};

export type GeneratedQuestionReviewOutcomes = Record<ReviewStatus, number>;

export type ProfessorPracticeAnalytics = {
  generatedQuestionOutcomes: GeneratedQuestionReviewOutcomes;
  mode: "database" | "demo" | "unavailable";
  questions: Array<{
    attempts: number;
    correctAttempts: number;
    hintsUsed: number;
    incorrectAttempts: number;
    llmAttempts: number;
    questionId: string;
    questionTitle: string;
    stepsRevealed: number;
    topicId: string;
    topicTitle: string;
  }>;
  summary: {
    totalAttempts: number;
    totalHintsUsed: number;
    totalStepsRevealed: number;
    totalTutorSessions: number;
  };
  topics: Array<{
    incorrectAttempts?: number;
    attempts: number;
    correctAttempts: number;
    hintsUsed: number;
    llmAttempts: number;
    stepsRevealed: number;
    topicId: string;
    topicTitle: string;
  }>;
};
