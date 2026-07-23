import type {
  Difficulty,
  Misconception,
  ReviewMetadata,
  RetrievalChunk,
  ReviewCandidate,
  SourceMetadata,
  Topic,
  TutorQuestion,
} from "@/lib/types"
import generatedReviewCandidateData from "../../../data/demo/generated-review-candidates.json"
import demoQuestionData from "../../../data/demo/questions.json"
import syllabusReviewCandidateData from "../../../data/demo/syllabus-review-candidates.json"
import topicData from "../../../data/demo/topics.json"

const approvedDemoReview: ReviewMetadata = {
  status: "approved",
}

function originalDemoSource(originalityNote: string): SourceMetadata {
  return {
    originalityNote,
    sourceType: "original_demo",
    trustLevel: "public_original",
    visibility: "public",
  }
}

export const demoTopics = validateAndSortTopics(topicData as Topic[])

type DemoQuestionFixture = {
  acceptedAnswers?: string[]
  answerExplanation?: string
  difficulty: Difficulty
  finalAnswer: string
  hints: string[]
  id: string
  misconceptions?: Misconception[]
  numericValue?: number
  questionText: string
  solutionSteps: string[]
  sourceMetadata?: {
    originalityNote?: string
  }
  title?: string
  tolerance?: number
  topic: string
  topicId: string
}

export const demoQuestions: TutorQuestion[] = (
  demoQuestionData as DemoQuestionFixture[]
).map((question) => ({
  id: question.id,
  topicId: question.topicId,
  title: question.title ?? question.topic,
  difficulty: question.difficulty,
  prompt: question.questionText,
  answer: {
    acceptedAnswers: question.acceptedAnswers ?? [question.finalAnswer],
    numericValue: question.numericValue,
    tolerance: question.tolerance,
    explanation:
      question.answerExplanation ??
      question.solutionSteps.at(-1) ??
      question.finalAnswer,
  },
  hints: question.hints,
  solutionSteps: question.solutionSteps,
  misconceptions: question.misconceptions ?? [],
  source: originalDemoSource(
    question.sourceMetadata?.originalityNote ??
      "Original synthetic demo item; no private source text used.",
  ),
  review: approvedDemoReview,
}))

export const retrievalChunks: RetrievalChunk[] = [
  {
    id: "conditional-sample-space",
    topicId: "conditional-probability",
    chunkType: "pattern",
    title: "Conditional probability pattern",
    body:
      "For P(A | B), first restrict attention to outcomes where B occurred, then count or compute the proportion where A also occurred.",
    keywords: ["conditional", "given", "sample space", "dice", "sum"],
    formulaRefs: ["P(A | B)"],
    conceptTags: ["conditional probability", "restricted sample space"],
    priorityTier: "safe_demo",
    source: originalDemoSource(
      "Original public-safe retrieval summary; no private source text used.",
    ),
    review: approvedDemoReview,
  },
  {
    id: "binomial-formula",
    topicId: "binomial-models",
    chunkType: "formula",
    title: "Binomial probability formula",
    body:
      "If X follows Binomial(n, p), then P(X = k) = C(n,k)p^k(1-p)^(n-k).",
    keywords: ["binomial", "exactly", "independent", "combination", "success"],
    formulaRefs: ["P(X = k) = C(n,k)p^k(1-p)^(n-k)"],
    conceptTags: ["binomial model", "exact count probability"],
    priorityTier: "safe_demo",
    source: originalDemoSource(
      "Original public-safe retrieval summary; no private source text used.",
    ),
    review: approvedDemoReview,
  },
  {
    id: "z-score-formula",
    topicId: "normal-standardization",
    chunkType: "formula",
    title: "Z-score formula",
    body:
      "Standardize normal observations with z = (x - mean) / standard deviation.",
    keywords: ["normal", "z-score", "standardize", "mean", "standard deviation"],
    formulaRefs: ["z = (x - mean) / standard deviation"],
    conceptTags: ["normal standardization", "z-score"],
    priorityTier: "safe_demo",
    source: originalDemoSource(
      "Original public-safe retrieval summary; no private source text used.",
    ),
    review: approvedDemoReview,
  },
]

export const reviewCandidates: ReviewCandidate[] = [
  ...(generatedReviewCandidateData as ReviewCandidate[]),
  ...(syllabusReviewCandidateData as ReviewCandidate[]),
]

function validateAndSortTopics(topics: Topic[]) {
  const ids = new Set<string>()
  const orders = new Set<number>()

  for (const topic of topics) {
    if (!topic.id || !topic.title || !topic.moduleRef) {
      throw new Error("Every syllabus topic needs an id, title, and module reference.")
    }

    if (
      !Number.isInteger(topic.order) ||
      topic.order < 1 ||
      !Number.isInteger(topic.weekNumber) ||
      topic.weekNumber < 1
    ) {
      throw new Error(`Invalid syllabus order metadata for topic ${topic.id}.`)
    }

    if (ids.has(topic.id) || orders.has(topic.order)) {
      throw new Error(`Duplicate syllabus topic id or order for ${topic.id}.`)
    }

    ids.add(topic.id)
    orders.add(topic.order)
  }

  return [...topics]
    .filter((topic) => topic.active)
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id),
    )
}
