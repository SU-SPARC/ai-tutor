import type {
  ReviewMetadata,
  RetrievalChunk,
  ReviewCandidate,
  SourceMetadata,
  Topic,
  TutorQuestion,
} from "@/lib/types"
import generatedReviewCandidateData from "../../../data/demo/generated-review-candidates.json"

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

export const demoTopics: Topic[] = [
  {
    id: "conditional-probability",
    title: "Conditional probability",
    description:
      "Restrict the sample space before counting or computing probabilities.",
  },
  {
    id: "binomial-models",
    title: "Binomial models",
    description:
      "Use independent trials, a fixed success probability, and combinations.",
  },
  {
    id: "normal-standardization",
    title: "Normal standardization",
    description:
      "Convert normal observations to z-scores before interpreting them.",
  },
]

export const demoQuestions: TutorQuestion[] = [
  {
    id: "dice-sum-eight",
    topicId: "conditional-probability",
    title: "Dice sum condition",
    difficulty: "foundational",
    prompt:
      "Two fair dice are rolled. Given that the sum is 8, what is the probability that at least one die shows 3?",
    answer: {
      acceptedAnswers: ["2/5", "0.4", "40%"],
      numericValue: 0.4,
      tolerance: 0.005,
      explanation:
        "There are five equally likely ordered outcomes with sum 8, and two include a 3.",
    },
    hints: [
      "List only the ordered outcomes whose sum is 8.",
      "After conditioning, the denominator is not 36 anymore.",
      "Count the conditioned outcomes that include a 3.",
    ],
    solutionSteps: [
      "Condition on the sum being 8: (2,6), (3,5), (4,4), (5,3), and (6,2).",
      "The favorable outcomes are (3,5) and (5,3).",
      "The probability is 2 out of 5, so P(at least one 3 | sum 8) = 2/5 = 0.4.",
    ],
    misconceptions: [
      {
        id: "uses-full-sample-space",
        matchTerms: ["36", "1/18", "2/36"],
        feedback:
          "You appear to be counting from all 36 dice outcomes. Conditional probability first restricts the sample space to outcomes with sum 8.",
      },
    ],
    source: originalDemoSource(
      "Original synthetic demo item; no private source text used.",
    ),
    review: approvedDemoReview,
  },
  {
    id: "five-question-quiz",
    topicId: "binomial-models",
    title: "Exactly two correct guesses",
    difficulty: "intermediate",
    prompt:
      "A student guesses on 5 independent multiple-choice questions. Each question has probability 0.25 of being correct. What is the probability of exactly 2 correct answers?",
    answer: {
      acceptedAnswers: ["135/512", "0.263671875", "0.2637", "26.37%"],
      numericValue: 0.263671875,
      tolerance: 0.001,
      explanation:
        "Use C(5,2)(0.25)^2(0.75)^3 because the two correct answers can occur in any two of the five positions.",
    },
    hints: [
      "This is a binomial probability with n = 5, p = 0.25, and k = 2.",
      "Include the combination term for the positions of the two correct answers.",
      "The failure probability is 0.75.",
    ],
    solutionSteps: [
      "Identify n = 5 trials, success probability p = 0.25, and desired successes k = 2.",
      "Apply P(X = 2) = C(5,2)(0.25)^2(0.75)^3.",
      "Compute C(5,2) = 10, so the probability is 10 * 0.0625 * 0.421875 = 0.263671875.",
    ],
    misconceptions: [
      {
        id: "missing-combination",
        matchTerms: ["0.026", "0.026367", "1/16"],
        feedback:
          "The product for one exact order is not enough. Multiply by C(5,2) to account for all positions of the two correct answers.",
      },
    ],
    source: originalDemoSource(
      "Original synthetic demo item; no private source text used.",
    ),
    review: approvedDemoReview,
  },
  {
    id: "exam-z-score",
    topicId: "normal-standardization",
    title: "Exam score z-score",
    difficulty: "foundational",
    prompt:
      "Exam scores are normally distributed with mean 70 and standard deviation 8. What is the z-score for a score of 82?",
    answer: {
      acceptedAnswers: ["1.5", "3/2"],
      numericValue: 1.5,
      tolerance: 0.001,
      explanation:
        "A score of 82 is 12 points above the mean, which is 12/8 = 1.5 standard deviations.",
    },
    hints: [
      "Use z = (x - mean) / standard deviation.",
      "Find how far 82 is above 70 before dividing.",
      "The standard deviation is 8.",
    ],
    solutionSteps: [
      "Subtract the mean: 82 - 70 = 12.",
      "Divide by the standard deviation: 12 / 8 = 1.5.",
      "The z-score is 1.5.",
    ],
    misconceptions: [
      {
        id: "reversed-subtraction",
        matchTerms: ["-1.5", "-3/2"],
        feedback:
          "The sign is reversed. Since 82 is above the mean, the z-score should be positive.",
      },
    ],
    source: originalDemoSource(
      "Original synthetic demo item; no private source text used.",
    ),
    review: approvedDemoReview,
  },
]

export const retrievalChunks: RetrievalChunk[] = [
  {
    id: "conditional-sample-space",
    topicId: "conditional-probability",
    type: "pattern",
    title: "Conditional probability pattern",
    body:
      "For P(A | B), first restrict attention to outcomes where B occurred, then count or compute the proportion where A also occurred.",
    keywords: ["conditional", "given", "sample space", "dice", "sum"],
    source: originalDemoSource(
      "Original public-safe retrieval summary; no private source text used.",
    ),
    review: approvedDemoReview,
  },
  {
    id: "binomial-formula",
    topicId: "binomial-models",
    type: "formula",
    title: "Binomial probability formula",
    body:
      "If X follows Binomial(n, p), then P(X = k) = C(n,k)p^k(1-p)^(n-k).",
    keywords: ["binomial", "exactly", "independent", "combination", "success"],
    source: originalDemoSource(
      "Original public-safe retrieval summary; no private source text used.",
    ),
    review: approvedDemoReview,
  },
  {
    id: "z-score-formula",
    topicId: "normal-standardization",
    type: "formula",
    title: "Z-score formula",
    body:
      "Standardize normal observations with z = (x - mean) / standard deviation.",
    keywords: ["normal", "z-score", "standardize", "mean", "standard deviation"],
    source: originalDemoSource(
      "Original public-safe retrieval summary; no private source text used.",
    ),
    review: approvedDemoReview,
  },
]

export const reviewCandidates: ReviewCandidate[] =
  generatedReviewCandidateData as ReviewCandidate[]
