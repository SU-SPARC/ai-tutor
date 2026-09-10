import { normalizeAnswerText } from "@/lib/tutor/answer-checker";
import {
  parseRational,
  rationalsEqual,
  type Rational,
} from "@/lib/tutor/answer/rational";
import type { Misconception } from "@/lib/types";

export type MisconceptionMatcher = {
  allTerms?: string[];
  anyTerms: string[];
};

export type ProbabilityMisconception = {
  correctiveHint: string;
  explanation: string;
  id: string;
  matcher: MisconceptionMatcher;
  topic: string;
  topicIds: string[];
};

export type DetectedMisconception = ProbabilityMisconception & {
  feedback: string;
  source: "library" | "question";
};

export type MisconceptionDetectionInput = {
  questionMisconceptions?: Misconception[];
  studentAnswer: string;
  topicId?: string;
};

export const PROBABILITY_STATISTICS_MISCONCEPTIONS: ProbabilityMisconception[] =
  [
    {
      id: "probability-vs-count",
      topicIds: [
        "introduction-probability-venn-diagrams",
        "axioms-probability-counting-methods",
      ],
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
      topicIds: [
        "conditional-probability",
        "introduction-probability-venn-diagrams",
        "axioms-probability-counting-methods",
      ],
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
      topicIds: [
        "introduction-probability-venn-diagrams",
        "axioms-probability-counting-methods",
        "binomial-models",
      ],
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
      topicIds: [
        "conditional-probability",
        "independent-random-variables-sums-correlation",
      ],
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
      topicIds: ["conditional-probability"],
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
      topicIds: ["conditional-probability"],
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
      topicIds: ["axioms-probability-counting-methods"],
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
      topicIds: ["random-variables", "continuous-random-variables"],
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
      topicIds: [
        "random-variables",
        "continuous-random-variables",
        "normal-standardization",
      ],
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
      explanation: "This may be confusing variance with standard deviation.",
      correctiveHint:
        "Variance is measured in squared units; take the square root only when the question asks for standard deviation.",
    },
    {
      id: "binomial-vs-hypergeometric-confusion",
      topicIds: ["binomial-models"],
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
      topicIds: [
        "normal-standardization",
        "binomial-models",
        "central-limit-theorem",
      ],
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
      topicIds: ["central-limit-theorem"],
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
  ];

export function detectMisconceptions(
  input: MisconceptionDetectionInput,
): DetectedMisconception[] {
  const normalizedAnswer = normalizeAnswerText(input.studentAnswer);

  if (!normalizedAnswer) {
    return [];
  }

  const questionMisconceptions = input.questionMisconceptions ?? [];
  const questionMatches =
    questionMisconceptions.length === 0
      ? []
      : detectQuestionMisconceptions(
          {
            normalized: normalizedAnswer,
            tokens: numericTokens(input.studentAnswer),
          },
          input.topicId,
          questionMisconceptions,
        );

  if (questionMatches.length > 0) {
    return dedupeMisconceptions(questionMatches);
  }

  return dedupeMisconceptions([
    ...PROBABILITY_STATISTICS_MISCONCEPTIONS.filter(
      (misconception) =>
        (input.topicId === undefined ||
          misconception.topicIds.includes(input.topicId)) &&
        matcherMatches(
          misconception.matcher,
          normalizedAnswer,
          input.studentAnswer,
        ),
    ).map<DetectedMisconception>((misconception) => ({
      ...misconception,
      feedback: `${misconception.explanation} ${misconception.correctiveHint}`,
      source: "library",
    })),
  ]);
}

// Question-authored terms are matched by value, never by substring, whenever
// the term parses as a number: "7/45" no longer fires inside "27/45", "0.6"
// inside "0.625", or "40" inside "5040". A numeric term matches a whole
// numeric token of the student's answer with exactly the same value in any
// notation (fraction, decimal, percent, \frac, unicode fraction), and a
// digits-only term also matches the numerator or denominator of a fraction
// token, so "36" still finds the full sample space in "2/36". Terms that do
// not parse as a number keep the whitespace-insensitive substring match; an
// empty term matches nothing.
const NUMBER = String.raw`(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?`;
const PERCENT = String.raw`(?:\s*(?:\\%|%|percent))?`;
const NUMERIC_TOKEN = new RegExp(
  String.raw`([+−-]\s*)?(?:\\[dt]?frac\s*\{\s*(?:${NUMBER})\s*\}\s*\{\s*(?:${NUMBER})\s*\}|(?:${NUMBER})(?:\s*/\s*(?:${NUMBER}))?|[½¼¾])${PERCENT}`,
  "gi",
);
const NUMBER_ONLY = new RegExp(NUMBER, "gi");
const INTEGER_LITERAL = /^\d+$/;

type NumericToken = { value: Rational; parts: bigint[] };
type QuestionAnswer = { normalized: string; tokens: NumericToken[] };

export function numericTokens(answer: string): NumericToken[] {
  const tokens: NumericToken[] = [];
  for (const match of answer.matchAll(NUMERIC_TOKEN)) {
    let literal = match[0];
    if (match[1]) {
      const beforeSign = answer.slice(0, match.index).trimEnd();
      // Look past whitespace: an operand before the sign makes it binary
      // ("70 - 63", "2-1/2", "x - 1.5"). Start-of-input and delimiters
      // such as "=" or "(" allow one unary sign; sign chains do not.
      if (/[\p{L}\p{N}_.%½¼¾)\]}+−-]$/u.test(beforeSign)) {
        literal = literal.slice(match[1].length);
      }
    }
    const value = parseRational(literal.replaceAll("−", "-"));
    if (!value) {
      continue;
    }
    const numbers = literal.match(NUMBER_ONLY) ?? [];
    tokens.push({
      value,
      parts:
        // Only actual fractions have parts, never mantissas or exponents.
        // Unsigned number captures preserve absolute, unreduced magnitudes.
        /\/|\\[dt]?frac/i.test(literal) && numbers.length === 2
          ? numbers
              .filter((number) => !/[.e]/i.test(number))
              .map((number) => BigInt(number.replaceAll(",", "")))
          : [],
    });
  }
  return tokens;
}

