export type Difficulty = "foundational" | "intermediate" | "challenge"

export type Visibility = "public" | "private"

export type SourceType =
  | "original_demo"
  | "professor_provided"
  | "generated_original"
  | "pattern_derived_original"
  | "private_reference_pattern"

export type TrustLevel =
  | "public_original"
  | "professor_approved"
  | "course_approved"
  | "generated_unverified"
  | "private_reference"

export type ReviewStatus =
  | "approved"
  | "needs_review"
  | "rejected"
  | "needs_edit"
  | "needs_regeneration"

export type ReviewPriority = "normal" | "priority"

export const SOURCE_TYPES = [
  "original_demo",
  "professor_provided",
  "generated_original",
  "pattern_derived_original",
  "private_reference_pattern",
] satisfies SourceType[]

export const TRUST_LEVELS = [
  "public_original",
  "professor_approved",
  "course_approved",
  "generated_unverified",
  "private_reference",
] satisfies TrustLevel[]

export const REVIEW_STATUSES = [
  "approved",
  "needs_review",
  "rejected",
  "needs_edit",
  "needs_regeneration",
] satisfies ReviewStatus[]

export const REVIEW_PRIORITIES = ["normal", "priority"] satisfies ReviewPriority[]

export type TutorMode = "check" | "hint" | "solution"

export type TutorSource = "rule" | "retrieval" | "llm" | "cache" | "blocked"

export type TutorState =
  | "working"
  | "hinting"
  | "step_reveal"
  | "misconception_detected"
  | "solved"
  | "retrieval_guidance"
  | "llm_guidance"
  | "blocked"

export type TutorVerdict = "correct" | "incorrect" | "guidance" | "blocked"

export type TutorResponseLabel =
  | "approved_course_content"
  | "generated_approved_content"
  | "general_ai_help"
  | "private_reference_grounded_explanation"

export type Topic = {
  active: boolean
  description: string
  id: string
  moduleRef: string
  order: number
  title: string
  weekNumber: number
}

export type CourseTopic = Topic

export type Hint = string

export type SolutionStep = string

export type Misconception = {
  feedback: string
  id: string
  matchTerms: string[]
}

export type SourceMetadata = {
  originalityNote?: string
  patternIds?: string[]
  sourceType: SourceType
  trustLevel: TrustLevel
  visibility: Visibility
}

export type ReviewMetadata = {
  notes?: string
  reviewedAt?: string
  reviewedBy?: string
  reviewPriority?: ReviewPriority
  status: ReviewStatus
}

export type QuestionContent = {
  answer: {
    acceptedAnswers: string[]
    explanation: string
    numericValue?: number
    tolerance?: number
  }
  difficulty: Difficulty
  hints: Hint[]
  id: string
  misconceptions: Misconception[]
  prompt: string
  solutionSteps: SolutionStep[]
  title: string
  topicId: string
}

export type TutorQuestion = QuestionContent & {
  review: ReviewMetadata
  source: SourceMetadata
}

export type PracticeQuestion = TutorQuestion

export type RetrievalChunkType =
  | "concept"
  | "example"
  | "formula"
  | "hint"
  | "misconception"
  | "pattern"
  | "question"
  | "solution_step"
  | "solution_summary"

export type RetrievalPriorityTier =
  | "approved_professor_course"
  | "approved_generated"
  | "private_reference"
  | "safe_demo"
  | "admin_dev_draft"

export type RetrievalChunk = {
  body: string
  chunkType: RetrievalChunkType
  conceptTags: string[]
  contentHash?: string
  difficulty?: Difficulty
  embeddingModel?: string
  formulaRefs: string[]
  id: string
  keywords: string[]
  llmSafeSummary?: string
  priorityTier: RetrievalPriorityTier
  questionId?: string
  review: ReviewMetadata
  source: SourceMetadata
  title: string
  topicId: string
}

export type TutorRetrievalResult = {
  groundingContext: LlmGroundingContext[]
  matches: RetrievalMatch[]
  retrievedContext: RetrievalChunk[]
}

export type RetrievalMatch = {
  chunk: RetrievalChunk
  priorityTier: RetrievalPriorityTier
  score: number
}

export type LlmGroundingContext = {
  body: string
  id: string
  priorityTier: RetrievalPriorityTier
  sourceType: SourceType
  title: string
  topicId: string
}

export type ReviewCandidate = QuestionContent & {
  id: string
  patternSource: string
  review: ReviewMetadata
  source: SourceMetadata
  topic?: string
}

export type AdminQuestion = TutorQuestion & {
  patternSource?: string
  topicTitle?: string
}

export type AdminQuestionSection =
  | "approved_student_facing"
  | "generated_original"
  | "pattern_derived_original_candidates"
  | "professor_provided"

