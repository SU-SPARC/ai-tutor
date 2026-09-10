import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { checkAnswer } from "@/lib/tutor/answer-checker";
import {
  checkTypedAnswer,
  validateAnswerSpec,
  type AnswerSpec,
  type NumericAnswerSpec,
  type ToleranceSpec,
} from "@/lib/tutor/answer/spec";

const numeric = (
  change: Partial<NumericAnswerSpec> = {},
): NumericAnswerSpec => ({
  kind: "numeric",
  value: "0.5",
  domain: "real",
  percentMode: "either",
  tolerance: { mode: "exact" },
  ...change,
});
const category: AnswerSpec = {
  kind: "categorical",
  canonical: "seven",
  aliases: ["7", "seven"],
};
const list: AnswerSpec = {
  kind: "number_list",
  values: ["0.1", "0.6", "0.3"],
  ordered: true,
  tolerance: { mode: "exact" },
};
function check(answer: string, spec: AnswerSpec) {
  return checkAnswer({ acceptedAnswers: [], spec, studentAnswer: answer });
}

describe("typed numeric gold cases", () => {
  it("interprets percent markers inside math wrappers and reduces scaled canonical fractions", () => {
    expect(
      check("\\(25%\\)", numeric({ value: "25", percentMode: "percent" }))
        .isCorrect,
    ).toBe(true);
    expect(
      check("$25%$", numeric({ value: "0.25", percentMode: "decimal" })),
    ).toMatchObject({ outcome: "correct", detail: "wrong_form" });
    expect(
      validateAnswerSpec(
        numeric({
          value: "3/3",
          percentMode: "percent",
          requiredForm: "decimal",
        }),
      ),
    ).toEqual([]);
    expect(
      check(
        "1",
        numeric({
          value: "3/3",
          percentMode: "percent",
          requiredForm: "decimal",
        }),
      ).isCorrect,
    ).toBe(true);
  });

  it.each([
    "0.5",
    "0.50",
    ".500",
    "1/2",
    "2/4",
    "50%",
    "50 percent",
    "½",
    "\\frac{1}{2}",
    "\\dfrac{1}{2}",
    "\\tfrac{1}{2}",
  ])("accepts equivalent %s", (value) =>
    expect(check(value, numeric()).outcome).toBe("correct"),
  );
  it.each([
    ["-3/6", "-0.5"],
    ["+7", "7"],
    ["1.2e-3", "0.0012"],
    ["1,000", "1000"],
    ["1/3", "2/6"],
  ])("matches %s exactly against %s", (value, expected) =>
    expect(check(value, numeric({ value: expected })).isCorrect).toBe(true),
  );
  it.each([
    "1/0",
    "abc",
    "1 2",
    "0.5+0",
    "1e31",
    "9".repeat(33),
    "x".repeat(501),
  ])("returns unreadable for %s", (value) =>
    expect(check(value, numeric()).outcome).toBe("unreadable"),
  );
  it("never takes an accepted string shortcut around typed grading", () =>
    expect(
      checkAnswer({
        studentAnswer: "8",
        acceptedAnswers: ["8"],
        spec: numeric({ value: "7" }),
      }).outcome,
    ).toBe("incorrect"));
  it("does not use the legacy JS-double floor", () =>
    expect(check("0.3333333333333333", numeric({ value: "1/3" })).outcome).toBe(
      "incorrect",
    ));
  it.each([
    ["decimal", "0.25", "0.25", "correct"],
    ["decimal", "0.25", "25%", "correct"],
    ["decimal", "0.25", "25", "incorrect"],
    ["percent", "25", "0.25", "incorrect"],
    ["percent", "25", "25%", "correct"],
    ["percent", "25", "25.0%", "correct"],
    ["percent", "25", "25", "correct"],
    ["either", "0.25", "0.25", "correct"],
    ["either", "0.25", "25%", "correct"],
    ["either", "0.25", "25", "incorrect"],
  ] as const)(
    "%s mode with canonical %s grades %s as %s",
    (percentMode, value, answer, outcome) =>
      expect(
        check(answer, numeric({ percentMode, value, domain: "probability" }))
          .outcome,
      ).toBe(outcome),
  );
  it.each([
    ["fraction", "note", "0.5", "correct", "wrong_form"],
    ["fraction", "require", "0.5", "incorrect", "wrong_form"],
    ["simplified_fraction", "note", "2/4", "correct", "unsimplified"],
    ["simplified_fraction", "require", "2/4", "incorrect", "unsimplified"],
    ["simplified_fraction", "require", "1/2", "correct", undefined],
    [
      "simplified_fraction",
      "require",
      "\\frac{2}{4}",
      "incorrect",
      "unsimplified",
    ],
    ["decimal", "require", "1/2", "incorrect", "wrong_form"],
    ["percent", "require", "0.5", "incorrect", "wrong_form"],
    ["percent", "require", "50%", "correct", undefined],
  ] as const)(
    "%s/%s form: %s",
    (requiredForm, formPolicy, answer, outcome, detail) =>
      expect(
        check(answer, numeric({ requiredForm, formPolicy })),
      ).toMatchObject({ outcome, detail }),
  );
  it.each([false, true])("unit required=%s", (required) => {
    const spec = numeric({ value: "$1.60", unit: { label: "$", required } });
    expect(check("$1.60", spec).outcome).toBe("correct");
    expect(check("1.60", spec)).toMatchObject({
      outcome: required ? "incorrect" : "correct",
      detail: required ? "missing_unit" : undefined,
    });
    expect(check("€1.60", spec).outcome).toBe("unreadable");
  });
  it("does not authorize undeclared currency, and strips only a declared unit", () => {
    expect(check("$1.60", numeric({ value: "1.6" })).outcome).toBe(
      "unreadable",
    );
    expect(
      check(
        "1.6 cm",
        numeric({ value: "1.6", unit: { label: "cm", required: true } }),
      ).outcome,
    ).toBe("correct");
    expect(
      check(
        "1.6 kg",
        numeric({ value: "1.6", unit: { label: "cm", required: true } }),
      ).outcome,
    ).toBe("unreadable");
  });
  it("enforces count and probability domains", () => {
    expect(
      check("7.0", numeric({ value: "7", domain: "count" })).isCorrect,
    ).toBe(true);
    expect(
      check("7.1", numeric({ value: "7", domain: "count" })).isCorrect,
    ).toBe(false);
    expect(
      check(
        "1.001",
        numeric({
          value: "1",
          domain: "probability",
          tolerance: { mode: "absolute", value: 0.01 },
        }),
      ).isCorrect,
    ).toBe(false);
    expect(
      check("-4", numeric({ value: "5", domain: "count" })).detail,
    ).toBeUndefined();
  });
});

