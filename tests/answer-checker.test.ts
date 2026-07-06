import { describe, expect, it } from "vitest"

import {
  checkAnswer,
  normalizeAnswerText,
  parseAnswerNumber,
} from "@/lib/tutor/answer-checker"

describe("rule-based answer checker", () => {
  it("accepts exact text matches with whitespace and case normalization", () => {
    const result = checkAnswer({
      acceptedAnswers: ["Mutually Exclusive"],
      studentAnswer: "  mutually   exclusive ",
    })

    expect(result).toMatchObject({
      confidence: 1,
      isCorrect: true,
      normalizedExpectedAnswer: "mutuallyexclusive",
      normalizedStudentAnswer: "mutuallyexclusive",
    })
    expect(result.feedback).toContain("matches")
  })

  it("treats decimals, fractions, and percentages as equivalent", () => {
    const expected = {
      acceptedAnswers: ["1/2"],
      numericValue: 0.5,
      tolerance: 0.0001,
    }

    for (const studentAnswer of ["0.5", "1/2", "50%"]) {
      const result = checkAnswer({
        ...expected,
        studentAnswer,
      })

      expect(result.isCorrect).toBe(true)
      expect(result.confidence).toBeGreaterThanOrEqual(0.98)
      expect(result.normalizedExpectedAnswer).toBe("1/2")
    }
  })

  it("parses simple LaTeX wrappers and fraction commands", () => {
    const expected = {
      acceptedAnswers: ["0.5"],
      numericValue: 0.5,
      tolerance: 0.0001,
    }

    expect(
      checkAnswer({
        ...expected,
        studentAnswer: "\\(\\frac{1}{2}\\)",
      }).isCorrect,
    ).toBe(true)
    expect(
      checkAnswer({
        ...expected,
        studentAnswer: "$50\\%$",
      }).isCorrect,
    ).toBe(true)
    expect(parseAnswerNumber("\\[\\dfrac{1}{2}\\]")).toBe(0.5)
  })

  it("uses numeric tolerance for rounded decimal answers", () => {
    const close = checkAnswer({
      acceptedAnswers: ["135/512"],
      numericValue: 0.263671875,
      studentAnswer: "0.2637",
      tolerance: 0.001,
    })
    const outsideTolerance = checkAnswer({
      acceptedAnswers: ["135/512"],
      numericValue: 0.263671875,
      studentAnswer: "0.27",
      tolerance: 0.001,
    })

    expect(close.isCorrect).toBe(true)
    expect(close.feedback).toContain("numerically equivalent")
    expect(outsideTolerance.isCorrect).toBe(false)
    expect(outsideTolerance.feedback).toContain("numeric value")
  })

  it("returns low-confidence feedback for unmatched nonnumeric answers", () => {
    const result = checkAnswer({
      acceptedAnswers: ["independent"],
      studentAnswer: "dependent",
    })

    expect(result).toMatchObject({
      confidence: 0.1,
      isCorrect: false,
      normalizedExpectedAnswer: "independent",
      normalizedStudentAnswer: "dependent",
    })
  })

  it("normalizes simple LaTeX text wrappers", () => {
    expect(normalizeAnswerText("\\text{ Independent }")).toBe("independent")
  })
})
