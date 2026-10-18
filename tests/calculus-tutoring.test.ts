import { describe, expect, it } from "vitest";

import { inputFormatHintFor } from "@/lib/api/question-serialization";
import {
  misconceptionTermMatches,
  revealedAnswerFragment,
  validateAnswerSpec,
  type AnswerSpec,
} from "@/lib/tutor/answer/spec";
import { detectMisconceptions } from "@/lib/tutor/misconceptions";
import { checkStudentAttempt } from "@/lib/tutor/tutor-engine";
import type { PracticeQuestion } from "@/lib/types";

const derivative: AnswerSpec = {
  kind: "expression",
  value: "2x\\cos(x^2)",
  variables: ["x"],
};

describe("common-mistake terms for calculus rules", () => {
  it("matches any form equivalent to the wrong answer", () => {
    expect(misconceptionTermMatches("cos(x^2)", derivative, "\\cos(x^2)")).toBe(
      true,
    );
    expect(
      misconceptionTermMatches(
        "\\cos\\left(x^{2}\\right)",
        derivative,
        "\\cos(x^2)",
      ),
    ).toBe(true);
    expect(
      misconceptionTermMatches("2x cos(x^2)", derivative, "\\cos(x^2)"),
    ).toBe(false);
    expect(
      misconceptionTermMatches("-2x\\sin(x^2)", derivative, "\\cos(x^2)"),
    ).toBe(false);
  });

  it("works for antiderivatives, lines, intervals and lists", () => {
    const anti: AnswerSpec = {
      kind: "antiderivative",
      value: "\\frac{1}{3}\\sin(3x)",
      variable: "x",
      constant: "optional",
    };
    expect(misconceptionTermMatches("sin(3x) + C", anti, "\\sin(3x)")).toBe(
      true,
    );
    expect(misconceptionTermMatches("sin(3x)/3", anti, "\\sin(3x)")).toBe(
      false,
    );

    const line: AnswerSpec = {
      kind: "equation",
      value: "y = 4x - 3",
      variables: ["x", "y"],
      acceptExpressionFor: "y",
    };
    expect(
      misconceptionTermMatches("y - 1 = 4(x + 1)", line, "y = 4x + 5"),
    ).toBe(true);
    expect(misconceptionTermMatches("4x+5", line, "4x+5")).toBe(true);

    const inc: AnswerSpec = {
      kind: "interval",
      value: "(0,\\infty)",
      endpoints: "ignore",
    };
    expect(misconceptionTermMatches("x < 0", inc, "(-\\infty, 0)")).toBe(true);

    const crit: AnswerSpec = {
      kind: "expression_list",
      values: ["-1", "1"],
      ordered: false,
      variables: [],
    };
    expect(misconceptionTermMatches("x = 1", crit, "1")).toBe(true);
    expect(misconceptionTermMatches("1, -1", crit, "1")).toBe(false);
  });

  it("handles DNE and value mix-ups in both directions", () => {
    const dne: AnswerSpec = { kind: "dne" };
    expect(misconceptionTermMatches("1", dne, "1")).toBe(true);
    expect(misconceptionTermMatches("does not exist", dne, "1")).toBe(false);
    const zero: AnswerSpec = { kind: "expression", value: "0", variables: [] };
    expect(misconceptionTermMatches("DNE", zero, "DNE")).toBe(true);
    expect(
      misconceptionTermMatches("does not exist", zero, "does not exist"),
    ).toBe(true);
    expect(misconceptionTermMatches("0", zero, "DNE")).toBe(false);
  });

  it("lets a wrong answer use a variable when the right answer is a constant", () => {
    const zero: AnswerSpec = { kind: "expression", value: "0", variables: [] };
    expect(misconceptionTermMatches("x^2", zero, "x^2")).toBe(true);
    expect(misconceptionTermMatches("x*x", zero, "x^2")).toBe(true);
    expect(misconceptionTermMatches("0", zero, "x^2")).toBe(false);
  });

  it("targets one part of a multi-part answer", () => {
    const parts: AnswerSpec = {
      kind: "parts",
      parts: [
        {
          label: "a",
          spec: { kind: "expression", value: "6", variables: [] },
          description: "the slope at x = 3",
        },
        {
          label: "b",
          spec: {
            kind: "equation",
            value: "y = 6x - 9",
            variables: ["x", "y"],
            acceptExpressionFor: "y",
          },
        },
      ],
    };
    expect(
      misconceptionTermMatches("(a) 6; (b) y = 6x", parts, "(b) y = 6x"),
    ).toBe(true);
    expect(
      misconceptionTermMatches("(a) 6; (b) y = 6x - 9", parts, "(b) y = 6x"),
    ).toBe(false);
    expect(
      misconceptionTermMatches("(a) 9; (b) y = 6x - 9", parts, "(a) 9"),
    ).toBe(true);
    // An unlabelled term cannot be placed in a part.
    expect(
      misconceptionTermMatches("(a) 9; (b) y = 6x - 9", parts, "9"),
    ).toBeUndefined();
  });

  it("leaves number and word questions to the existing matcher", () => {
    const numeric: AnswerSpec = {
      kind: "numeric",
      value: "0.5",
      domain: "probability",
      percentMode: "either",
      tolerance: { mode: "exact" },
    };
    expect(misconceptionTermMatches("0.25", numeric, "0.25")).toBeUndefined();
    expect(
      misconceptionTermMatches("x", derivative, "forgot the chain rule"),
    ).toBeUndefined();
  });
});