export type AdminQuestionDashboard = {
  mode: "database" | "demo"
  questions: AdminQuestion[]
  readOnly: boolean
  readOnlyReason?: string
  sections: Record<AdminQuestionSection, string[]>
  topics: Array<{
    id: string
    title: string
  }>
}

export type PrivateExtractionItem = {
  abstractPattern: string
  formulas: string[]
  id: string
  locator?: {
    page?: number
    section?: string
  }
  misconceptionIdeas: string[]
  publicSafeSummary: string
  topicId: string
  type: "formula" | "misconception" | "pattern"
}

export type PrivateExtractionOutput = {
  documentId: string
  items: PrivateExtractionItem[]
  sourceType: "book_pdf" | "course_docx" | "course_pdf" | "professor_material"
  visibility: "private"
}

export type QuestionPattern = {
  abstractTemplate: string
  allowedGeneratedUse: "pattern_only"
  conceptTags: string[]
  forbiddenSimilarity: {
    privatePhraseHashes: string[]
    sourceNumberSets: string[][]
    sourceStoryFamilies: string[]
  }
  formulaRefs: string[]
  id: string
  mappingStatus?: "mapped" | "needs_topic_mapping"
  misconceptionTargets: string[]
  reasoningPlan: string[]
  source: SourceMetadata & {
    sourceType: "private_reference_pattern"
    trustLevel: "private_reference"
    visibility: "private"
  }
  sourceItemIds: string[]
  title: string
  topicId: string
  variables: PatternVariable[]
}

export type PatternMetadata = QuestionPattern

export type DemoQuestionPattern = {
  constraints: string[]
  difficulty: Difficulty
  generationNotes: string[]
  id: string
  misconceptionHooks: string[]
  template: string
  topic: string
  variables: DemoPatternVariable[]
}

export type DemoPatternVariable = {
  name: string
  role: string
  type: "category" | "count" | "decimal" | "integer" | "money" | "percent"
  values?: (number | string)[]
}

export type GeneratedQuestionDraft = {
  difficulty: Difficulty
  finalAnswer: string
  hints: string[]
  id: string
  misconceptions: {
    feedback: string
    hook: string
    id: string
  }[]
  originalityNote: string
  patternId: string
  questionText: string
  reviewStatus: "needs_review"
  solutionSteps: string[]
  sourceType: "generated_original"
  topic: string
  trustLevel: "generated_unverified"
}

export type GeneratedQuestionReviewItem = {
  answer: string
  difficulty: Difficulty
  hints: string[]
  id: string
  misconceptions: GeneratedQuestionDraft["misconceptions"]
  originalityNote: string
  patternId: string
  question: string
  reviewStatus: ReviewStatus
  solutionSteps: string[]
  topic: string
}

export type ApprovedGeneratedQuestion = {
  difficulty: Difficulty
  finalAnswer: string
  hints: string[]
  id: string
  misconceptions: GeneratedQuestionDraft["misconceptions"]
  originalityNote: string
  patternId: string
  questionText: string
  reviewStatus: "approved"
  solutionSteps: string[]
  sourceMetadata: {
    originalityNote: string
    sourceType: "generated_original"
    visibility: "public"
  }
  topic: string
  trustLevel: "professor_approved"
}

export type PatternVariable = {
  constraints?: string[]
  max?: number
  min?: number
  name: string
  role: string
  type: "integer" | "decimal" | "percent"
  values?: number[]
}

export const STUDENT_FACING_TRUST_LEVELS: readonly TrustLevel[] = [
  "public_original",
  "professor_approved",
  "course_approved",
]

export function isApprovedPublicTrustedContent(content: {
  review: ReviewMetadata
  source: SourceMetadata
}) {
  return (
    content.review.status === "approved" &&
    content.source.visibility === "public" &&
    STUDENT_FACING_TRUST_LEVELS.includes(content.source.trustLevel)
  )
}

export function hasGeneratedQuestionDefaults(question: TutorQuestion) {
  return (
    question.review.status === "needs_review" &&
    question.source.trustLevel === "generated_unverified"
  )
}

export type TutorRequest = {
  allowLlmFallback?: boolean
  answer: string
  mode: TutorMode
  questionId?: string
  sessionId?: string
  topicId?: string
}

export type LlmUsageLimitReason =
  | "input_too_long"
  | "llm_not_eligible"
  | "usage_persistence_unavailable"
  | "session_call_limit"
  | "question_daily_limit"
  | "student_daily_limit"
  | "global_daily_limit"
  | "session_token_budget"

export type TutorUsage = {
  cacheHit?: boolean
  contextUsed: boolean
  estimatedTokens: number
  fallbackUsed: boolean
  limitReason?: LlmUsageLimitReason
  llmCallMade?: boolean
  llmFallbackEligible?: boolean
  llmFallbacksRemaining: number
  usagePersistence?: "database" | "demo"
}

