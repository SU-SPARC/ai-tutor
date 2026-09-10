import { describe, expect, it } from "vitest";

import {
  detectMisconceptions,
  numericTokens,
  questionTermMatches,
} from "@/lib/tutor/misconceptions";
import type { Misconception } from "@/lib/types";

const topicId = "introduction-probability-venn-diagrams";

function misconception(id: string, matchTerms: string[]): Misconception {
  return { feedback: `Feedback for ${id}.`, id, matchTerms };
}

function detected(
  questionMisconceptions: Misconception[],
  studentAnswer: string,
  topic: string | undefined = topicId,
) {
  return detectMisconceptions({
    questionMisconceptions,
    studentAnswer,
    topicId: topic,
  }).map((match) => `${match.source}:${match.id}`);
}

function matches(term: string, answer: string) {
  return questionTermMatches(term, {
    normalized: answer.toLowerCase().replace(/\s+/g, ""),
    tokens: numericTokens(answer),
  });
}

describe("question-specific misconception matching by value", () => {
  it.each([
    "-1.5",
    "-1.50",
    "-3/2",
    "-150%",
    "−1.5",
    "z = -1.5",
    "(-1.5)",
    "- 1.5",
    "-\\frac{3}{2}",
  ])("matches a negative term by exact value in %s", (answer) => {
    expect(matches("-1.5", answer)).toBe(true);
    expect(detected([misconception("negative", ["-1.5"])], answer)).toEqual([
      "question:negative",
    ]);
  });

  it.each([
    ["-1.5", "1.5"],
    ["-1.5", "3/2"],
    ["-1.5", "150%"],
    ["-1.5", "+1.5"],
    ["1.5", "-1.5"],
    ["1.5", "-3/2"],
    ["1.5", "−150%"],
    ["1.5", "-1.5e0"],
    ["-1.5", "--1.5"],
    ["-1.5", "+-1.5"],
  ])("keeps signed term %s isolated from %s", (term, answer) => {
    expect(matches(term, answer)).toBe(false);
  });

  it.each([
    ["2.5", "+2.5"],
    ["-1.5", "z = −1.5"],
    ["−1.5", "-3/2"],
    ["-0.5", "−½"],
  ])("normalizes the signed value of %s in %s", (term, answer) => {
    expect(matches(term, answer)).toBe(true);
  });

  it.each([
    ["70 - 63", ["70/1", "63/1"], "-63"],
    ["70-63", ["70/1", "63/1"], "-63"],
    ["70 − 63", ["70/1", "63/1"], "-63"],
    ["2-1/2", ["2/1", "1/2"], "-1/2"],
    ["2 - 1/2", ["2/1", "1/2"], "-1/2"],
    ["(70) - 63", ["70/1", "63/1"], "-63"],
    ["x - 1.5", ["3/2"], "-1.5"],
  ])("does not turn subtraction into a unary sign in %s", (answer, values, term) => {
    expect(numericTokens(answer).map(({ value }) => `${value.n}/${value.d}`))
      .toEqual(values);
    expect(matches(term, answer)).toBe(false);
  });

  it.each([
    ["0.0012", "1.2e-3"],
    ["0.5", "5e-1"],
    ["20000", "2E4"],
    ["-150", "-1.5e2"],
    ["30000", "+3E+4"],
    ["-0.0012", "-1.2e-3"],
  ])("treats scientific notation %s = %s as one whole token", (term, answer) => {
    expect(matches(term, answer)).toBe(true);
    expect(numericTokens(answer)).toHaveLength(1);
    expect(numericTokens(answer)[0].parts).toEqual([]);
  });

  it.each([
    ["3", "1.2e-3"],
    ["1.2", "1.2e-3"],
    ["1", "5e-1"],
    ["5", "5e-1"],
    ["4", "+3E+4"],
    ["3", "1.2e-31"],
  ])("does not match %s as a scientific notation fragment in %s", (term, answer) => {
    expect(matches(term, answer)).toBe(false);
    expect(detected([misconception("fragment", [term])], answer)).not.toContain(
      "question:fragment",
    );
  });

  it.each(["-2/36", "−5/36", "+5/36", "-36/5", "-\\frac{5}{36}"])(
    "preserves absolute unreduced integer fraction parts in %s",
    (answer) => {
      expect(matches("36", answer)).toBe(true);
      expect(matches("-36", answer)).toBe(false);
      expect(numericTokens(answer)[0].parts).toContain(BigInt(36));
      expect(numericTokens(answer)[0].parts.every((part) => part >= BigInt(0)))
        .toBe(true);
    },
  );

  it.each([
    ["7/45", "27/45"],
    ["7/45", "127/45"],
    ["0.6", "0.625"],
    ["0.6", "0.65"],
    ["0.5", "0.55"],
    ["0.5", "0.5375"],
    ["40", "5040"],
    ["40", "840"],
    ["40", "140"],
    ["40", "5,040"],
    ["35", "350"],
    ["35", "135"],
    ["56", "560"],
    ["56", "156"],
    ["56%", "15.56%"],
    ["12", "120"],
    ["9", "96"],
    ["9", "19"],
    ["36", "0.136"],
    ["36", "136"],
    ["36", "360"],
    ["36", "3.6"],
    ["36", "3 6"],
    ["616", "6 16"],
    ["2/36", "12/36"],
    ["1/3", "11/3"],
    ["1/3", "1/30"],
    ["0.15", "0.155556"],
    ["60%", "160%"],
    ["37", "0.37"],
    ["37", "37%"],
    ["56%", "56"],
  ])(
    "numeric term %s never fires inside the longer or scaled value %s",
    (term, answer) => {
      expect(matches(term, answer)).toBe(false);
      expect(
        detected([misconception("collision", [term])], answer),
      ).not.toContain("question:collision");
    },
  );

  it.each([
    ["7/45", "7/45"],
    ["7/45", " 7 / 45 "],
    ["7/45", "\\frac{7}{45}"],
    ["7/45", "$\\dfrac{7}{45}$"],
    ["7/45", "P = 7/45"],
    ["7/45", "7/45 or about 0.16"],
    ["0.6", "0.6"],
    ["0.6", "0.60"],
    ["0.6", ".6"],
    ["0.6", "60%"],
    ["0.6", "60 %"],
    ["0.6", "60 percent"],
    ["0.6", "60\\%"],
    ["0.6", "3/5"],
    ["0.6", "6/10"],
    ["0.6", "27/45"],
    ["60%", "0.6"],
    ["3/5", "0.6"],
    ["1/2", "½"],
    ["0.5", "50%"],
    ["40", "40"],
    ["40", "40 sets"],
    ["40", "10 * 4 = 40"],
    ["40", "40.0"],
    ["5040", "5,040"],
    ["5040", "5040"],
    ["1/18", "2/36"],
    ["15.56%", "0.1556"],
    ["15.56%", "15.56%"],
    ["0.1556", "15.56%"],
    ["2.4", "12/5"],
    ["16/6", "8/3"],
  ])("numeric term %s fires on the same value written as %s", (term, answer) => {
    expect(matches(term, answer)).toBe(true);
    expect(detected([misconception("value", [term])], answer)).toEqual([
      "question:value",
    ]);
  });

  it("lets a digits-only term find a fraction numerator or denominator but not a decimal fragment", () => {
    const fullSampleSpace = [misconception("uses-full-sample-space", ["36"])];
    for (const answer of ["2/36", "5/36", "\\frac{5}{36}", "36", "36 outcomes"])
      expect(detected(fullSampleSpace, answer), answer).toEqual([
        "question:uses-full-sample-space",
      ]);
    for (const answer of ["0.136", "136", "1/136", "36.5", "3.6", "0.36"])
      expect(detected(fullSampleSpace, answer), answer).not.toContain(
        "question:uses-full-sample-space",
      );
  });

  it("keeps substring matching for phrase terms and ignores empty terms", () => {
    const phrases = [
      misconception("power", ["0.75^2"]),
      misconception("npr", ["11P4"]),
      misconception("words", ["p(a)+p(b)"]),
      misconception("empty", ["", "   "]),
    ];
    expect(detected(phrases, "0.75^2 = 0.5625")).toEqual(["question:power"]);
    expect(detected(phrases, "11p4 = 7920")).toEqual(["question:npr"]);
    expect(detected(phrases, "I used P(A) + P(B)")).toEqual(["question:words"]);
    expect(detected(phrases, "0.5625")).toEqual([]);
    expect(detected(phrases, "anything at all")).toEqual([]);
  });

  it("keeps author order as precedence and still shadows the library", () => {
    const question = [
      misconception("first", ["0.5"]),
      misconception("second", ["1/2", "50%"]),
      misconception("third", ["0.55"]),
    ];
    expect(detected(question, "1/2")).toEqual([
      "question:first",
      "question:second",
    ]);
    expect(detected(question, "0.55")).toEqual(["question:third"]);
    // A question-level match suppresses the topic library entirely.
    expect(
      detected(
        [misconception("uses-full-sample-space", ["36"])],
        "2/36",
        "conditional-probability",
      ),
    ).toEqual(["question:uses-full-sample-space"]);
    // With no question-level match the library still answers for the topic.
    expect(
      detected(
        [misconception("uses-full-sample-space", ["1/18"])],
        "5/36",
        "conditional-probability",
      ),
    ).toEqual(["library:conditional-probability-denominator-mistake"]);
  });

  it("tokenizes answers deterministically with exact rational values", () => {
    const tokens = numericTokens("6/16 = 3/8 = 0.375 = 37.5% (not 5,040)");
    expect(tokens.map((token) => `${token.value.n}/${token.value.d}`)).toEqual(
      ["3/8", "3/8", "3/8", "3/8", "5040/1"],
    );
    expect(tokens.map((token) => token.parts.map(String))).toEqual([
      ["6", "16"],
      ["3", "8"],
      [],
      [],
      [],
    ]);
    expect(numericTokens("no numbers here")).toEqual([]);
    expect(numericTokens("")).toEqual([]);
  });
});
