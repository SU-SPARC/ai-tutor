import { describe, expect, it } from "vitest";

import {
  DECIMAL_COMMA_HINT,
  MIXED_NUMBER_HINT,
  answerNotationFromHint,
  answerTypeFromHint,
  evaluateEntry,
  formatDecimal,
  latexToPlain,
  plainToLatex,
  readLatexEntry,
} from "@/lib/math/answer-notation";
import { parseRational } from "@/lib/tutor/answer/rational";

// MathLive LaTeX → checker-plain (brief §1, "LaTeX → checker-plain").
const LATEX_TO_PLAIN: Array<[latex: string, plain: string, status: string]> = [
  // Grammar entries: verbatim, never reduced.
  ["\\frac{1}{4}", "1/4", "grammar"],
  ["\\frac{2}{4}", "2/4", "grammar"],
  ["\\dfrac{3}{8}", "3/8", "grammar"],
  ["\\tfrac{1}{2}", "1/2", "grammar"],
  ["\\frac12", "1/2", "grammar"],
  ["-\\frac{1}{2}", "-1/2", "grammar"],
  ["\\frac{-1}{2}", "-1/2", "grammar"],
  ["\\frac{1}{-2}", "1/-2", "grammar"],
  ["0.25", "0.25", "grammar"],
  [".25", ".25", "grammar"],
  ["-3", "-3", "grammar"],
  ["+3", "+3", "grammar"],
  ["25\\%", "25%", "grammar"],
  ["\\frac{1}{4}\\%", "1/4%", "grammar"],
  ["1{,}000", "1,000", "grammar"],
  ["1,000", "1,000", "grammar"],
  ["12{,}345.6", "12,345.6", "grammar"],
  ["1\\,000", "1,000", "grammar"],
  ["1.2e-3", "1.2e-3", "grammar"],
  ["1.2\\times10^{-3}", "1.2e-3", "grammar"],
  ["3\\div4", "3/4", "grammar"],
  ["\\left(0.25\\right)", "0.25", "grammar"],
  ["(0.25)", "0.25", "grammar"],
  ["\\left(\\frac{1}{4}\\right)", "1/4", "grammar"],
  ["−3", "-3", "grammar"],
  ["\\minus 3", "-3", "grammar"],
  // Evaluated exactly.
  ["\\frac{\\frac{1}{2}}{3}", "1/6", "evaluated"],
  ["\\frac{1}{2}+\\frac{1}{3}", "5/6", "evaluated"],
  ["\\left(\\frac{1}{2}\\right)^3", "1/8", "evaluated"],
  ["\\left(\\frac{1}{2}\\right)^{3}", "1/8", "evaluated"],
  ["2^3", "8", "evaluated"],
  ["x^{2}".replace("x", "3"), "9", "evaluated"],
  ["2^{-2}", "1/4", "evaluated"],
  ["4^{\\frac{1}{2}}", "2", "evaluated"],
  ["\\sqrt{4}", "2", "evaluated"],
  ["\\sqrt{\\frac{1}{4}}", "1/2", "evaluated"],
  ["\\sqrt[3]{27}", "3", "evaluated"],
  ["5!", "120", "evaluated"],
  ["\\binom{5}{2}", "10", "evaluated"],
  ["\\binom{10}{3}\\cdot0.5^{10}", "15/128", "evaluated"],
  ["2\\times3", "6", "evaluated"],
  ["2\\cdot3", "6", "evaluated"],
  ["2\\ast3", "6", "evaluated"],
  ["1\\div2\\div3", "1/6", "evaluated"],
  ["\\left(1+2\\right)\\times3", "9", "evaluated"],
  ["1-0.25", "3/4", "evaluated"],
  ["\\frac{1}{2}\\times\\frac{1}{2}\\%", "1/4%", "evaluated"],
  ["2\\left(3\\right)", "6", "evaluated"],
  // Evaluated to 15 significant digits.
  ["\\sqrt{2}", "1.4142135623731", "evaluated"],
  ["\\pi", "3.14159265358979", "evaluated"],
  ["e", "2.71828182845905", "evaluated"],
  ["\\exponentialE", "2.71828182845905", "evaluated"],
  ["2^{\\frac{1}{2}}", "1.4142135623731", "evaluated"],
  ["2\\pi", "6.28318530717959", "evaluated"],
  ["e^{-1}", "0.367879441171442", "evaluated"],
];

