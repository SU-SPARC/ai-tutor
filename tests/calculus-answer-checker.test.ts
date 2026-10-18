import { describe, expect, it } from "vitest";

import { checkAnswer } from "@/lib/tutor/answer-checker";
import {
  checkTypedAnswer,
  validateAnswerSpec,
  type AnswerSpec,
} from "@/lib/tutor/answer/spec";
import { toLatex } from "@/lib/tutor/answer/calculus";

const outcome = (student: string, spec: AnswerSpec) =>
  checkTypedAnswer(student, spec).outcome;

function expectGrades(spec: AnswerSpec, accept: string[], reject: string[]) {
  expect(validateAnswerSpec(spec)).toEqual([]);
  for (const answer of accept)
    expect({ answer, outcome: outcome(answer, spec) }).toEqual({
      answer,
      outcome: "correct",
    });
  for (const answer of reject)
    expect({ answer, outcome: outcome(answer, spec) }).not.toEqual({
      answer,
      outcome: "correct",
    });
}

describe("plain text to LaTeX", () => {
  it.each([
    ["sin(x)^2", "\\sin (x)^{2}"],
    ["sqrt(x+1)/x", "\\sqrt{x+1}/x"],
    ["x^(1/2)", "x^{1/2}"],
    ["arcsin(x)", "\\arcsin (x)"],
    ["2pi", "2\\pi "],
    ["3x²", "3x^{2}"],
    ["1/6 x + 3/2", "\\frac{1}{6}x + 3/2"],
  ])("%s", (plain, latex) => {
    expect(toLatex(plain)).toBe(latex);
  });

  it("leaves LaTeX from the math keyboard alone", () => {
    expect(toLatex("\\frac{1}{2\\sqrt{x}}")).toBe("\\frac{1}{2\\sqrt{x}}");
  });
});

