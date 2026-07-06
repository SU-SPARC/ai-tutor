import { describe, expect, it } from "vitest"

import {
  PROBABILITY_STATISTICS_MISCONCEPTIONS,
  detectMisconceptions,
} from "@/lib/tutor/misconceptions"

describe("probability and statistics misconception library", () => {
  it("includes the required misconception entries with complete metadata", () => {
    const requiredIds = [
      "probability-vs-count",
      "union-vs-intersection",
      "complement-rule-mistake",
      "assuming-independence",
      "conditional-probability-denominator-mistake",
      "bayes-numerator-denominator-confusion",
      "permutations-vs-combinations",
      "expected-value-as-most-likely-value",
      "variance-vs-standard-deviation",
      "binomial-vs-hypergeometric-confusion",
      "normal-approximation-misuse",
      "clt-misunderstanding",
    ]

    expect(PROBABILITY_STATISTICS_MISCONCEPTIONS.map((item) => item.id)).toEqual(
      requiredIds,
    )
    expect(
      PROBABILITY_STATISTICS_MISCONCEPTIONS.every(
        (item) =>
          item.topic &&
          item.explanation &&
          item.correctiveHint &&
          item.matcher.anyTerms.length > 0,
      ),
    ).toBe(true)
  })

  it.each([
    ["probability-vs-count", "My answer is a count of favorable outcomes."],
    ["union-vs-intersection", "For A and B I used P(A)+P(B)."],
    ["complement-rule-mistake", "I forgot to subtract from 1."],
    ["assuming-independence", "I assume independent events and multiply probabilities."],
    ["conditional-probability-denominator-mistake", "I kept the original denominator 36."],
    ["bayes-numerator-denominator-confusion", "I swapped Bayes denominator and base rate."],
    ["permutations-vs-combinations", "I used nPr even though order does not matter."],
    ["expected-value-as-most-likely-value", "The expected is the most likely value."],
    ["variance-vs-standard-deviation", "Variance is standard deviation."],
    ["binomial-vs-hypergeometric-confusion", "I used binomial without replacement."],
    ["normal-approximation-misuse", "Use normal approximation even though np<5."],
    ["clt-misunderstanding", "CLT means individual values normal."],
  ])("detects %s", (expectedId, studentAnswer) => {
    const matches = detectMisconceptions({ studentAnswer })

    expect(matches.map((match) => match.id)).toContain(expectedId)
    expect(matches[0].feedback).toContain(matches[0].correctiveHint)
  })

  it("prioritizes question-specific misconceptions over general library matches", () => {
    const matches = detectMisconceptions({
      questionMisconceptions: [
        {
          feedback:
            "You appear to be counting from all 36 dice outcomes. Restrict the conditional sample space first.",
          id: "uses-full-sample-space",
          matchTerms: ["36", "2/36"],
        },
      ],
      studentAnswer: "2/36",
      topicId: "conditional-probability",
    })

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      id: "uses-full-sample-space",
      source: "question",
      topic: "conditional-probability",
    })
    expect(matches[0].feedback).toContain("all 36 dice outcomes")
  })
})