const REJECTED_LATEX: Array<[latex: string, hint: string]> = [
  ["0{,}25", DECIMAL_COMMA_HINT],
  ["0,25", DECIMAL_COMMA_HINT],
  ["0{,}250", DECIMAL_COMMA_HINT],
  ["3,5", DECIMAL_COMMA_HINT],
  ["1\\frac{1}{2}", MIXED_NUMBER_HINT],
  ["1\\frac12", MIXED_NUMBER_HINT],
];

const UNPARSED_LATEX: Array<[latex: string, sent: string]> = [
  ["\\frac{1}{\\placeholder{}}", "\\frac{1}{\\placeholder{}}"],
  ["\\frac{#?}{2}", "\\frac{#?}{2}"],
  ["x^2", "x^2"],
  ["\\text{independent}", "independent"],
  ["\\mathrm{yes}", "yes"],
  ["\\frac{1}{0}", "\\frac{1}{0}"],
  ["\\sqrt{-4}", "\\sqrt{-4}"],
  ["171!", "171!"],
  ["2^", "2^"],
];

// Plain → LaTeX (brief §1, "Plain → LaTeX").
const PLAIN_TO_LATEX: Array<[plain: string, latex: string]> = [
  ["1/4", "\\frac{1}{4}"],
  ["25%", "25\\%"],
  ["25 percent", "25\\%"],
  ["1.2e-3", "1.2\\times10^{-3}"],
  ["½", "\\frac{1}{2}"],
  ["1,000", "1{,}000"],
  ["\\frac{1}{4}", "\\frac{1}{4}"],
  ["$\\frac{1}{4}$", "\\frac{1}{4}"],
  ["\\(0.25\\)", "0.25"],
  ["1/2 + 1/3", "\\frac{1}{2}+\\frac{1}{3}"],
  ["2^(1/2)", "2^{\\frac{1}{2}}"],
  ["-1/2", "-\\frac{1}{2}"],
  ["1/-2", "\\frac{1}{-2}"],
  ["(1/2)^3", "\\left(\\frac{1}{2}\\right)^{3}"],
  ["sqrt(2)", "\\sqrt{2}"],
  ["C(5,2)", "\\binom{5}{2}"],
  ["2pi", "2\\pi"],
  ["", ""],
  ["independent", "\\text{independent}"],
];

// Plain entries (the field before MathLive loads, or a restored value).
const PLAIN_ENTRIES: Array<[plain: string, sent: string, status: string]> = [
  ["2/4", "2/4", "grammar"],
  [" 1 / 4 ", "1 / 4", "grammar"],
  ["½", "½", "grammar"],
  ["25 percent", "25 percent", "grammar"],
  ["$1/4$", "$1/4$", "grammar"],
  ["3E5", "3E5", "grammar"],
  ["(0.25)", "0.25", "grammar"],
  ["((1/4))", "1/4", "grammar"],
  ["(1/4)%", "1/4%", "grammar"],
  ["1/2+1/3", "5/6", "evaluated"],
  ["(1/2)^3", "1/8", "evaluated"],
  ["2^3", "8", "evaluated"],
  ["2**3", "8", "evaluated"],
  ["1/2/3", "1/6", "evaluated"],
  ["sqrt(1/4)", "1/2", "evaluated"],
  ["√2", "1.4142135623731", "evaluated"],
  ["pi", "3.14159265358979", "evaluated"],
  ["5!", "120", "evaluated"],
  ["C(5,2)", "10", "evaluated"],
  ["C(10,3)", "120", "evaluated"],
  ["2×3", "6", "evaluated"],
  ["6÷4", "6/4", "grammar"],
  ["1 − 0.25", "3/4", "evaluated"],
  ["-2^2", "-4", "evaluated"],
  ["2^-1", "1/2", "evaluated"],
  ["\\sqrt{9}", "3", "evaluated"],
];

describe("latexToPlain", () => {
  it.each(LATEX_TO_PLAIN)("%s → %s (%s)", (latex, plain, status) => {
    const entry = readLatexEntry(latex);
    expect(entry.sent).toBe(plain);
    expect(entry.status).toBe(status);
    expect(latexToPlain(latex)).toBe(plain);
  });

  it.each(REJECTED_LATEX)("rejects %s with a hint", (latex, hint) => {
    const entry = readLatexEntry(latex);
    expect(entry.status).toBe("rejected");
    expect(entry.hint).toBe(hint);
  });

  it.each(UNPARSED_LATEX)("sends %s raw", (latex, sent) => {
    const entry = readLatexEntry(latex);
    expect(entry.status).toBe("unparsed");
    expect(entry.sent).toBe(sent);
  });

  it("is empty for an empty field", () => {
    expect(readLatexEntry("  ")).toEqual({ status: "empty", sent: "" });
  });

  it("describes an evaluated entry for the preview", () => {
    const entry = readLatexEntry("\\left(\\frac{1}{2}\\right)^3");
    expect(entry.notation).toBe("\\left(\\frac{1}{2}\\right)^{3}");
    expect(entry.valueLatex).toBe("\\frac{1}{8}");
    expect(entry.approximate).toBe(false);
    expect(entry.value).toBe(0.125);

    const root = readLatexEntry("\\sqrt{2}");
    expect(root.approximate).toBe(true);
    expect(root.valueLatex).toBe("1.4142");
  });
});