describe("expression answers", () => {
  it("accepts every equivalent form of a chain-rule derivative and rejects real mistakes", () => {
    expectGrades(
      {
        kind: "expression",
        value: "-56x\\sin(7x^2+1)\\cos^3(7x^2+1)",
        variables: ["x"],
      },
      [
        "-56x\\sin(7x^2+1)\\cos^3(7x^2+1)",
        "-56x\\sin\\left(7x^2+1\\right)\\cos^{3}\\left(7x^2+1\\right)",
        "-56 x sin(7x^2+1) cos(7x^2+1)^3",
        "-56*x*sin(7*x^2+1)*cos(7*x^2+1)^3",
        "-28x\\sin(14x^2+2)\\cos^2(7x^2+1)",
        "\\frac{-56x\\sin(7x^2+1)}{\\sec^3(7x^2+1)}",
      ],
      [
        "56x\\sin(7x^2+1)\\cos^3(7x^2+1)",
        "-8\\sin(7x^2+1)\\cos^3(7x^2+1)",
        "-56x\\sin(7x^2+1)\\cos^2(7x^2+1)",
        "4\\cos^3(7x^2+1)",
        "\\cos^4(7x^2+1)",
      ],
    );
  });

  it("treats expanded, factored and reordered polynomials as equal", () => {
    expectGrades(
      { kind: "expression", value: "2x^2+2x", variables: ["x"] },
      ["2x(x+1)", "2x+2x^2", "2(x^2+x)", "x\\cdot 2(1+x)", "2*x*(x+1)"],
      ["2x^2+x", "2x(x-1)", "x^2+2x", "4x+2"],
    );
  });

  it("accepts power, root and quotient forms of the same derivative", () => {
    expectGrades(
      {
        kind: "expression",
        value: "\\frac{1}{2\\sqrt{x}}",
        variables: ["x"],
        sample: { min: 0.1, max: 5 },
      },
      [
        "\\frac{1}{2}x^{-1/2}",
        "0.5x^{-0.5}",
        "1/(2sqrt(x))",
        "\\frac{\\sqrt{x}}{2x}",
      ],
      ["2\\sqrt{x}", "\\frac{1}{\\sqrt{x}}", "\\frac{1}{2}x^{1/2}"],
    );
  });

  it("respects the question's domain for logarithm identities", () => {
    // ln(x^2) and 2 ln x agree only for x > 0.
    const positive: AnswerSpec = {
      kind: "expression",
      value: "\\ln(x^2)",
      variables: ["x"],
      sample: { min: 0.2, max: 6 },
    };
    expect(outcome("2\\ln x", positive)).toBe("correct");
    const allReals: AnswerSpec = {
      kind: "expression",
      value: "\\ln(x^2)",
      variables: ["x"],
    };
    expect(outcome("2\\ln x", allReals)).toBe("incorrect");
    expect(outcome("2\\ln|x|", allReals)).toBe("correct");
  });

  it("reads a bare log as either natural or base-10 log", () => {
    const spec: AnswerSpec = {
      kind: "expression",
      value: "\\frac{1}{x}+\\ln x",
      variables: ["x"],
      sample: { min: 0.3, max: 5 },
    };
    expect(outcome("1/x + log(x)", spec)).toBe("correct");
    expect(outcome("1/x + ln(x)", spec)).toBe("correct");
  });

  it("checks exact constants and flags rounded decimals", () => {
    const spec: AnswerSpec = {
      kind: "expression",
      value: "\\frac{\\pi}{4}",
      variables: [],
    };
    expectGrades(
      spec,
      ["\\frac{\\pi}{4}", "pi/4", "0.785398163397448", "\\arctan(1)"],
      ["0.75", "\\frac{\\pi}{2}"],
    );
    const rounded = checkTypedAnswer("0.785", spec);
    expect(rounded.outcome).toBe("incorrect");
    expect(rounded.detail).toBe("close_rounding");
    expect(rounded.feedback).toMatch(/exact value/);
  });

  it("accepts rounded decimals when the question allows approximation", () => {
    const spec: AnswerSpec = {
      kind: "expression",
      value: "\\sqrt{2}",
      variables: [],
      approximateRelative: 0.001,
    };
    expectGrades(spec, ["1.414", "\\sqrt 2", "2^{1/2}"], ["1.41", "1.5"]);
  });

  it("ignores units written after a numeric answer", () => {
    expectGrades(
      { kind: "expression", value: "\\frac{25}{19\\pi}", variables: [] },
      [
        "\\frac{25}{19\\pi}",
        "25/(19pi) ft/min",
        "25/(19 pi) ft per min",
        "\\frac{25}{19\\pi}\\text{ ft/min}",
      ],
      ["25/19 ft/min", "\\frac{25}{19} ft/min", "0.418828 ft/min"],
    );
    expectGrades(
      { kind: "expression", value: "2\\sqrt{3}", variables: [] },
      ["2sqrt(3) ft/sec", "2\\sqrt{3} ft/s", "sqrt(12) feet/sec"],
      ["2 ft/sec", "3 ft/s"],
    );
  });

  it("ignores a leading name such as f'(x) =, y = or dy/dx =", () => {
    expectGrades(
      { kind: "expression", value: "2x\\cos(x^2)", variables: ["x"] },
      [
        "f'(x) = 2x cos(x^2)",
        "y' = 2x\\cos(x^2)",
        "\\frac{dy}{dx} = 2x\\cos\\left(x^2\\right)",
        "dy/dx = 2x cos(x^2)",
        "g^{\\prime}(x)=2x\\cos(x^2)",
      ],
      ["f'(x) = \\cos(x^2)", "y = 2x"],
    );
    expect(
      outcome("A = 9 square units", {
        kind: "expression",
        value: "9",
        variables: [],
      }),
    ).toBe("correct");
    expect(
      outcome("8.03125 sq ft", {
        kind: "expression",
        value: "\\frac{257}{32}",
        variables: [],
      }),
    ).toBe("correct");
  });

  it("handles infinite limits", () => {
    const spec: AnswerSpec = {
      kind: "expression",
      value: "\\infty",
      variables: [],
    };
    expectGrades(
      spec,
      ["\\infty", "inf", "infinity", "∞", "+\\infty"],
      ["-\\infty", "DNE", "0"],
    );
  });

  it("rejects answers that use undeclared variables", () => {
    const result = checkTypedAnswer("2y", {
      kind: "expression",
      value: "2x",
      variables: ["x"],
    });
    expect(result.outcome).toBe("incorrect");
    expect(result.feedback).toMatch(/y/);
  });

  it("calls malformed input unreadable instead of wrong", () => {
    expect(
      outcome("3x+", { kind: "expression", value: "3x", variables: ["x"] }),
    ).toBe("unreadable");
  });
});

