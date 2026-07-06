import { normalizeAnswerText } from "@/lib/tutor/answer-checker"
import type { Misconception } from "@/lib/types"

export type MisconceptionMatcher = {
  allTerms?: string[]
  anyTerms: string[]
}

export type ProbabilityMisconception = {
  correctiveHint: string
  explanation: string
  id: string
  matcher: MisconceptionMatcher
  topic: string
}

export type DetectedMisconception = ProbabilityMisconception & {
  feedback: string
  source: "library" | "question"
}

export type MisconceptionDetectionInput = {
  questionMisconceptions?: Misconception[]
  studentAnswer: string
  topicId?: string
}

export const PROBABILITY_STATISTICS_MISCONCEPTIONS: ProbabilityMisconception[] = [
  {
    id: "probability-vs-count",
    topic: "basic probability",
    matcher: {
      anyTerms: [
        "answerisacount",
        "countedoutcomes",
        "favorableoutcomes",
        "numberofoutcomes",
      ],
    },
    explanation:
      "This looks like a count of outcomes rather than a probability.",
    correctiveHint:
      "Convert the count to a probability by dividing favorable outcomes by the appropriate total.",
  },
  {
    id: "union-vs-intersection",
    topic: "set operations",
    matcher: {
      anyTerms: ["aorb", "p(a)+p(b)", "union", "\\cup", "∪"],
      allTerms: ["and"],
    },
    explanation:
      "This appears to use a union idea where an intersection or joint event is needed.",
    correctiveHint:
      "For an 'and' event, focus on outcomes where both events happen; reserve addition rules for 'or' events.",
  },
  {
    id: "complement-rule-mistake",
    topic: "complements",
    matcher: {
      anyTerms: [
        "forgottosubtractfrom1",
        "missedcomplement",
        "notusing1-",
        "usedp(no",
      ],
    },
    explanation:
      "This looks like a complement-rule setup without the final complement step.",
    correctiveHint:
      "For 'at least one' or 'not' questions, compute the opposite event first, then subtract from 1.",
  },
  {
    id: "assuming-independence",
    topic: "independence",
    matcher: {
      anyTerms: [
        "assumeindependent",
        "assumedindependent",
        "multiplyprobabilities",
        "p(a)p(b)",
        "withoutreplacement",
      ],
    },
    explanation:
      "This seems to assume independence before checking whether the trials or events are actually independent.",
    correctiveHint:
      "Check whether one event changes the probability of the other before multiplying probabilities.",
  },
  {
    id: "conditional-probability-denominator-mistake",
    topic: "conditional probability",
    matcher: {
      anyTerms: [
        "36",
        "didnotcondition",
        "fullsamplespace",
        "originaldenominator",
        "totalsamplespace",
      ],
    },
    explanation:
      "This looks like the denominator was taken from the original sample space after a condition was given.",
    correctiveHint:
      "After conditioning, the denominator should count only outcomes where the condition is true.",
  },
  {
    id: "bayes-numerator-denominator-confusion",
    topic: "Bayes rule",
    matcher: {
      anyTerms: [
        "baserate",
        "denominator",
        "p(a|b)/p(b)",
        "p(b|a)/p(a)",
        "swappedbayes",
      ],
    },
    explanation:
      "This suggests the Bayes numerator or denominator may have been swapped or left incomplete.",
    correctiveHint:
      "Build the numerator as the path for the target cause and the denominator as the total probability of the evidence.",
  },
  {
    id: "permutations-vs-combinations",
    topic: "counting",
    matcher: {
      anyTerms: [
        "combination",
        "ncr",
        "npr",
        "orderdoesnotmatter",
        "ordermatters",
        "permutation",
      ],
    },
    explanation:
      "This counting setup may be mixing ordered arrangements with unordered selections.",
    correctiveHint:
      "Ask whether rearranging the same selected items creates a new outcome; if yes use permutations, otherwise use combinations.",
  },
  {
    id: "expected-value-as-most-likely-value",
    topic: "expected value",
    matcher: {
      anyTerms: [
        "expectedisthemostlikely",
        "guaranteedvalue",
        "mode",
        "mostlikely",
      ],
    },
    explanation:
      "This treats expected value as the most likely or guaranteed outcome.",
    correctiveHint:
      "Expected value is a long-run average, not necessarily a possible or most likely single outcome.",
  },
  {
    id: "variance-vs-standard-deviation",
    topic: "variance",
    matcher: {
      anyTerms: [
        "sd",
        "squaredunits",
        "standarddeviation",
        "sqrtvariance",
        "varianceisstandarddeviation",
      ],
    },
    explanation:
      "This may be confusing variance with standard deviation.",
    correctiveHint:
      "Variance is measured in squared units; take the square root only when the question asks for standard deviation.",
  },
  {
    id: "binomial-vs-hypergeometric-confusion",
    topic: "discrete distributions",
    matcher: {
      anyTerms: ["fixedp", "hypergeometric", "independenttrials", "binomial"],
      allTerms: ["withoutreplacement"],
    },
    explanation:
      "This seems to use a binomial model even though sampling without replacement changes the success probability.",
    correctiveHint:
      "Use a hypergeometric model for draws without replacement from a finite population.",
  },
  {
    id: "normal-approximation-misuse",
    topic: "normal approximation",
    matcher: {
      anyTerms: [
        "continuitycorrection",
        "normalapproximation",
        "np<",
        "nq<",
        "toosmallfornormal",
      ],
    },
    explanation:
      "This may use a normal approximation without checking whether the approximation conditions are reasonable.",
    correctiveHint:
      "Check that the expected success and failure counts are large enough, and use a continuity correction for count probabilities.",
  },
  {
    id: "clt-misunderstanding",
    topic: "central limit theorem",
    matcher: {
      anyTerms: [
        "anysampleisnormal",
        "centrallimittheorem",
        "clt",
        "individualvaluesnormal",
        "samplemean",
      ],
    },
    explanation:
      "This appears to apply the central limit theorem to individual observations instead of a sampling distribution.",
    correctiveHint:
      "The CLT describes the distribution of sample means or sums for large samples, not necessarily the raw data values.",
  },
]