describe("evaluateEntry", () => {
  it.each(PLAIN_ENTRIES)("%s → %s (%s)", (plain, sent, status) => {
    const entry = evaluateEntry(plain);
    expect(entry.sent).toBe(sent);
    expect(entry.status).toBe(status);
  });

  it.each([
    ["0,25", DECIMAL_COMMA_HINT],
    ["12,34", DECIMAL_COMMA_HINT],
    ["1 1/2", MIXED_NUMBER_HINT],
    ["-1 1/2", MIXED_NUMBER_HINT],
  ])("rejects %s with a hint", (plain, hint) => {
    const entry = evaluateEntry(plain);
    expect(entry.status).toBe("rejected");
    expect(entry.hint).toBe(hint);
  });

  it.each(["independent", "x+1", "2^", "(1/4"])("sends %s raw", (plain) => {
    const entry = evaluateEntry(plain);
    expect(entry.status).toBe("unparsed");
    expect(entry.sent).toBe(plain);
  });
});

describe("plainToLatex", () => {
  it.each(PLAIN_TO_LATEX)("%s → %s", (plain, latex) => {
    expect(plainToLatex(plain)).toBe(latex);
  });

  it("round-trips every value the field can send", () => {
    for (const plain of [
      "2/4",
      "-1/2",
      "1/-2",
      "0.25",
      ".25",
      "+3",
      "25%",
      "1/4%",
      "1,000",
      "1.2e-3",
      "5/6",
      "1.4142135623731",
      "1e21",
    ]) {
      expect(latexToPlain(plainToLatex(plain))).toBe(plain);
    }
  });
});

describe("the checker reads everything the field sends", () => {
  const sent = [
    ...LATEX_TO_PLAIN.map(([, plain]) => plain),
    ...PLAIN_ENTRIES.map(([, plain]) => plain),
  ];

  it.each(sent)("parseRational accepts %s", (plain) => {
    expect(parseRational(plain)).toBeDefined();
  });

  it("formats irrational results as a 15-significant-digit decimal", () => {
    expect(formatDecimal(Math.SQRT2)).toBe("1.4142135623731");
    expect(formatDecimal(1 / 3)).toBe("0.333333333333333");
    expect(formatDecimal(1e21)).toBe("1e21");
    expect(formatDecimal(1.5e-7)).toBe("1.5e-7");
    expect(formatDecimal(0)).toBe("0");
    for (const x of [Math.PI, 1e21, 1.5e-7, -Math.E, 123456.789]) {
      expect(parseRational(formatDecimal(x))).toBeDefined();
    }
  });

  it("sends exact integers up to the checker's digit limit", () => {
    const entry = readLatexEntry("25!");
    expect(entry.status).toBe("evaluated");
    expect(entry.sent).toBe("15511210043330985984000000");
    expect(parseRational(entry.sent)).toBeDefined();
  });

  it("falls back to a rounded decimal past the checker's digit limit", () => {
    // 3^{70} has 34 digits; the checker reads at most 32.
    const entry = readLatexEntry("\\frac{3^{70}+1}{3^{70}}");
    expect(entry.status).toBe("evaluated");
    expect(entry.approximate).toBe(true);
    expect(entry.sent).toBe("1");
  });

  it("refuses results the checker cannot read at all", () => {
    const entry = readLatexEntry("40!");
    expect(entry.status).toBe("rejected");
  });
});

describe("answer type from the format hint", () => {
  it.each([
    [
      "Enter a decimal, fraction, or percentage, for example 0.25, 1/4, or 25%.",
      "numeric",
      "math",
    ],
    [
      "Enter a decimal or fraction, for example 0.25 or 1/4.",
      "numeric",
      "math",
    ],
    ["Enter a whole number, for example 12.", "numeric", "math"],
    ["Enter 3 numbers separated by commas.", "numeric", "text"],
    ["Type a short response in words.", "text", "text"],
    ["Type your response in the box below.", "text", "text"],
  ])("%s", (hint, type, notation) => {
    expect(answerTypeFromHint(hint)).toBe(type);
    expect(answerNotationFromHint(hint)).toBe(notation);
  });
});