describe("antiderivatives", () => {
  const spec: AnswerSpec = {
    kind: "antiderivative",
    value: "\\sin^2 x",
    variable: "x",
    constant: "optional",
  };

  it("accepts any antiderivative, with or without + C", () => {
    expectGrades(
      spec,
      [
        "\\sin^2 x",
        "\\sin^2 x + C",
        "-\\frac{1}{2}\\cos(2x)",
        "-\\frac{1}{2}\\cos 2x + C",
        "-\\cos^2 x + 7",
        "sin(x)^2 + K",
      ],
      ["2\\sin x\\cos x", "\\cos^2 x", "\\sin x"],
    );
  });

  it("can require the constant of integration", () => {
    const strict: AnswerSpec = { ...spec, constant: "required" } as AnswerSpec;
    expect(outcome("\\sin^2 x + C", strict)).toBe("correct");
    const missing = checkTypedAnswer("\\sin^2 x", strict);
    expect(missing.outcome).toBe("incorrect");
    expect(missing.feedback).toMatch(/\+ C/);
  });

  it("handles ln|x| on the stated domain", () => {
    expectGrades(
      {
        kind: "antiderivative",
        value: "\\ln|x|",
        variable: "x",
        constant: "optional",
        sample: { min: 0.2, max: 6 },
      },
      ["\\ln x + C", "\\ln|x|", "\\ln(3x)", "log(x)"],
      ["\\frac{1}{x}", "-\\frac{1}{x^2}"],
    );
  });
});

describe("equations", () => {
  const tangent: AnswerSpec = {
    kind: "equation",
    value: "y = 4x - 3",
    variables: ["x", "y"],
    acceptExpressionFor: "y",
  };

  it("accepts any equivalent form of the same line", () => {
    expectGrades(
      tangent,
      [
        "y = 4x - 3",
        "y - 1 = 4(x - 1)",
        "4x - y = 3",
        "y=-3+4x",
        "2y = 8x - 6",
        "4x-3",
        "y=4*x-3",
      ],
      ["y = 4x + 3", "y = 3x - 3", "y - 1 = 4(x + 1)", "y = 4x"],
    );
  });

  it("asks for an equation when the bare expression is not allowed", () => {
    const strict: AnswerSpec = {
      kind: "equation",
      value: "y = 4x - 3",
      variables: ["x", "y"],
    };
    expect(outcome("4x - 3", strict)).toBe("unreadable");
  });
});

describe("intervals", () => {
  const inc: AnswerSpec = {
    kind: "interval",
    value: "(-\\infty,-2)\\cup(0,\\infty)",
    endpoints: "ignore",
  };

  it("accepts interval, union and inequality notations", () => {
    expectGrades(
      inc,
      [
        "(-\\infty,-2)\\cup(0,\\infty)",
        "\\left(-\\infty,-2\\right)\\cup\\left(0,\\infty\\right)",
        "(-inf,-2) U (0,inf)",
        "(0, inf) ∪ (-∞, -2)",
        "(-∞,-2] ∪ [0,∞)",
        "x < -2 or x > 0",
        "x<-2, x>0",
      ],
      ["(-\\infty,-2)", "(-\\infty,2)\\cup(0,\\infty)", "(-2,0)", "none"],
    );
  });

  it("enforces brackets when endpoints matter, with a helpful note", () => {
    const domain: AnswerSpec = {
      kind: "interval",
      value: "[5,\\infty)",
      endpoints: "strict",
    };
    expect(outcome("[5, inf)", domain)).toBe("correct");
    expect(outcome("x \\ge 5", domain)).toBe("correct");
    const open = checkTypedAnswer("(5, inf)", domain);
    expect(open.outcome).toBe("incorrect");
    expect(open.feedback).toMatch(/endpoint/);
  });

  it("reads bounded inequalities and the empty set", () => {
    expectGrades(
      { kind: "interval", value: "(-1,3]", endpoints: "strict" },
      ["(-1,3]", "-1 < x \\le 3", "-1<x<=3", "3 >= x > -1"],
      ["[-1,3]", "(-1,3)"],
    );
    expectGrades(
      { kind: "interval", value: "\\emptyset", endpoints: "strict" },
      ["none", "∅", "\\emptyset"],
      ["(0,1)"],
    );
  });
});

