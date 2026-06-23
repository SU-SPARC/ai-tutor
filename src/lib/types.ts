export type Difficulty = "foundational" | "intermediate" | "challenge"

export type ReviewStatus = "pending" | "approved" | "rejected"

export type TutorMode = "check" | "hint" | "solution"

export type TutorSource = "rule" | "retrieval" | "llm" | "blocked"

export type TutorVerdict = "correct" | "incorrect" | "guidance" | "blocked"

export type CourseTopic = {
  description: string
  id: string
  title: string
}

export type Misconception = {
  feedback: string
  id: string
  matchTerms: string[]
}

export type PracticeQuestion = {
  answer: {
    acceptedAnswers: string[]
    explanation: string
    numericValue?: number
    tolerance?: number
  }
  difficulty: Difficulty
  hints: string[]
  id: string
  misconceptions: Misconception[]
  prompt: string
  solutionSteps: string[]
  title: string
  topicId: string
}

export type RetrievalChunk = {
  body: string
  id: string
  keywords: string[]
  title: string
  topicId: string
  type: "formula" | "example" | "pattern"
}

export type ReviewCandidate = {
  id: string
  originalityNote: string
  patternSource: string
  prompt: string
  status: ReviewStatus
  title: string
  topicId: string
}

export type TutorRequest = {
  allowLlmFallback?: boolean
  answer: string
  mode: TutorMode
  questionId?: string
  sessionId?: string
  topicId?: string
}

export type TutorResponse = {
  hints: string[]
  message: string
  misconceptions: string[]
  retrievedContext: RetrievalChunk[]
  source: TutorSource
  steps: string[]
  usage: {
    estimatedTokens: number
    llmFallbacksRemaining: number
  }
  verdict: TutorVerdict
}

export type UsageSummary = {
  estimatedTokens: number
  interactions: number
  llmFallbacks: number
}