describe("exact typed tolerance boundaries", () => {
  it.each([
    ["1", { mode: "exact" }, "1", "1.0000000001"],
    ["0.5", { mode: "absolute", value: 0.001 }, "0.501", "0.5010001"],
    ["100", { mode: "relative", value: 0.02 }, "102", "102.0001"],
    ["-100", { mode: "relative", value: 0.02 }, "-102", "-102.0001"],
    [
      "0",
      { mode: "combined", absolute: 0.01, relative: 0.02 },
      "0.01",
      "0.010001",
    ],
    [
      "100",
      { mode: "combined", absolute: 0.1, relative: 0.02 },
      "102",
      "102.001",
    ],
    ["0.5", { mode: "decimals", places: 3 }, "0.5005", "0.5005001"],
    ["1000", { mode: "significant", digits: 3 }, "1005", "1005.0001"],
    ["0.0999", { mode: "significant", digits: 3 }, "0.09995", "0.09995001"],
  ] satisfies Array<[string, ToleranceSpec, string, string]>)(
    "canonical %s with %j",
    (value, tolerance, boundary, outside) => {
      expect(check(boundary, numeric({ value, tolerance })).isCorrect).toBe(
        true,
      );
      expect(check(outside, numeric({ value, tolerance })).isCorrect).toBe(
        false,
      );
    },
  );
});