export function questionTermMatches(
  term: string,
  answer: QuestionAnswer,
): boolean {
  const literal = term.trim().replaceAll("−", "-");
  const value = parseRational(literal);
  if (!value) {
    const normalizedTerm = normalizeAnswerText(term);
    return (
      normalizedTerm.length > 0 && answer.normalized.includes(normalizedTerm)
    );
  }
  const integer = INTEGER_LITERAL.test(literal) ? BigInt(literal) : undefined;
  return answer.tokens.some(
    (token) =>
      rationalsEqual(token.value, value) ||
      (integer !== undefined && token.parts.includes(integer)),
  );
}

function detectQuestionMisconceptions(
  answer: QuestionAnswer,
  topicId: string | undefined,
  misconceptions: Misconception[],
) {
  return misconceptions
    .filter((misconception) =>
      misconception.matchTerms.some((term) =>
        questionTermMatches(term, answer),
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
      topicIds: topicId ? [topicId] : [],
    }));
}

function matcherMatches(
  matcher: MisconceptionMatcher,
  normalizedAnswer: string,
  rawAnswer: string,
) {
  // Preserve digit boundaries before whitespace normalization can join numbers.
  const digitTokens = new Set(rawAnswer.split(/[^0-9]+/));
  const matches = (term: string) => {
    const normalized = normalizeAnswerText(term);
    return /^[0-9]+$/.test(normalized)
      ? digitTokens.has(normalized)
      : normalizedAnswer.includes(normalized);
  };
  return (
    (matcher.allTerms ?? []).every(matches) && matcher.anyTerms.some(matches)
  );
}

function dedupeMisconceptions(misconceptions: DetectedMisconception[]) {
  const seen = new Set<string>();

  return misconceptions.filter((misconception) => {
    if (seen.has(misconception.id)) {
      return false;
    }

    seen.add(misconception.id);
    return true;
  });
}