describe("lists of numbers, expressions and points", () => {
  it("accepts critical numbers in any order and notation", () => {
    expectGrades(
      {
        kind: "expression_list",
        values: ["-\\frac{5}{4}", "1"],
        ordered: false,
        variables: [],
      },
      [
        "x = -5/4, 1",
        "1, -\\frac{5}{4}",
        "x=1 and x=-1.25",
        "\\{-\\frac54, 1\\}",
        "-5/4; 1",
      ],
      ["-5/4", "1, 5/4", "-5/4, 1, 0"],
    );
  });

  it("compares points coordinate by coordinate", () => {
    expectGrades(
      {
        kind: "expression_list",
        values: ["(-\\frac{1}{2},-\\frac{81}{16})", "(1,0)"],
        ordered: false,
        variables: [],
      },
      ["(1, 0), (-1/2, -81/16)", "(-0.5, -5.0625), (1, 0)"],
      ["(1,0)", "(-1/2, 81/16), (1, 0)"],
    );
  });

  it("accepts 'none' only when the answer is empty", () => {
    expect(
      outcome("none", {
        kind: "expression_list",
        values: [],
        ordered: false,
        variables: [],
      }),
    ).toBe("correct");
    expect(
      outcome("none", {
        kind: "expression_list",
        values: ["2"],
        ordered: false,
        variables: [],
      }),
    ).toBe("incorrect");
  });
});

describe("forms reported while writing the question rules", () => {
  it("reads plain-text logs, roots and exponents", () => {
    expectGrades(
      { kind: "expression", value: "\\frac{\\ln 2}{\\ln 5}", variables: [] },
      ["ln2/ln5", "x = ln(2)/ln(5)", "log_5(2)", "\\log_{5}2"],
      ["ln5/ln2", "2/5"],
    );
    expectGrades(
      { kind: "expression", value: "10^{4/3}", variables: [] },
      ["10*cbrt(10)", "10^(4/3)", "\\sqrt[3]{10^4}"],
      ["10^(3/4)", "10*sqrt(10)"],
    );
    expectGrades(
      { kind: "expression", value: "2^{1/5}", variables: [] },
      ["2^0.2", "x = 2^0.2", "2^(1/5)"],
      ["2^2", "0.2"],
    );
  });

  it("strips labels and units in more forms", () => {
    expectGrades(
      {
        kind: "expression",
        value: "\\frac{2x}{x-3}",
        variables: ["x"],
        sample: { min: 3.5, max: 9 },
      },
      ["f^{-1}(x) = 2x/(x-3)", "2x/(x-3)"],
      ["(x-3)/(2x)"],
    );
    expectGrades(
      { kind: "expression", value: "8.5", variables: [] },
      ["m = 8.5", "m_sec = 8.5", "8.5 ft/s", "f'(1) = 8.5"],
      ["8", "-8.5"],
    );
    expectGrades(
      { kind: "expression", value: "-1.6", variables: [] },
      ["-1.6 °F/h", "-1.6 degrees F per hour", "-1.6"],
      ["1.6 °F/h"],
    );
    expectGrades(
      { kind: "expression", value: "0.63x", variables: ["x"] },
      ["0.63x dollars", "0.63x"],
      ["0.63"],
    );
    expectGrades(
      { kind: "expression", value: "24300", variables: [] },
      ["24,300", "24{,}300", "24300"],
      ["24,301", "243"],
    );
  });

  it("reads ±, logs, units and rounding inside lists", () => {
    expectGrades(
      {
        kind: "expression_list",
        values: ["1", "-1"],
        ordered: false,
        variables: [],
      },
      ["x = ±1", "x = \\pm 1", "-1, 1"],
      ["1", "±2"],
    );
    expectGrades(
      {
        kind: "expression_list",
        values: ["\\ln 2"],
        ordered: false,
        variables: [],
      },
      ["x = log(2)", "ln 2"],
      ["2"],
    );
    expectGrades(
      {
        kind: "expression_list",
        values: ["141.4", "140.14"],
        ordered: true,
        variables: [],
      },
      ["141.4 ft/s, 140.14 ft/s", "141.4, 140.14 ft/s"],
      ["140.14, 141.4"],
    );
    expectGrades(
      {
        kind: "expression_list",
        values: ["24.1199", "24.0119", "24.0012"],
        ordered: true,
        variables: [],
        approximateRelative: 0.001,
      },
      ["24.12, 24.01, 24", "24.1199, 24.0119, 24.0012"],
      ["24.2, 24.01, 24"],
    );
  });

  it("reads 'none' phrasings, not-equal intervals and DNE with a reason", () => {
    expect(
      outcome("no horizontal asymptote", {
        kind: "expression_list",
        values: [],
        ordered: false,
        variables: [],
      }),
    ).toBe("correct");
    expectGrades(
      {
        kind: "interval",
        value: "(-\\infty,\\frac12)\\cup(\\frac12,\\infty)",
        endpoints: "strict",
      },
      ["x ≠ 1/2", "x != 1/2", "x \\ne \\frac{1}{2}"],
      ["x ≠ 2", "R"],
    );
    expectGrades(
      { kind: "interval", value: "(-\\infty,\\infty)", endpoints: "strict" },
      ["R", "\\mathbb{R}", "all real numbers"],
      ["(0,\\infty)"],
    );
    expectGrades(
      { kind: "dne" },
      ["does not exist since 5 ≠ 1", "DNE because the one-sided limits differ"],
      ["5"],
    );
  });
});