describe("categorical and list checking", () => {
  it.each(["seven", "7", " SEVEN! ", "Seven."])(
    "normalizes whole categorical alias %s",
    (answer) => expect(check(answer, category).outcome).toBe("correct"),
  );
  it("keeps mixed aliases categorical while legacy behavior stays unchanged", () => {
    expect(check("eight", category).outcome).toBe("incorrect");
    expect(
      checkAnswer({ acceptedAnswers: ["seven", "7"], studentAnswer: "eight" })
        .outcome,
    ).toBe("unreadable");
  });
  it.each([
    "not independent",
    "dependent",
    "yes, not independent",
    "independent but dependent",
  ])("rejects forbidden or partial categorical answer %s", (answer) =>
    expect(
      check(answer, {
        kind: "categorical",
        canonical: "independent",
        aliases: ["yes", "yes, independent"],
        forbiddenTerms: ["not independent", "dependent"],
      }).isCorrect,
    ).toBe(false),
  );
  it.each([
    "0.1, 0.6, 0.3",
    "[1/10; 6/10; 3/10]",
    "{0.1 0.6 0.3}",
    "(0.1, .6, .3)",
  ])("accepts list %s", (answer) =>
    expect(check(answer, list).isCorrect).toBe(true),
  );
  it("requires order when authored and preserves duplicate multiplicity", () => {
    expect(check("0.3,0.6,0.1", list).isCorrect).toBe(false);
    expect(check("0.3,0.6,0.1", { ...list, ordered: false }).isCorrect).toBe(
      true,
    );
    const repeated: AnswerSpec = {
      kind: "number_list",
      values: ["1", "1", "2"],
      ordered: false,
      tolerance: { mode: "exact" },
    };
    expect(check("2,1,1", repeated).isCorrect).toBe(true);
    expect(check("2,2,1", repeated).isCorrect).toBe(false);
  });
  it("finds a complete multiset match with overlapping tolerances", () =>
    expect(
      check("1.05,0.95", {
        kind: "number_list",
        values: ["1", "1.1"],
        ordered: false,
        tolerance: { mode: "absolute", value: 0.06 },
      }).isCorrect,
    ).toBe(true));
  it("matches normalized labels and rejects duplicates and missing labels", () => {
    const labeled = {
      ...list,
      ordered: false,
      labels: ["P(X=0)", "P(X=1)", "P(X=2)"],
    };
    expect(
      check("p( x = 2 )=3/10; P(X=1)=6/10; P(X=0)=1/10", labeled).isCorrect,
    ).toBe(true);
    expect(check("P(X=0)=1/10,P(X=0)=6/10,P(X=2)=3/10", labeled).outcome).toBe(
      "unreadable",
    );
    expect(check("0.1,0.6,0.3", labeled).outcome).toBe("unreadable");
  });
  it.each(["1,,2", "1,", "[1,2)", "abc", "1/0,2", "1,2=x", ""])(
    "malformed list %s is unreadable",
    (answer) => expect(check(answer, list).outcome).toBe("unreadable"),
  );
});

