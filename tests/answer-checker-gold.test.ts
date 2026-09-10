import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  checkAnswer,
  parseAnswerNumber,
  type AnswerCheckInput,
  type AnswerCheckResult,
} from "@/lib/tutor/answer-checker";
import {
  parseRational,
  numericAnswerMatches,
} from "@/lib/tutor/answer/rational";

type Case = {
  answer: string;
  expected?: string;
  numericValue?: number;
  outcome: AnswerCheckResult["outcome"];
  detail?: AnswerCheckResult["detail"];
  stripCurrency?: boolean;
  tolerance?: number;
};
const cases: Case[] = [
  ...[
    "0.5",
    "0.50",
    ".500",
    "1/2",
    "2/4",
    "50%",
    "50 percent",
    "½",
    "\\frac{1}{2}",
    "\\dfrac{2}{4}",
    "\\tfrac{1}{2}",
    "1 / 2",
  ].map((answer) => ({ answer, expected: "0.5", outcome: "correct" as const })),
  { answer: "-3/6", expected: "-0.5", outcome: "correct" },
  { answer: "$1.60", expected: "1.6", stripCurrency: true, outcome: "correct" },
  { answer: "$1.60", expected: "1.6", outcome: "unreadable" },
  { answer: "1.2e-3", expected: "0.0012", outcome: "correct" },
  { answer: "1,000", expected: "1000", outcome: "correct" },
  { answer: "+7", expected: "7", outcome: "correct" },
  { answer: "¼", expected: "0.25", outcome: "correct" },
  { answer: "¾", expected: "0.75", outcome: "correct" },
  { answer: "1/0", expected: "0.5", outcome: "unreadable" },
  { answer: "abc", expected: "0.5", outcome: "unreadable" },
  { answer: "1 2", expected: "0.5", outcome: "unreadable" },
  { answer: "0.5009", expected: "0.5", outcome: "correct" },
  {
    answer: "0.502",
    expected: "0.5",
    outcome: "incorrect",
    detail: "close_rounding",
  },
  {
    answer: "0.51",
    expected: "0.5",
    outcome: "incorrect",
    detail: "close_rounding",
  },
  {
    answer: "50",
    expected: "0.5",
    outcome: "incorrect",
    detail: "percent_decimal_confusion",
  },
  {
    answer: "0.005",
    expected: "0.5",
    outcome: "incorrect",
    detail: "percent_decimal_confusion",
  },
  {
    answer: "0.75",
    expected: "0.25",
    outcome: "incorrect",
    detail: "complement",
  },
  { answer: "2/6", expected: "1/3", tolerance: 0, outcome: "correct" },
  { answer: "1/3", numericValue: 1 / 3, tolerance: 0, outcome: "correct" },
  {
    answer: "0.3333333333333333",
    expected: "1/3",
    tolerance: 0,
    outcome: "incorrect",
  },
  { answer: "-4", expected: "5", outcome: "incorrect" },
  // Legacy percent handling is untouched by the typed decimal-mode form policy.
  { answer: "25%", expected: "0.25", outcome: "correct" },
  { answer: "25 percent", expected: "0.25", outcome: "correct" },
  { answer: "0.25", expected: "25%", outcome: "correct" },
  {
    answer: "25",
    expected: "0.25",
    outcome: "incorrect",
    detail: "percent_decimal_confusion",
  },
  {
    answer: "9007199254740993",
    expected: "9007199254740992",
    tolerance: 0,
    outcome: "incorrect",
  },
];

describe("Phase A answer checker gold table", () => {
  it.each(cases)(
    "$answer against $expected -> $outcome",
    ({ answer, expected, outcome, detail, ...options }) => {
      const result = checkAnswer({
        acceptedAnswers: expected === undefined ? [] : [expected],
        studentAnswer: answer,
        ...options,
      });
      expect(result.outcome).toBe(outcome);
      expect(result.isCorrect).toBe(outcome === "correct");
      expect(result.detail).toBe(detail);
    },
  );

  it("preserves exact text matching and the empty-input behavior", () => {
    expect(
      checkAnswer({
        acceptedAnswers: ["Mutually Exclusive"],
        studentAnswer: " mutually exclusive ",
      }),
    ).toMatchObject({ outcome: "correct", confidence: 1 });
    expect(
      checkAnswer({ acceptedAnswers: ["0"], studentAnswer: " " }),
    ).toMatchObject({ outcome: "incorrect", confidence: 0 });
  });

  it.each([
    "1/0",
    "1/2/3",
    "1+2",
    "1 2",
    "1 .2",
    "12,34",
    "1234,000",
    "1,,000",
    "1e31",
    "1e-31",
    "1e",
    "1e+",
    "--1",
    "NaN",
    "Infinity",
    "0x10",
    "\\frac{1}{0}",
    "\\frac{1}{2",
    "1percentmore",
    "1%2",
  ])("rejects invalid notation %s", (answer) => {
    expect(parseRational(answer)).toBeUndefined();
  });

  it("enforces character, token, digit, and exponent caps", () => {
    expect(parseRational(" ".repeat(499) + "1")).toBeDefined();
    expect(parseRational(" ".repeat(500) + "1")).toBeUndefined();
    expect(parseRational("9".repeat(32))).toBeDefined();
    expect(parseRational("9".repeat(33))).toBeUndefined();
    expect(parseRational("1e30")).toBeDefined();
    expect(parseRational("1e-30")).toBeDefined();
    const nested = (depth: number): string =>
      depth ? `\\frac{1}{${nested(depth - 1)}}` : "2";
    expect(parseRational(nested(10))).toBeDefined(); // 61 tokens
    expect(parseRational(nested(11))).toBeUndefined(); // 67 tokens
  });

  it("returns reduced rationals with a positive denominator and retains number API wrappers", () => {
    expect(parseRational("-3/-6")).toEqual({ n: BigInt(1), d: BigInt(2) });
    expect(parseRational("0.1")).toEqual({ n: BigInt(1), d: BigInt(10) });
    expect(parseAnswerNumber("\\[\\dfrac{1}{2}\\]")).toBe(0.5);
    expect(parseAnswerNumber("$50\\%$")).toBe(0.5);
    expect(numericAnswerMatches("$1.60", 1.6, 0)).toBe(true);
    expect(numericAnswerMatches("\\frac{1}{2}", 0.5, 0)).toBe(true);
  });

  it("checks 10,000 deterministic random strings without throwing in under two seconds", () => {
    let seed = 0x6d2b79f5;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    const alphabet = "0123456789.,/+-eE% abcdefractpns{}\\$½¼¾\t\n()[]";
    const inputs: AnswerCheckInput[] = Array.from({ length: 10_000 }, () => ({
      acceptedAnswers: ["0.5"],
      studentAnswer: Array.from(
        { length: random() % 550 },
        () => alphabet[random() % alphabet.length],
      ).join(""),
      stripCurrency: Boolean(random() % 2),
    }));
    const start = performance.now();
    const outcomes = inputs.map((input) => checkAnswer(input).outcome);
    const duration = performance.now() - start;
    expect(
      outcomes.every((outcome) =>
        ["correct", "incorrect", "unreadable"].includes(outcome),
      ),
    ).toBe(true);
    expect(duration).toBeLessThan(2000);
  });
});