describe("forms reported for topics 13–15", () => {
  it("handles infinity inside lists", () => {
    expectGrades(
      {
        kind: "expression_list",
        values: ["\\infty", "-\\infty"],
        ordered: true,
        variables: [],
      },
      ["inf, -inf", "\\infty, -\\infty"],
      ["-inf, inf", "0, inf"],
    );
  });

  it("accepts rounded interval endpoints when allowed", () => {
    expectGrades(
      {
        kind: "interval",
        value: "(0, 4\\cdot 2^{4/3})",
        endpoints: "ignore",
        approximateRelative: 0.001,
      },
      ["(0, 10.08)", "(0, 8cbrt(2))", "0 < x < 10.079"],
      ["(0, 10.2)"],
    );
  });

  it("reads comma-separated intervals and 'x in'", () => {
    const spec: AnswerSpec = {
      kind: "interval",
      value: "(-\\infty,-2)\\cup(0,\\infty)",
      endpoints: "ignore",
    };
    expectGrades(
      spec,
      ["(-inf,-2), (0,inf)", "x in (-inf,-2) U (0,inf)", "x ∈ (-∞,-2) ∪ (0,∞)"],
      ["(-inf,-2), (0,1)"],
    );
  });

  it("does not mistake mathematics for a part label", () => {
    const spec: AnswerSpec = {
      kind: "parts",
      parts: [
        { label: "d", spec: { kind: "expression", value: "1", variables: [] } },
        {
          label: "e",
          spec: { kind: "interval", value: "(0, e)", endpoints: "strict" },
        },
      ],
    };
    expect(outcome("(d) 1; (e) (0, e)", spec)).toBe("correct");
  });
});

describe("forms reported for topics 7–12", () => {
  it("strips rate labels and \\text units", () => {
    expectGrades(
      { kind: "expression", value: "\\frac{1}{10}", variables: [] },
      [
        "dθ/dt = 1/10",
        "\\frac{d\\theta}{dt} = \\frac{1}{10}",
        "\\frac{1}{10}\\text{rad/sec}",
        "(f^{-1})'(-3) = 1/10",
        "v(1) = 1/10",
      ],
      ["10", "-1/10"],
    );
    expectGrades(
      { kind: "expression", value: "24", variables: [] },
      ["24 \\text{m}^3/\\text{s}", "24\\text{ m}^3\\text{/sec}", "24 m^3/s"],
      ["25 m^3/s"],
    );
  });

  it("reads 'a = 6, b = -9' as labelled parts and 'x = 9, y = 729' as a point", () => {
    const parts: AnswerSpec = {
      kind: "parts",
      parts: [
        { label: "a", spec: { kind: "expression", value: "6", variables: [] } },
        {
          label: "b",
          spec: { kind: "expression", value: "-9", variables: [] },
        },
      ],
    };
    expectGrades(
      parts,
      ["a = 6, b = -9", "b = -9, a = 6", "(a) 6; (b) -9"],
      ["a = -9, b = 6"],
    );
    expectGrades(
      {
        kind: "expression_list",
        values: ["(9, 729)"],
        ordered: false,
        variables: [],
      },
      ["x = 9, y = 729", "(9, 729)"],
      ["(729, 9)"],
    );
  });
});