export type TutorSessionAttempt = {
  answerPreview?: string
  createdAt: string
  id: string
  source?: TutorSource
  verdict?: TutorVerdict
}

export type TutorSessionRecord = {
  anonymousStudentId?: string
  attempts: TutorSessionAttempt[]
  createdAt: string
  id: string
  lastSeenAt: string
  llmFallbacksRemaining: number
  questionId: string
  revealedHints: number
  revealedSteps: number
}

export type StudentProgressDashboard = {
  mode: "database" | "demo"
  recentSessions: Array<{
    attemptCount: number
    correctAttempts: number
    hintsUsed: number
    lastSeenAt: string
    questionId: string
    questionTitle: string
    stepsRevealed: number
    topicId: string
    topicTitle: string
  }>
  summary: {
    attemptedQuestions: number
    correctAttempts: number
    hintsUsed: number
    stepsRevealed: number
    topicsPracticed: number
  }
  topics: Array<{
    id: string
    title: string
  }>
}

export type TutorResponse = {
  hints: string[]
  message: string
  misconceptions: string[]
  progress?: TutorProgress
  responseLabel?: TutorResponseLabel
  retrievedContext: RetrievalChunk[]
  source: TutorSource
  steps: string[]
  usage: TutorUsage
  verdict: TutorVerdict
}

export type TutorProgress = {
  attemptCount: number
  hintsRevealed: number
  llmUsed: boolean
  retrievalUsed: boolean
  solved: boolean
  state: TutorState
  stepsRevealed: number
  wrongAttemptCount: number
}

export type UsageSummary = {
  estimatedTokens: number
  interactions: number
  llmFallbacks: number
}

export type UsageDashboardTotals = {
  cacheHits: number
  estimatedLlmTokens: number
  inputTokens: number
  interactions: number
  limitBlocks: number
  llmCalls: number
  outputTokens: number
  totalTokens: number
}

export type UsageDashboardDay = UsageDashboardTotals & {
  date: string
}

export type UsageDashboard = {
  daily: UsageDashboardDay[]
  mode: "database" | "demo"
  policy: {
    maxDailyLlmCalls: number
    maxLlmCallsPerQuestionPerDay: number
    maxLlmCallsPerSession: number
    maxLlmCallsPerStudentPerDay: number
    maxLlmOutputTokens: number
    maxLlmTokensPerSession: number
    maxTutorInputChars: number
  }
  today: UsageDashboardTotals
}

export type ProfessorReviewAnalytics = {
  byDifficulty: Record<Difficulty, number>
  byPriority: Record<ReviewPriority, number>
  byStatus: Record<ReviewStatus, number>
  byTopic: Record<string, number>
  totalBacklog: number
}

export type GeneratedQuestionReviewOutcomes = Record<ReviewStatus, number>

export type ProfessorPracticeAnalytics = {
  commonMisconceptions: Array<{
    feedback: string
    misconceptionId: string
    missedAttempts: number
    questionId: string
    questionTitle: string
    topicId: string
    topicTitle: string
  }>
  generatedQuestionOutcomes: GeneratedQuestionReviewOutcomes
  mode: "database" | "demo" | "unavailable"
  questions: Array<{
    attempts: number
    correctAttempts: number
    hintsUsed: number
    llmAttempts: number
    questionId: string
    questionTitle: string
    stepsRevealed: number
    topicId: string
    topicTitle: string
  }>
  summary: {
    totalAttempts: number
    totalHintsUsed: number
    totalStepsRevealed: number
    totalTutorSessions: number
  }
  topics: Array<{
    attempts: number
    correctAttempts: number
    hintsUsed: number
    llmAttempts: number
    stepsRevealed: number
    topicId: string
    topicTitle: string
  }>
}

export type InstructorAnalyticsDashboard = {
  commonMisconceptions: ProfessorPracticeAnalytics["commonMisconceptions"]
  generatedQuestions: {
    approved: number
    needsEdit: number
    needsRegeneration: number
    needsReview: number
    rejected: number
  }
  mode: "database" | "demo"
  mostMissedQuestions: Array<{
    attempts: number
    correctAttempts: number
    missedAttempts: number
    missRate: number
    questionId: string
    questionTitle: string
    topicId: string
    topicTitle: string
  }>
  mostPracticedTopics: ProfessorPracticeAnalytics["topics"]
  notes: string[]
  totals: {
    averageHintsUsed: number
    cacheHits: number
    generatedQuestionsApproved: number
    generatedQuestionsRejected: number
    llmCallsUsed: number
    totalAttempts: number
    totalTutorSessions: number
  }
}

export type ProfessorAnalyticsDashboard = {
  instructor: InstructorAnalyticsDashboard
  mode: "database" | "demo"
  practice: ProfessorPracticeAnalytics
  review: ProfessorReviewAnalytics
  usage: UsageDashboard
}