export function detectMisconceptions(
  input: MisconceptionDetectionInput,
): DetectedMisconception[] {
  const normalizedAnswer = normalizeAnswerText(input.studentAnswer)

  if (!normalizedAnswer) {
    return []
  }

  const questionMatches = detectQuestionMisconceptions(
    normalizedAnswer,
    input.topicId,
    input.questionMisconceptions ?? [],
  )

  if (questionMatches.length > 0) {
    return dedupeMisconceptions(questionMatches)
  }

  return dedupeMisconceptions([
    ...PROBABILITY_STATISTICS_MISCONCEPTIONS.filter((misconception) =>
      matcherMatches(misconception.matcher, normalizedAnswer),
    ).map<DetectedMisconception>((misconception) => ({
      ...misconception,
      feedback: `${misconception.explanation} ${misconception.correctiveHint}`,
      source: "library",
    })),
  ])
}

function detectQuestionMisconceptions(
  normalizedAnswer: string,
  topicId: string | undefined,
  misconceptions: Misconception[],
) {
  return misconceptions
    .filter((misconception) =>
      misconception.matchTerms.some((term) =>
        normalizedAnswer.includes(normalizeAnswerText(term)),
      ),
    )
    .map<DetectedMisconception>((misconception) => ({
      correctiveHint: misconception.feedback,
      explanation: misconception.feedback,
      feedback: misconception.feedback,
      id: misconception.id,
      matcher: {
        anyTerms: misconception.matchTerms,
      },
      source: "question",
      topic: topicId ?? "question-specific",
    }))
}

function matcherMatches(
  matcher: MisconceptionMatcher,
  normalizedAnswer: string,
) {
  const hasAllTerms = (matcher.allTerms ?? []).every((term) =>
    normalizedAnswer.includes(normalizeAnswerText(term)),
  )
  const hasAnyTerm = matcher.anyTerms.some((term) =>
    normalizedAnswer.includes(normalizeAnswerText(term)),
  )

  return hasAllTerms && hasAnyTerm
}

function dedupeMisconceptions(misconceptions: DetectedMisconception[]) {
  const seen = new Set<string>()

  return misconceptions.filter((misconception) => {
    if (seen.has(misconception.id)) {
      return false
    }

    seen.add(misconception.id)
    return true
  })
}