describe("numeric fraction coefficients", () => {
  it("reads 5/3(x - 5) as (5/3)(x - 5), as calculators do", () => {
    expectGrades(
      {
        kind: "equation",
        value: "y - 3 = \\frac{5}{3}(x - 5)",
        variables: ["x", "y"],
        acceptExpressionFor: "y",
      },
      ["y - 3 = 5/3(x - 5)", "y - 3 = 5/3 (x - 5)", "y = 5/3 x - 16/3"],
      ["y - 3 = 3/5(x - 5)", "y = 5/(3(x - 5)) + 3"],
    );
    // A slash followed by a parenthesised denominator is still division.
    expectGrades(
      {
        kind: "expression",
        value: "\\frac{1}{2x}",
        variables: ["x"],
        sample: { min: 0.2, max: 5 },
      },
      ["1/(2x)"],
      ["x/2"],
    );
  });
});

describe("does-not-exist answers", () => {
  it("accepts the usual phrasings", () => {
    expectGrades(
      { kind: "dne" },
      [
        "DNE",
        "does not exist",
        "Doesn't exist",
        "\\text{DNE}",
        "the limit does not exist",
      ],
      ["0", "\\infty"],
    );
  });
});

describe("multi-part answers", () => {
  const spec: AnswerSpec = {
    kind: "parts",
    parts: [
      {
        label: "a",
        spec: {
          kind: "equation",
          value: "y = \\frac{1}{6}x + \\frac{3}{2}",
          variables: ["x", "y"],
          acceptExpressionFor: "y",
        },
      },
      {
        label: "b",
        spec: {
          kind: "expression",
          value: "\\frac{1}{6}\\cdot 9.1 + \\frac{3}{2}",
          variables: [],
          approximateRelative: 0.0005,
        },
      },
    ],
  };

  it("grades each labelled part with its own rule", () => {
    expectGrades(
      spec,
      [
        "(a) y = x/6 + 3/2; (b) 3.0167",
        "a) L(x)=3+(x-9)/6 b) 3.01667",
        "(b) 3.01667 (a) y = 1/6 x + 1.5",
        "y = x/6 + 1.5; 3.0167",
      ],
      ["(a) y = x/6 + 3/2; (b) 3", "(a) y = x/6; (b) 3.0167"],
    );
  });

  it("says which part is wrong", () => {
    const res = checkTypedAnswer("(a) y = x/6 + 3/2; (b) 3", spec);
    expect(res.outcome).toBe("incorrect");
    expect(res.feedback).toMatch(/\(a\) correct; \(b\) not quite/);
  });

  it("asks for every part when one is missing", () => {
    const res = checkTypedAnswer("y = x/6 + 3/2", spec);
    expect(res.outcome).toBe("unreadable");
    expect(res.feedback).toMatch(/\(a\).*\(b\)/);
  });
});

describe("spec validation", () => {
  it("rejects malformed calculus specs", () => {
    expect(
      validateAnswerSpec({
        kind: "expression",
        value: "3x+",
        variables: ["x"],
      }),
    ).not.toEqual([]);
    expect(
      validateAnswerSpec({
        kind: "expression",
        value: "2x",
        variables: ["xy"],
      }),
    ).not.toEqual([]);
    expect(
      validateAnswerSpec({
        kind: "interval",
        value: "(3,1)",
        endpoints: "strict",
      }),
    ).not.toEqual([]);
    expect(
      validateAnswerSpec({
        kind: "parts",
        parts: [{ label: "a", spec: { kind: "dne" } }],
      }),
    ).not.toEqual([]);
    expect(
      validateAnswerSpec({
        kind: "expression",
        value: "\\sqrt{x}",
        variables: ["x"],
        sample: { min: -9, max: -1 },
      }),
    ).not.toEqual([]);
  });

  it("requires accepted answers to pass the rule", () => {
    const spec = { kind: "expression", value: "2x", variables: ["x"] };
    expect(validateAnswerSpec(spec, ["2x", "x+x"])).toEqual([]);
    expect(validateAnswerSpec(spec, ["3x"]).map((i) => i.code)).toContain(
      "accepted_answer_inconsistent",
    );
  });
});

describe("integration with the tutor answer checker", () => {
  it("routes through checkAnswer when a calculus spec is present", () => {
    const res = checkAnswer({
      studentAnswer: "2x(x+1)",
      acceptedAnswers: ["2x^2+2x"],
      spec: { kind: "expression", value: "2x^2+2x", variables: ["x"] },
    });
    expect(res.isCorrect).toBe(true);
  });

  it("leaves numeric probability checking unchanged", () => {
    const res = checkAnswer({
      studentAnswer: "7/12",
      acceptedAnswers: ["7/12"],
    });
    expect(res.isCorrect).toBe(true);
  });
});