describe("typed configuration validation and bounds", () => {
  it.each([
    [{ ...numeric(), percentMode: undefined }, "percent_mode_missing"],
    [numeric({ value: "2", domain: "probability" }), "invalid_answer_spec"],
    [
      numeric({ tolerance: { mode: "absolute", value: -1 } }),
      "tolerance_out_of_bounds",
    ],
    [
      numeric({
        domain: "probability",
        tolerance: { mode: "absolute", value: 0.02 },
      }),
      "tolerance_out_of_bounds",
    ],
    [
      numeric({
        domain: "probability",
        tolerance: { mode: "relative", value: 0.03 },
      }),
      "tolerance_out_of_bounds",
    ],
    [
      numeric({
        domain: "count",
        value: "7",
        tolerance: { mode: "absolute", value: 0 },
      }),
      "tolerance_out_of_bounds",
    ],
    [numeric({ domain: "count", value: "7.1" }), "tolerance_out_of_bounds"],
    [
      numeric({ value: "0", tolerance: { mode: "relative", value: 0.01 } }),
      "tolerance_out_of_bounds",
    ],
    [
      numeric({ value: "0", tolerance: { mode: "significant", digits: 3 } }),
      "tolerance_out_of_bounds",
    ],
    [
      numeric({ tolerance: { mode: "absolute", value: Infinity } }),
      "tolerance_out_of_bounds",
    ],
    [numeric({ value: "1/0" }), "answer_value_unparseable"],
    [
      numeric({ value: "1/3", requiredForm: "decimal" }),
      "required_form_unsatisfiable",
    ],
    [numeric({ requiredForm: "integer" }), "required_form_unsatisfiable"],
    [
      { kind: "categorical", canonical: "", aliases: [] },
      "invalid_answer_spec",
    ],
    [{ ...category, aliases: [""] }, "categorical_alias_empty"],
    [{ ...list, labels: ["a", "a", "b"] }, "invalid_answer_spec"],
    [{ ...list, values: ["1/0"] }, "answer_value_unparseable"],
    [{ ...numeric(), unexpected: "no" }, "invalid_answer_spec"],
  ] as const)("rejects invalid spec %j", (spec, code) =>
    expect(validateAnswerSpec(spec).map((v) => v.code)).toContain(code),
  );
  it("rejects contradictory aliases using the real checker", () => {
    expect(validateAnswerSpec(numeric(), ["2"])[0].code).toBe(
      "accepted_answer_inconsistent",
    );
    expect(
      validateAnswerSpec({
        kind: "categorical",
        canonical: "independent",
        aliases: ["not independent"],
        forbiddenTerms: ["not independent"],
      })[0].code,
    ).toBe("accepted_answer_inconsistent");
  });
  it("never throws for 10,000 random bounded submissions", () => {
    const started = performance.now();
    let seed = 7;
    const specs = [numeric(), category, list];
    for (let i = 0; i < 10000; i++) {
      let s = "";
      for (let j = 0; j < i % 70; j++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        s += String.fromCharCode(32 + (seed % 100));
      }
      expect(["correct", "incorrect", "unreadable"]).toContain(
        checkTypedAnswer(s, specs[i % 3]).outcome,
      );
    }
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("percent notation in decimal mode follows the form policy", () => {
  const decimal = (formPolicy?: "note" | "require"): NumericAnswerSpec =>
    numeric({
      value: "0.25",
      domain: "probability",
      percentMode: "decimal",
      ...(formPolicy ? { formPolicy } : {}),
    });
  it.each(["25%", "25 percent", "25\\%", "\\(25%\\)", "$25\\%$"])(
    "note policy solves %s with a wrong_form note",
    (answer) => {
      const result = check(answer, decimal("note"));
      expect(result).toMatchObject({
        outcome: "correct",
        isCorrect: true,
        detail: "wrong_form",
        normalizedStudentAnswer: "1/4",
      });
      expect(result.feedback).toMatch(/^Correct value/);
      expect(result.feedback).toMatch(/decimal or fraction/);
      // Omitted formPolicy keeps the same default as every other form requirement.
      expect(check(answer, decimal())).toMatchObject({
        outcome: "correct",
        detail: "wrong_form",
      });
    },
  );
  it.each(["25%", "25 percent"])(
    "require policy marks %s incorrect with wrong_form",
    (answer) => {
      const result = check(answer, decimal("require"));
      expect(result).toMatchObject({
        outcome: "incorrect",
        isCorrect: false,
        detail: "wrong_form",
      });
      expect(result.feedback).not.toMatch(/correct/i);
      expect(result.feedback).toMatch(/decimal or fraction/);
      expect(result.feedback).not.toContain("0.25");
    },
  );
  it.each(["note", "require"] as const)(
    "never rescales a bare number under %s",
    (formPolicy) => {
      expect(check("25", decimal(formPolicy))).toMatchObject({
        outcome: "incorrect",
        detail: "percent_decimal_confusion",
      });
      expect(check("0.25", decimal(formPolicy))).toMatchObject({
        outcome: "correct",
        detail: undefined,
      });
      expect(check("1/4", decimal(formPolicy))).toMatchObject({
        outcome: "correct",
        detail: undefined,
      });
    },
  );
  it("keeps wrong values incorrect regardless of percent notation", () => {
    expect(check("30%", decimal("note")).outcome).toBe("incorrect");
    expect(check("2.5%", decimal("note"))).toMatchObject({
      outcome: "incorrect",
      detail: undefined,
    });
    expect(check("0.25%", decimal("note"))).toMatchObject({
      outcome: "incorrect",
      detail: "percent_decimal_confusion",
    });
    expect(
      check("25%", numeric({ value: "0.25", percentMode: "either" })),
    ).toMatchObject({ outcome: "correct", detail: undefined });
  });
  it("accepts a percent-notation accepted answer only under note policy", () => {
    expect(validateAnswerSpec(decimal("note"), ["25%"])).toEqual([]);
    expect(
      validateAnswerSpec(decimal("require"), ["25%"]).map((i) => i.code),
    ).toEqual(["accepted_answer_inconsistent"]);
  });
});

describe("number_list canonical values cannot contain list separators", () => {
  const listOf = (values: string[], labels?: string[]): AnswerSpec => ({
    kind: "number_list",
    values,
    ordered: true,
    tolerance: { mode: "exact" },
    ...(labels ? { labels } : {}),
  });
  it.each([
    { values: ["1,000", "2"] },
    { values: ["1,000"] },
    { values: ["1;2"] },
    { values: ["1", "2;"] },
  ])("rejects values $values at validation", ({ values }) => {
    const issues = validateAnswerSpec(listOf(values));
    expect(issues.map((i) => i.code)).toEqual(["invalid_answer_spec"]);
    expect(issues[0].message).toMatch(/separators/);
    // An invalid spec fails closed instead of grading with a reinterpretation.
    expect(check("1000, 2", listOf(values)).outcome).toBe("unreadable");
  });
  it.each([[["a,b", "c"]], [["a;b", "c"]]])(
    "rejects labels %j at validation",
    (labels) => {
      expect(
        validateAnswerSpec(listOf(["1", "2"], labels)).map((i) => i.code),
      ).toContain("invalid_answer_spec");
    },
  );
  it("keeps ordinary lists working without reinterpreting student commas", () => {
    const spec = listOf(["1000", "2"]);
    expect(validateAnswerSpec(spec)).toEqual([]);
    expect(check("1000, 2", spec).isCorrect).toBe(true);
    expect(check("1000; 2", spec).isCorrect).toBe(true);
    expect(check("1,000, 2", spec).isCorrect).toBe(false);
    expect(
      validateAnswerSpec(listOf(["1/10", "6/10"], ["P(X=0)", "P(X=1)"])),
    ).toEqual([]);
    expect(
      validateAnswerSpec(numeric({ value: "1,000", domain: "real" })),
    ).toEqual([]);
  });
});
