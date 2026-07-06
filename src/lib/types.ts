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

export type TutorMode = "check" | "hint" | "solution"

export type TutorSource = "rule" | "retrieval" | "llm" | "blocked"

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

export type Topic = {
  description: string
  id: string
  title: string
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

export type RetrievalChunk = {
  body: string
  id: string
  keywords: string[]
  review: ReviewMetadata
  source: SourceMetadata
  title: string
  topicId: string
  type: "formula" | "example" | "pattern"
}

export type ReviewCandidate = QuestionContent & {
  id: string
  patternSource: string
  review: ReviewMetadata
  source: SourceMetadata
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

export type TutorSessionAttempt = {
  answerPreview?: string
  createdAt: string
  id: string
}

export type TutorSessionRecord = {
  anonymousStudentId?: string
  attempts: TutorSessionAttempt[]
  createdAt: string
  id: string
  questionId: string
  revealedHints: number
  revealedSteps: number
}

export type TutorResponse = {
  hints: string[]
  message: string
  misconceptions: string[]
  progress?: TutorProgress
  retrievedContext: RetrievalChunk[]
  source: TutorSource
  steps: string[]
  usage: {
    estimatedTokens: number
    llmFallbacksRemaining: number
  }
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