describe("leak detection", () => {
  it("finds a hint fragment the answer rule would accept", () => {
    expect(
      revealedAnswerFragment("So $f'(x) = 2x\\cos(x^2)$.", derivative),
    ).toBeDefined();
    expect(
      revealedAnswerFragment(
        "Let $u = x^2$, so $\\frac{du}{dx} = 2x$.",
        derivative,
      ),
    ).toBeUndefined();
    expect(
      revealedAnswerFragment(
        "Use the chain rule on $\\sin(u)$ with $u = x^2$.",
        derivative,
      ),
    ).toBeUndefined();
  });

  it("checks every part and ignores categorical answers", () => {
    const parts: AnswerSpec = {
      kind: "parts",
      parts: [
        {
          label: "a",
          spec: {
            kind: "expression_list",
            values: ["2"],
            ordered: false,
            variables: [],
          },
        },
        {
          label: "b",
          spec: {
            kind: "categorical",
            canonical: "local minimum",
            aliases: [],
          },
        },
      ],
    };
    expect(
      revealedAnswerFragment("Solve $f'(x) = 0$ to get $x = 2$.", parts),
    ).toBe("x = 2");
    expect(
      revealedAnswerFragment("Check the sign of $f'$ on each side.", parts),
    ).toBeUndefined();
  });

  it("does not inspect number and word rules", () => {
    expect(
      revealedAnswerFragment("$7/12$", {
        kind: "numeric",
        value: "7/12",
        domain: "probability",
        percentMode: "either",
        tolerance: { mode: "exact" },
      }),
    ).toBeUndefined();
  });
});

describe("part descriptions", () => {
  const base = { label: "a", spec: { kind: "dne" } };
  const second = { label: "b", spec: { kind: "dne" } };

  it("accepts a short plain description and rejects math, newlines and long text", () => {
    expect(
      validateAnswerSpec({
        kind: "parts",
        parts: [{ ...base, description: "the limit from the left" }, second],
      }),
    ).toEqual([]);
    expect(
      validateAnswerSpec({
        kind: "parts",
        parts: [{ ...base, description: "the value $L$" }, second],
      }),
    ).not.toEqual([]);
    expect(
      validateAnswerSpec({
        kind: "parts",
        parts: [{ ...base, description: "two\nlines" }, second],
      }),
    ).not.toEqual([]);
    expect(
      validateAnswerSpec({
        kind: "parts",
        parts: [{ ...base, description: "x".repeat(161) }, second],
      }),
    ).not.toEqual([]);
  });

  it("shows descriptions in the answer-format hint", () => {
    expect(
      inputFormatHintFor({
        acceptedAnswers: ["(a) DNE; (b) DNE"],
        explanation: "x",
        spec: {
          kind: "parts",
          parts: [
            {
              label: "a",
              spec: { kind: "dne" },
              description: "the limit from the left",
            },
            { label: "b", spec: { kind: "dne" } },
          ],
        },
      }),
    ).toBe(
      "Label each part and separate them with semicolons: (a) the limit from the left; (b) ….",
    );
  });
});

describe("tutor integration", () => {
  const question: PracticeQuestion = {
    id: "calc-test-chain",
    topicId: "calc1-product-quotient-chain-rules",
    title: "Chain rule",
    difficulty: "foundational",
    prompt: "Differentiate $\\sin(x^2)$.",
    answer: {
      acceptedAnswers: ["2x\\cos(x^2)"],
      explanation: "$2x\\cos(x^2)$",
      spec: derivative,
    },
    hints: ["Treat $\\sin(x^2)$ as an outer function of an inner function."],
    solutionSteps: ["Chain rule: $\\cos(x^2)\\cdot 2x$."],
    misconceptions: [
      {
        id: "missing-inner-derivative",
        feedback:
          "You differentiated the outer function but not the inside. Multiply by the derivative of the inner function.",
        matchTerms: ["\\cos(x^2)"],
      },
      {
        id: "wrong-sign",
        feedback: "The derivative of sine is cosine, not negative sine.",
        matchTerms: ["-2x\\cos(x^2)", "-\\cos(x^2)"],
      },
    ],
    review: { status: "approved" },
    source: {
      sourceType: "original_demo",
      trustLevel: "public_original",
      visibility: "public",
    },
  };

  it("names the mistake for an equivalent wrong answer", () => {
    const check = checkStudentAttempt(question, "cos(x**2)");
    expect(check.answerCheck.isCorrect).toBe(false);
    expect(check.misconception?.id).toBe("missing-inner-derivative");
    expect(
      checkStudentAttempt(question, "-2*x*cos(x^2)").misconception?.id,
    ).toBe("wrong-sign");
  });

  it("never flags a correct answer or an unrelated wrong one", () => {
    expect(
      checkStudentAttempt(question, "2x cos(x^2)").misconception,
    ).toBeUndefined();
    expect(checkStudentAttempt(question, "x^3").misconception).toBeUndefined();
  });

  it("keeps text matching for questions without a calculus rule", () => {
    const found = detectMisconceptions({
      questionMisconceptions: [
        { id: "full-space", feedback: "Condition first.", matchTerms: ["36"] },
      ],
      studentAnswer: "5/36",
      topicId: "conditional-probability",
    });
    expect(found.map((m) => m.id)).toContain("full-space");
  });
});
