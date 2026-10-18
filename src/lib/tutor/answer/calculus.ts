// Calculus answer kinds. Equivalence is decided numerically: both answers are
// evaluated at fixed sample points and must agree everywhere the expected
// answer is defined. Plain Node runs this file (importer CLIs), so imports stay
// relative and type-only syntax is erasable.
import { ComputeEngine } from "@cortex-js/compute-engine";

export type CalculusSampleRange = { min: number; max: number };

export type ExpressionAnswerSpec = {
  kind: "expression";
  /** Canonical answer in LaTeX (or plain math text). */
  value: string;
  /** Free variables the answer may use; [] for a constant such as \frac{\pi}{4}. */
  variables: string[];
  /** Where to sample; restricts comparison to the question's domain. */
  sample?: CalculusSampleRange;
  /** Accept rounded decimals within this relative tolerance; omit to require an exact value. */
  approximateRelative?: number;
};
export type AntiderivativeAnswerSpec = {
  kind: "antiderivative";
  value: string;
  variable: string;
  sample?: CalculusSampleRange;
  constant: "optional" | "required";
};
export type EquationAnswerSpec = {
  kind: "equation";
  /** e.g. "y = 4x - 3". */
  value: string;
  variables: string[];
  /** Accept a bare right-hand side ("4x-3") for an equation of the form y = f(x). */
  acceptExpressionFor?: string;
  sample?: CalculusSampleRange;
};
export type IntervalAnswerSpec = {
  kind: "interval";
  /** Union of intervals in interval notation, "\emptyset" for none, "\mathbb{R}" for all reals. */
  value: string;
  /** "ignore" accepts either bracket at finite endpoints (e.g. increasing on [0,2] vs (0,2)). */
  endpoints: "strict" | "ignore";
  /** Accept rounded endpoints within this relative tolerance. */
  approximateRelative?: number;
};
export type ExpressionListAnswerSpec = {
  kind: "expression_list";
  /** Items as LaTeX; a point is written "(a, b)". [] means the answer is "none". */
  values: string[];
  ordered: boolean;
  variables: string[];
  sample?: CalculusSampleRange;
  /** Accept rounded item values within this relative tolerance. */
  approximateRelative?: number;
};
export type DneAnswerSpec = { kind: "dne" };

export type CalculusSingleSpec =
  | ExpressionAnswerSpec
  | AntiderivativeAnswerSpec
  | EquationAnswerSpec
  | IntervalAnswerSpec
  | ExpressionListAnswerSpec
  | DneAnswerSpec;

export const CALCULUS_KINDS = [
  "expression",
  "antiderivative",
  "equation",
  "interval",
  "expression_list",
  "dne",
] as const;

export type CalculusCheck = {
  outcome: "correct" | "incorrect" | "unreadable";
  feedback: string;
  normalizedStudent: string;
  normalizedExpected: string;
  detail?: "close_rounding" | "wrong_form" | "unknown_token";
};

const ce = new ComputeEngine();
const MAX_INPUT = 500;
const TIGHT = 1e-9;
/** Fixed, irregular sample abscissae: deterministic and unlikely to hit special values. */
const POINTS = [
  -2.713, -2.187, -1.731, -1.214, -0.857, -0.433, -0.161, 0.137, 0.389, 0.618,
  0.891, 1.127, 1.443, 1.732, 2.071, 2.389, 2.857, 3.217, 4.13, 5.38,
];
const MIN_POINTS = 5;

// ---------------------------------------------------------------------------
// Input normalisation: plain text and MathLive LaTeX both become LaTeX.

const FUNCTIONS = [
  "arcsin",
  "arccos",
  "arctan",
  "arcsec",
  "arccsc",
  "arccot",
  "asin",
  "acos",
  "atan",
  "sinh",
  "cosh",
  "tanh",
  "sin",
  "cos",
  "tan",
  "sec",
  "csc",
  "cot",
  "ln",
  "log",
  "exp",
];
const FN_LATEX: Record<string, string> = {
  asin: "\\arcsin",
  acos: "\\arccos",
  atan: "\\arctan",
  arcsec: "\\operatorname{arcsec}",
  arccsc: "\\operatorname{arccsc}",
  arccot: "\\operatorname{arccot}",
};

function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Replace name( … ) with prefix{ … }suffix, honouring nested parentheses. */
function wrapCall(s: string, name: string, before: string, after: string) {
  let out = s;
  for (let guard = 0; guard < 20; guard++) {
    const at = out.indexOf(name + "(");
    if (at < 0) break;
    const close = matchParen(out, at + name.length);
    if (close < 0) break;
    out =
      out.slice(0, at) +
      before +
      out.slice(at + name.length + 1, close) +
      after +
      out.slice(close + 1);
  }
  return out;
}

/** Plain-text math → LaTeX. Input that is already LaTeX passes through (lightly cleaned). */
export function toLatex(input: string): string {
  let s = input.trim().slice(0, MAX_INPUT);
  s = s
    .replace(/^\$+|\$+$/g, "")
    .replace(/^\\\(|\\\)$/g, "")
    .replace(/^\\\[|\\\]$/g, "")
    .trim();
  const isLatex = /\\[A-Za-z]/.test(s);
  s = s
    .replace(/[−–—]/g, "-")
    .replace(/[×·∙]/g, "*")
    .replace(/÷/g, "/")
    .replace(/π/g, "\\pi ")
    .replace(/∞/g, "\\infty ")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/≤/g, "\\le ")
    .replace(/≥/g, "\\ge ")
    .replace(/∪/g, "\\cup ")
    .replace(/∅/g, "\\emptyset ")
    .replace(/±/g, "\\pm ");
  if (isLatex) {
    return s
      .replace(/\\dfrac|\\tfrac/g, "\\frac")
      .replace(/\\left\.|\\right\./g, "")
      .replace(/\*/g, "\\cdot ");
  }
  s = s
    .replace(/√\s*\(/g, "sqrt(")
    .replace(/√\s*([A-Za-z0-9.]+)/g, "sqrt($1)")
    .replace(/\*\*/g, "^")
    .replace(/\binfinity\b|\binf\b/gi, "\\infty ")
    .replace(/(?<![A-Za-z])pi(?![A-Za-z])/g, "\\pi ");
  // "1/6 x" (a numeric fraction, then a space and a term) means (1/6)·x.
  s = s.replace(
    /(?<![\w.)])(\d+)\s*\/\s*(\d+)\s+(?=[A-Za-z(])/g,
    "\\frac{$1}{$2}",
  );
  s = wrapCall(s, "cbrt", "\\sqrt[3]{", "}");
  s = wrapCall(s, "sqrt", "\\sqrt{", "}");
  s = wrapCall(s, "abs", "\\left|", "\\right|");
  // One left-to-right pass, longest names first, so "arcsin" never becomes "arc\\sin".
  const names = new RegExp(
    `(?<!\\\\)(${FUNCTIONS.join("|")})(?=\\s*[(A-Za-z0-9^_])`,
    "g",
  );
  s = s.replace(names, (fn) => (FN_LATEX[fn] ?? "\\" + fn) + " ");
  s = s.replace(/\\log\s+_/g, "\\log_");
  // "ln2/ln5", "sin x" → "\ln(2)/\ln(5)", "\sin(x)": one-token arguments get parentheses.
  s = s.replace(
    /(\\(?:ln|log|sin|cos|tan|sec|csc|cot|exp|arcsin|arccos|arctan))\s+([0-9.]+|[A-Za-z])(?![0-9.(^A-Za-z_])/g,
    "$1($2)",
  );
  // Decimal or negative exponents: 2^0.2 → 2^{0.2}, x^-1 → x^{-1}.
  s = s.replace(/\^\s*(-?\d+(?:\.\d+)?)/g, "^{$1}");
  // Exponents written with parentheses: x^(1/2) → x^{1/2}.
  for (let guard = 0; guard < 20; guard++) {
    const at = s.indexOf("^(");
    if (at < 0) break;
    const close = matchParen(s, at + 1);
    if (close < 0) break;
    s =
      s.slice(0, at) + "^{" + s.slice(at + 2, close) + "}" + s.slice(close + 1);
  }
  return s.replace(/\*/g, "\\cdot ");
}

type Boxed = NonNullable<ReturnType<typeof ce.parse>>;

function parse(latex: string): Boxed | undefined {
  try {
    const expr = ce.parse(latex);
    if (!expr || !expr.isValid) return undefined;
    return expr;
  } catch {
    return undefined;
  }
}

function unknownsOf(expr: Boxed): string[] {
  try {
    return [...(expr.unknowns ?? [])].map(String);
  } catch {
    return [];
  }
}

/** Real value of expr at the assignment, or undefined when non-real/undefined. */
function realAt(
  expr: Boxed,
  assignment: Record<string, number>,
): number | undefined {
  try {
    const r = (
      Object.keys(assignment).length ? expr.subs(assignment) : expr
    ).N();
    const re = typeof r.re === "number" ? r.re : Number(r.valueOf());
    const im = typeof r.im === "number" ? r.im : 0;
    if (!Number.isFinite(re) || Number.isNaN(re)) {
      if (re === Infinity || re === -Infinity) return re;
      return undefined;
    }
    if (Math.abs(im) > 1e-9 * (1 + Math.abs(re))) return undefined;
    return re;
  } catch {
    return undefined;
  }
}

/** A bare \log is read both as natural and as base-10 log; either may match. */
function logVariants(latex: string): string[] {
  return /\\log(?!_)/.test(latex)
    ? [latex, latex.replace(/\\log(?!_)/g, "\\ln")]
    : [latex];
}

function close(a: number, b: number, rel: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= rel * (1 + Math.abs(b));
}

function samplePoints(range?: CalculusSampleRange): number[] {
  if (!range) return POINTS;
  const { min, max } = range;
  const span = max - min;
  return POINTS.map(
    (p, i) =>
      min +
      span * (((((p + 3) * 7919 + i * 104729) % 1000) / 1000) * 0.94 + 0.03),
  );
}

function assignments(
  variables: string[],
  range?: CalculusSampleRange,
): Record<string, number>[] {
  const pts = samplePoints(range);
  if (variables.length === 0) return [{}];
  return pts.map((p, i) => {
    const a: Record<string, number> = {};
    variables.forEach(
      (v, j) =>
        (a[v] =
          j === 0
            ? p
            : pts[(i * 7 + j * 3) % pts.length] * (j % 2 ? -0.83 : 1.17)),
    );
    return a;
  });
}

type Compare = "equal" | "different" | "insufficient";

/**
 * Compare two expressions on the sample set. The student must be defined and
 * agree wherever the expected answer is defined. `shift` allows an additive
 * constant (antiderivatives).
 */
function compareExpressions(
  expected: Boxed,
  student: Boxed,
  variables: string[],
  range: CalculusSampleRange | undefined,
  rel: number,
  shift = false,
): Compare {
  if (variables.length === 0) {
    const e = realAt(expected, {});
    const s = realAt(student, {});
    if (e === undefined || s === undefined) return "different";
    if (!Number.isFinite(e) || !Number.isFinite(s))
      return e === s ? "equal" : "different";
  }
  let used = 0;
  let offset: number | undefined;
  for (const a of assignments(variables, range)) {
    const e = realAt(expected, a);
    if (e === undefined || !Number.isFinite(e)) continue;
    const s = realAt(student, a);
    if (s === undefined || !Number.isFinite(s)) return "different";
    used++;
    if (shift) {
      const d = s - e;
      if (offset === undefined) offset = d;
      else if (!close(d, offset, rel * 10)) return "different";
    } else if (!close(s, e, rel)) return "different";
  }
  return used >= (variables.length ? MIN_POINTS : 1) ? "equal" : "insufficient";
}

function result(
  outcome: CalculusCheck["outcome"],
  student: string,
  expected: string,
  feedback?: string,
  detail?: CalculusCheck["detail"],
): CalculusCheck {
  return {
    outcome,
    normalizedStudent: student.slice(0, MAX_INPUT),
    normalizedExpected: expected.slice(0, MAX_INPUT),
    detail,
    feedback:
      feedback ??
      (outcome === "correct"
        ? "Correct."
        : outcome === "unreadable"
          ? "I could not read that answer. Check the notation (for example sin(x), sqrt(x), x^2, e^(2x))."
          : "Not quite."),
  };
}

const allowedSymbols = new Set([
  "e",
  "ExponentialE",
  "Pi",
  "pi",
  "i",
  "ImaginaryUnit",
]);

function extraneous(
  expr: Boxed,
  variables: string[],
  also: string[] = [],
): string[] {
  return unknownsOf(expr).filter(
    (u) =>
      !variables.includes(u) && !also.includes(u) && !allowedSymbols.has(u),
  );
}

// ---------------------------------------------------------------------------
// Kinds

const DNE_WORDS =
  /^(dne|d\.n\.e\.?|does\s*not\s*exist|doesn'?t\s*exist|no\s*limit|undefined|the\s*limit\s*does\s*not\s*exist)$/i;

function cleanWords(s: string) {
  return s
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/[$]/g, "")
    .replace(/\\[,;!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function infinity(latex: string): number | undefined {
  const t = latex.replace(/\s|\\left|\\right/g, "");
  if (/^\+?\\infty$/.test(t)) return Infinity;
  if (/^-\\infty$/.test(t)) return -Infinity;
  return undefined;
}

const UNIT_WORD =
  "(?:(?:square|sq\\.?|cubic|cu\\.?)\\s+)?(?:ft|feet|foot|in|inch|inches|cm|mm|m|meters?|km|mi|miles?|s|sec|seconds?|min|minutes?|h|hr|hrs|hours?|gal|gallons?|L|liters?|ml|lb|lbs|rad|radians?|degrees?|deg|units?|people|dollars?)";
const UNIT_TAIL = new RegExp(
  `(?:\\s*\\\\text\\{\\s*|\\s+)${UNIT_WORD}(?:\\^?\\{?\\d\\}?)?(?:\\s*(?:/|\\\\cdot|\\s|per)\\s*${UNIT_WORD}(?:\\^?\\{?\\d\\}?)?)*\\s*\\}?\\s*$`,
  "i",
);

/**
 * "f'(x) = 2x", "y = 3/x", "dy/dx = …", "L = 4" → the right-hand side, when the
 * left side only names the answer. A left side that uses the answer's own
 * variables as more than a function argument is left alone.
 */
function withoutAnswerName(text: string, variables: string[]): string {
  const at = text.search(/(?<![<>!\\])=(?!=)/);
  if (at < 0 || text.indexOf("=", at + 1) >= 0) return text;
  const lhs = text
    .slice(0, at)
    .replace(/\\left|\\right|\s/g, "")
    .replace(/\\prime/g, "'")
    // "(f^{-1})'(3)" → "f^{-1}'(3)"
    .replace(/^\(([A-Za-z](?:\^\{?-1\}?)?)\)/, "$1");
  const named =
    /^[A-Za-z](?:'{1,3}|\^\{'{1,3}\}|\^\{?-1\}?|_\{?\w+\}?|\^\{?\(\d\)\}?){0,2}(?:\([^()=]{1,16}\))?$/.test(
      lhs,
    ) ||
    /^(?:\\frac\{d\^?\{?\d?\}?(?:[a-zA-Z]|\\[a-z]+|[θφα-ω])\}\{d[a-z]\^?\{?\d?\}?\}|d\^?\d?(?:[a-zA-Z]|\\[a-z]+|[θφα-ω])\/d[a-z]\^?\d?)$/.test(
      lhs,
    );
  if (!named) return text;
  const bare = lhs.replace(/\([^()]*\)$/, "");
  // "x = 2" when x is the answer's own variable is an equation, not a label.
  if (variables.includes(bare)) return text;
  return text.slice(at + 1).trim();
}

/** "2 ft/s" → "2": units after a constant answer are ignored (the question states them). */
function withoutUnits(text: string): string {
  return text.replace(UNIT_TAIL, "").trim();
}

const WORDS_ONLY = /^(?:\\text\{)?[A-Za-z°$%][A-Za-z°$%/^0-9.\-\s{}]*\}?$/;
const MATH_WORDS =
  /^(?:\\?(?:sin|cos|tan|sec|csc|cot|ln|log|exp|sqrt|pi|arcsin|arccos|arctan|infty|inf|infinity|e))\b/i;

function readsCleanly(text: string, variables: string[]): boolean {
  // Words in \text{…} are never part of a mathematical answer.
  if (/\\text\{[^{}]*[A-Za-z]/.test(text)) return false;
  if ((text.match(/\{/g) ?? []).length !== (text.match(/\}/g) ?? []).length)
    return false;
  const e = parse(toLatex(text));
  return !!e && extraneous(e, variables).length === 0;
}

/**
 * Remove what is not part of the mathematical answer: a leading name
 * ("f'(1) = …", "y = …") and trailing units or words ("ft/s", "°F per hour",
 * "\text{ square units}"). Text is only removed when what remains reads as a
 * valid answer in the allowed variables, so mathematics is never discarded.
 */
function cleanAnswerText(text: string, variables: string[]): string {
  let t = withoutAnswerName(text.trim(), variables);
  if (variables.length === 0)
    t = t
      .replace(/\{,\}/g, ",")
      .replace(/^(-?\d{1,3}(?:,\d{3})+)(?![\d,])/, (m) => m.replace(/,/g, ""));
  // Trailing \text{…} is a unit or a remark, never part of the mathematics.
  const textTail = t.replace(/\\text\{[^{}]*\}\s*$/, "").trim();
  if (textTail && textTail !== t && readsCleanly(textTail, variables))
    return textTail;
  if (readsCleanly(t, variables)) return t;
  const units = withoutUnits(t);
  if (units !== t && readsCleanly(units, variables)) return units;
  const tokens = t
    .replace(/\\text\{\s+/g, "\\text{")
    .replace(/(\S)\\text\{/g, "$1 \\text{")
    .split(/\s+/);
  for (let k = tokens.length - 1; k >= 1; k--) {
    const suffix = tokens.slice(k).join(" ");
    const prefix = tokens.slice(0, k).join(" ");
    const plain = suffix
      .replace(/\\text\{([^{}]*)\}/g, "$1")
      .replace(/\\[,; ]/g, " ")
      .trim();
    if (
      !plain ||
      !WORDS_ONLY.test(plain) ||
      MATH_WORDS.test(plain) ||
      /[=()]/.test(plain)
    )
      continue;
    if (readsCleanly(prefix, variables)) return prefix;
  }
  return t;
}

function checkExpression(
  student: string,
  spec: ExpressionAnswerSpec,
): CalculusCheck {
  const expectedLatex = toLatex(spec.value);
  student = cleanAnswerText(student, spec.variables);
  const studentLatex = toLatex(student);
  const expInf = infinity(expectedLatex);
  const stuInf = infinity(studentLatex);
  if (expInf !== undefined || stuInf !== undefined) {
    if (DNE_WORDS.test(cleanWords(student)))
      return result("incorrect", student, expectedLatex);
    return result(
      expInf !== undefined && expInf === stuInf ? "correct" : "incorrect",
      studentLatex,
      expectedLatex,
    );
  }
  if (DNE_WORDS.test(cleanWords(student)))
    return result("incorrect", student, expectedLatex);
  const expected = parse(expectedLatex);
  if (!expected) return result("unreadable", studentLatex, expectedLatex);
  let sawReadable = false;
  for (const variant of logVariants(studentLatex)) {
    const stu = parse(variant);
    if (!stu) continue;
    sawReadable = true;
    if (extraneous(stu, spec.variables).length) continue;
    const cmp = compareExpressions(
      expected,
      stu,
      spec.variables,
      spec.sample,
      TIGHT * 100,
    );
    if (cmp === "equal") return result("correct", variant, expectedLatex);
  }
  if (!sawReadable) return result("unreadable", studentLatex, expectedLatex);
  const stu = parse(logVariants(studentLatex).at(-1)!)!;
  const extra = extraneous(stu, spec.variables);
  if (extra.length)
    return result(
      "incorrect",
      studentLatex,
      expectedLatex,
      `Not quite — your answer uses ${extra.join(", ")}, which the question does not define.`,
    );
  // Rounded decimals: right value, wrong form (or accepted when approximation is allowed).
  if (spec.variables.length === 0 && /\d\.\d/.test(student)) {
    const e = realAt(expected, {});
    const s = realAt(stu, {});
    if (e !== undefined && s !== undefined) {
      if (spec.approximateRelative && close(s, e, spec.approximateRelative))
        return result("correct", studentLatex, expectedLatex);
      if (close(s, e, 5e-3))
        return result(
          "incorrect",
          studentLatex,
          expectedLatex,
          "Close — give the exact value rather than a rounded decimal.",
          "close_rounding",
        );
    }
  }
  return result("incorrect", studentLatex, expectedLatex);
}

const CONSTANT_RE = /(^|[^A-Za-z\\])([CK])(?![A-Za-z])/;

function checkAntiderivative(
  student: string,
  spec: AntiderivativeAnswerSpec,
): CalculusCheck {
  const expectedLatex = toLatex(spec.value).replace(/\+\s*C\s*$/, "");
  const studentLatex = toLatex(withoutAnswerName(student, [spec.variable]));
  const hasConstant = CONSTANT_RE.test(studentLatex);
  const expected = parse(expectedLatex);
  if (!expected) return result("unreadable", studentLatex, expectedLatex);
  let readable = false;
  for (const variant of logVariants(studentLatex)) {
    const stu = parse(variant);
    if (!stu) continue;
    readable = true;
    if (extraneous(stu, [spec.variable], ["C", "K"]).length) continue;
    const zeroed = unknownsOf(stu).some((u) => u === "C" || u === "K")
      ? stu.subs({ C: 0, K: 0 })
      : stu;
    const cmp = compareExpressions(
      expected,
      zeroed,
      [spec.variable],
      spec.sample,
      TIGHT * 100,
      true,
    );
    if (cmp === "equal") {
      if (spec.constant === "required" && !hasConstant)
        return result(
          "incorrect",
          studentLatex,
          expectedLatex + " + C",
          "Almost — include the constant of integration (+ C).",
          "wrong_form",
        );
      return result(
        "correct",
        studentLatex,
        expectedLatex + " + C",
        hasConstant
          ? "Correct."
          : "Correct. (Remember that any antiderivative can have + C added.)",
      );
    }
  }
  if (!readable) return result("unreadable", studentLatex, expectedLatex);
  return result("incorrect", studentLatex, expectedLatex + " + C");
}

function splitEquation(latex: string): [string, string] | undefined {
  const parts = latex.split(/(?<![<>\\])=(?!=)/);
  return parts.length === 2 ? [parts[0], parts[1]] : undefined;
}

function checkEquation(
  student: string,
  spec: EquationAnswerSpec,
): CalculusCheck {
  const expectedLatex = toLatex(spec.value);
  const [el, er] = splitEquation(expectedLatex) ?? [];
  let studentLatex = toLatex(student);
  let sides = splitEquation(studentLatex);
  // "L(x) = …" or "f(x) = …" names the dependent variable in function notation.
  if (
    sides &&
    spec.acceptExpressionFor &&
    /^\s*[A-Za-z]\s*\\?(?:left)?\(\s*[a-z]\s*\\?(?:right)?\)\s*$/.test(sides[0])
  )
    sides = [spec.acceptExpressionFor, sides[1]];
  if (!sides && spec.acceptExpressionFor) {
    sides = [spec.acceptExpressionFor, studentLatex];
    studentLatex = `${spec.acceptExpressionFor}=${studentLatex}`;
  }
  if (el === undefined || er === undefined)
    return result("unreadable", studentLatex, expectedLatex);
  if (!sides)
    return result(
      "unreadable",
      studentLatex,
      expectedLatex,
      "Write your answer as an equation, for example y = 2x + 1.",
    );
  const expected = parse(`(${el})-(${er})`);
  const stu = parse(`(${sides[0]})-(${sides[1]})`);
  if (!expected) return result("unreadable", studentLatex, expectedLatex);
  if (!stu) return result("unreadable", studentLatex, expectedLatex);
  if (extraneous(stu, spec.variables).length)
    return result("incorrect", studentLatex, expectedLatex);
  // Same solution set when the residuals are proportional with a fixed nonzero ratio.
  let ratio: number | undefined;
  let used = 0;
  for (const a of assignments(spec.variables, spec.sample)) {
    const e = realAt(expected, a);
    const s = realAt(stu, a);
    if (
      e === undefined ||
      s === undefined ||
      !Number.isFinite(e) ||
      !Number.isFinite(s)
    )
      continue;
    if (Math.abs(e) < 1e-9) {
      if (Math.abs(s) > 1e-7)
        return result("incorrect", studentLatex, expectedLatex);
      continue;
    }
    const r = s / e;
    if (Math.abs(r) < 1e-12)
      return result("incorrect", studentLatex, expectedLatex);
    if (ratio === undefined) ratio = r;
    else if (!close(r, ratio, 1e-7))
      return result("incorrect", studentLatex, expectedLatex);
    used++;
  }
  return result(
    used >= MIN_POINTS ? "correct" : "unreadable",
    studentLatex,
    expectedLatex,
  );
}

type Interval = {
  lo: number;
  hi: number;
  loClosed: boolean;
  hiClosed: boolean;
};

function numberFrom(text: string): number | undefined {
  const latex = toLatex(text.trim());
  const inf = infinity(latex);
  if (inf !== undefined) return inf;
  const expr = parse(latex);
  if (!expr || unknownsOf(expr).filter((u) => !allowedSymbols.has(u)).length)
    return undefined;
  return realAt(expr, {});
}

/** Split at commas that are not nested in parentheses/braces. */
function topLevelSplit(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if ("({[".includes(ch)) depth++;
    if (")}]".includes(ch)) depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseIntervals(input: string): Interval[] | undefined {
  let s = toLatex(input)
    .replace(/\\left|\\right/g, "")
    .replace(/\\text\{([^}]*)\}/g, " $1 ")
    .replace(/\\mathbb\{R\}|ℝ|^\s*R\s*$/g, " ALLREALS ")
    .replace(/≠|\\neq?(?![a-z])|!=/g, " NEQ ")
    .replace(/\\emptyset|\\varnothing|\{\s*\}/g, " EMPTY ")
    .replace(/\\leq?(?![a-z])/g, "<=")
    .replace(/\\geq?(?![a-z])/g, ">=")
    .replace(/\\lt/g, "<")
    .replace(/\\gt/g, ">")
    .trim();
  s = s.replace(/^\s*[xt]\s*(?:\\in|\bin\b|∈)\s*/, "");
  // "(-inf,-2), (0,inf)": a comma between bracketed intervals is a union.
  s = s.replace(/([)\]])\s*,\s*(?=[([])/g, "$1 U ");
  if (
    /^(ALLREALS|all real numbers|\(-\\infty\s*,\s*\\infty\))$/i.test(s.trim())
  )
    return [{ lo: -Infinity, hi: Infinity, loClosed: false, hiClosed: false }];
  if (/^(EMPTY|none|no intervals?|never|nowhere)$/i.test(s.trim())) return [];
  const neq = /^\s*[a-z]\s*NEQ\s*(.+)$/.exec(s);
  if (neq) {
    const v = numberFrom(neq[1]);
    if (v === undefined || !Number.isFinite(v)) return undefined;
    return [
      { lo: -Infinity, hi: v, loClosed: false, hiClosed: false },
      { lo: v, hi: Infinity, loClosed: false, hiClosed: false },
    ];
  }
  const pieces = s
    .split(/\\cup|\bU\b|\bunion\b|\bor\b|\band\b|;/i)
    .flatMap((p) => (/^\s*[([]/.test(p) ? [p] : p.split(",")))
    .map((p) => p.trim())
    .filter(Boolean);
  const out: Interval[] = [];
  for (const piece of pieces) {
    const m = /^([([])(.+)([)\]])$/.exec(piece.replace(/\s+/g, " "));
    if (m) {
      const parts = topLevelSplit(m[2]);
      if (parts.length !== 2) return undefined;
      const lo = numberFrom(parts[0]);
      const hi = numberFrom(parts[1]);
      if (lo === undefined || hi === undefined || !(lo < hi)) return undefined;
      out.push({
        lo,
        hi,
        loClosed: m[1] === "[" && Number.isFinite(lo),
        hiClosed: m[3] === "]" && Number.isFinite(hi),
      });
      continue;
    }
    // Inequalities in x: a < x < b, x > a, x <= b, a > x ...
    const t = piece.replace(/\s+/g, "");
    let q = /^(.+?)(<=|<)([a-z])(<=|<)(.+)$/.exec(t);
    if (q) {
      const lo = numberFrom(q[1]),
        hi = numberFrom(q[5]);
      if (lo === undefined || hi === undefined || !(lo < hi)) return undefined;
      out.push({ lo, hi, loClosed: q[2] === "<=", hiClosed: q[4] === "<=" });
      continue;
    }
    q = /^(.+?)(>=|>)([a-z])(>=|>)(.+)$/.exec(t);
    if (q) {
      const hi = numberFrom(q[1]),
        lo = numberFrom(q[5]);
      if (lo === undefined || hi === undefined || !(lo < hi)) return undefined;
      out.push({ lo, hi, loClosed: q[4] === ">=", hiClosed: q[2] === ">=" });
      continue;
    }
    q =
      /^([a-z])(<=|<|>=|>)(.+)$/.exec(t) ??
      (() => {
        const r = /^(.+?)(<=|<|>=|>)([a-z])$/.exec(t);
        if (!r) return null;
        const flip: Record<string, string> = {
          "<": ">",
          "<=": ">=",
          ">": "<",
          ">=": "<=",
        };
        return [r[0], r[3], flip[r[2]], r[1]] as unknown as RegExpExecArray;
      })();
    if (q) {
      const v = numberFrom(q[3]);
      if (v === undefined || !Number.isFinite(v)) return undefined;
      if (q[2].startsWith("<"))
        out.push({
          lo: -Infinity,
          hi: v,
          loClosed: false,
          hiClosed: q[2] === "<=",
        });
      else
        out.push({
          lo: v,
          hi: Infinity,
          loClosed: q[2] === ">=",
          hiClosed: false,
        });
      continue;
    }
    return undefined;
  }
  return out;
}

function normalizeIntervals(list: Interval[], ignoreEnds: boolean): Interval[] {
  const sorted = [...list]
    .map((i) => (ignoreEnds ? { ...i, loClosed: false, hiClosed: false } : i))
    .sort((a, b) => a.lo - b.lo || Number(b.loClosed) - Number(a.loClosed));
  const merged: Interval[] = [];
  for (const i of sorted) {
    const last = merged.at(-1);
    if (
      last &&
      (i.lo < last.hi ||
        (close(i.lo, last.hi, 1e-12) && (last.hiClosed || i.loClosed)))
    ) {
      if (i.hi > last.hi || (close(i.hi, last.hi, 1e-12) && i.hiClosed)) {
        last.hi = i.hi;
        last.hiClosed =
          i.hiClosed || (close(i.hi, last.hi, 1e-12) && last.hiClosed);
      }
    } else merged.push({ ...i });
  }
  return merged;
}

function showIntervals(list: Interval[]): string {
  if (!list.length) return "∅";
  const n = (v: number) =>
    v === Infinity
      ? "∞"
      : v === -Infinity
        ? "-∞"
        : String(Number(v.toFixed(10)));
  return list
    .map(
      (i) =>
        `${i.loClosed ? "[" : "("}${n(i.lo)}, ${n(i.hi)}${i.hiClosed ? "]" : ")"}`,
    )
    .join(" ∪ ");
}

function checkInterval(
  student: string,
  spec: IntervalAnswerSpec,
): CalculusCheck {
  const expected = parseIntervals(spec.value);
  if (!expected) return result("unreadable", student, spec.value);
  const got = parseIntervals(student);
  if (!got)
    return result(
      "unreadable",
      student,
      showIntervals(expected),
      "I could not read that as intervals. Try forms like (-inf, -2) U (0, inf) or x < -2 or x > 0.",
    );
  const ignore = spec.endpoints === "ignore";
  const a = normalizeIntervals(expected, ignore);
  const b = normalizeIntervals(got, ignore);
  const tol = spec.approximateRelative ?? 1e-9;
  const same =
    a.length === b.length &&
    a.every(
      (x, i) =>
        close(x.lo, b[i].lo, tol) &&
        close(x.hi, b[i].hi, tol) &&
        x.loClosed === b[i].loClosed &&
        x.hiClosed === b[i].hiClosed,
    );
  if (same) return result("correct", showIntervals(b), showIntervals(a));
  const sameIgnoringEnds =
    !ignore &&
    normalizeIntervals(expected, true).length ===
      normalizeIntervals(got, true).length &&
    normalizeIntervals(expected, true).every((x, i) => {
      const y = normalizeIntervals(got, true)[i];
      return close(x.lo, y.lo, 1e-9) && close(x.hi, y.hi, 1e-9);
    });
  return result(
    "incorrect",
    showIntervals(b),
    showIntervals(a),
    sameIgnoringEnds
      ? "Close — check whether each endpoint is included (brackets vs parentheses)."
      : undefined,
    sameIgnoringEnds ? "wrong_form" : undefined,
  );
}

const NONE_WORDS =
  /^(none|no\s+[a-z][a-z\s-]*|there\s*(are|is)\s*(none|no\s+[a-z][a-z\s-]*)|∅|\\emptyset|\{\s*\})$/i;
/^(none|no\s*(such\s*)?(points?|values?|solutions?|critical\s*(numbers?|points?)|asymptotes?)|there\s*(are|is)\s*none|∅|\\emptyset|\{\s*\})$/i;

function listItems(input: string): string[] {
  // "x = 9, y = 729" names the coordinates of one point.
  input = input.replace(
    /\bx\s*=\s*([^,;]+?)\s*,\s*y\s*=\s*([^,;]+)/g,
    "($1, $2)",
  );
  let s = toLatex(input)
    .replace(/\\left|\\right/g, "")
    .trim();
  if (/^\\\{[\s\S]*\\\}$/.test(s)) s = s.slice(2, -2);
  else if (/^\{[\s\S]*\}$/.test(s)) s = s.slice(1, -1);
  return topLevelSplit(s.replace(/;/g, ","))
    .flatMap((p) => p.split(/\band\b|\\text\{\s*and\s*\}/))
    .map((p) => p.trim().replace(/^[a-z]\s*=\s*/, ""))
    .flatMap((p) =>
      /\\pm/.test(p) ? [p.replace(/\\pm/, "+"), p.replace(/\\pm/, "-")] : [p],
    )
    .map((p) => p.replace(/^\+\s*/, ""))
    .filter(Boolean);
}

function itemValues(
  item: string,
  variables: string[],
  range?: CalculusSampleRange,
): Boxed[] | undefined {
  const t = item.trim();
  const tuple = /^\((.*)\)$/.exec(t);
  const comps =
    tuple && topLevelSplit(tuple[1]).length > 1 ? topLevelSplit(tuple[1]) : [t];
  const out: Boxed[] = [];
  for (const raw of comps) {
    const c = cleanAnswerText(raw, variables);
    const latex = toLatex(c).replace(/\\log(?!_)/g, "\\ln");
    const inf = infinity(latex);
    const e = inf !== undefined ? ce.number(inf) : parse(latex);
    if (!e || extraneous(e, variables).length) return undefined;
    out.push(e);
  }
  void range;
  return out;
}

function sameItem(
  a: Boxed[],
  b: Boxed[],
  spec: ExpressionListAnswerSpec,
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        compareExpressions(
          x,
          b[i],
          spec.variables,
          spec.sample,
          spec.approximateRelative ?? TIGHT * 100,
        ) === "equal",
    )
  );
}

function checkExpressionList(
  student: string,
  spec: ExpressionListAnswerSpec,
): CalculusCheck {
  const label = spec.values.length ? spec.values.join(", ") : "none";
  if (NONE_WORDS.test(cleanWords(student)))
    return result(
      spec.values.length === 0 ? "correct" : "incorrect",
      "none",
      label,
    );
  const expected = spec.values.map((v) =>
    itemValues(v, spec.variables, spec.sample),
  );
  if (expected.some((e) => !e)) return result("unreadable", student, label);
  const items = listItems(student).map((i) =>
    itemValues(i, spec.variables, spec.sample),
  );
  if (!items.length || items.some((i) => !i))
    return result(
      "unreadable",
      student,
      label,
      "I could not read that list. Separate values with commas, for example x = -1, 2.",
    );
  const got = items as Boxed[][];
  const want = expected as Boxed[][];
  let ok = got.length === want.length;
  if (ok && spec.ordered) ok = want.every((w, i) => sameItem(w, got[i], spec));
  else if (ok) {
    const used = new Set<number>();
    ok = want.every((w) => {
      const j = got.findIndex((g, k) => !used.has(k) && sameItem(w, g, spec));
      if (j < 0) return false;
      used.add(j);
      return true;
    });
  }
  const missingOrExtra = !ok && got.length !== want.length;
  return result(
    ok ? "correct" : "incorrect",
    student.trim(),
    label,
    missingOrExtra
      ? `Not quite — the answer has ${want.length === 0 ? "no" : want.length} item${want.length === 1 ? "" : "s"}.`
      : undefined,
  );
}

const DNE_PREFIX =
  /^(dne|d\.n\.e\.?|does\s*not\s*exist|doesn'?t\s*exist|no\s*limit|the\s*limit\s*does\s*not\s*exist)\b\s*(?:[,.;:]|since|because|as|—|-)/i;

function checkDne(student: string): CalculusCheck {
  if (DNE_PREFIX.test(cleanWords(student)))
    return result("correct", cleanWords(student), "does not exist");
  return result(
    DNE_WORDS.test(cleanWords(student)) ? "correct" : "incorrect",
    cleanWords(student),
    "does not exist",
  );
}

export function checkCalculusAnswer(
  student: string,
  spec: CalculusSingleSpec,
): CalculusCheck {
  const input = student.slice(0, MAX_INPUT);
  if (!input.trim())
    return result(
      "unreadable",
      "",
      "",
      "Enter an answer so the tutor can check it.",
    );
  switch (spec.kind) {
    case "expression":
      return checkExpression(input, spec);
    case "antiderivative":
      return checkAntiderivative(input, spec);
    case "equation":
      return checkEquation(input, spec);
    case "interval":
      return checkInterval(input, spec);
    case "expression_list":
      return checkExpressionList(input, spec);
    case "dne":
      return checkDne(input);
  }
}

// ---------------------------------------------------------------------------
// Validation of authored specs.

const isText = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= MAX_INPUT;
const isVars = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length <= 3 &&
  v.every((x) => typeof x === "string" && /^[a-zA-Z]$/.test(x));
const isRange = (v: unknown) =>
  v === undefined ||
  (!!v &&
    typeof v === "object" &&
    Number.isFinite((v as CalculusSampleRange).min) &&
    Number.isFinite((v as CalculusSampleRange).max) &&
    (v as CalculusSampleRange).min < (v as CalculusSampleRange).max);
const onlyKeys = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).every((k) => keys.includes(k));

/** Structural and semantic problems with a calculus spec; [] when usable. */
export function calculusSpecProblems(value: Record<string, unknown>): string[] {
  const p: string[] = [];
  switch (value.kind) {
    case "expression": {
      if (
        !onlyKeys(value, [
          "kind",
          "value",
          "variables",
          "sample",
          "approximateRelative",
        ]) ||
        !isText(value.value) ||
        !isVars(value.variables) ||
        !isRange(value.sample)
      )
        return [
          "Expression specs need a value, variables (single letters) and an optional sample range.",
        ];
      if (
        value.approximateRelative !== undefined &&
        !(
          typeof value.approximateRelative === "number" &&
          value.approximateRelative > 0 &&
          value.approximateRelative <= 0.05
        )
      )
        p.push("approximateRelative must be in (0, 0.05].");
      const latex = toLatex(value.value);
      if (infinity(latex) !== undefined) break;
      const e = parse(latex);
      if (!e) return ["The expected expression does not parse."];
      if (extraneous(e, value.variables as string[]).length)
        p.push(
          `Expected value uses undeclared symbols: ${extraneous(e, value.variables as string[]).join(", ")}.`,
        );
      else if (
        compareExpressions(
          e,
          e,
          value.variables as string[],
          value.sample as CalculusSampleRange | undefined,
          1e-9,
        ) !== "equal"
      )
        p.push(
          "The expected expression is undefined at too many sample points; give a sample range inside its domain.",
        );
      break;
    }
    case "antiderivative": {
      if (
        !onlyKeys(value, ["kind", "value", "variable", "sample", "constant"]) ||
        !isText(value.value) ||
        typeof value.variable !== "string" ||
        !/^[a-zA-Z]$/.test(value.variable) ||
        !isRange(value.sample) ||
        !["optional", "required"].includes(String(value.constant))
      )
        return [
          "Antiderivative specs need a value, a single-letter variable, constant policy and an optional sample range.",
        ];
      const e = parse(toLatex(value.value).replace(/\+\s*C\s*$/, ""));
      if (!e) return ["The expected antiderivative does not parse."];
      if (
        compareExpressions(
          e,
          e,
          [value.variable],
          value.sample as CalculusSampleRange | undefined,
          1e-9,
        ) !== "equal"
      )
        p.push(
          "The expected antiderivative is undefined at too many sample points; give a sample range inside its domain.",
        );
      break;
    }
    case "equation": {
      if (
        !onlyKeys(value, [
          "kind",
          "value",
          "variables",
          "acceptExpressionFor",
          "sample",
        ]) ||
        !isText(value.value) ||
        !isVars(value.variables) ||
        !isRange(value.sample) ||
        (value.acceptExpressionFor !== undefined &&
          !(
            typeof value.acceptExpressionFor === "string" &&
            /^[a-zA-Z]$/.test(value.acceptExpressionFor)
          ))
      )
        return [
          "Equation specs need a value with one '=', variables and optional acceptExpressionFor.",
        ];
      const sides = splitEquation(toLatex(value.value));
      if (!sides || !parse(`(${sides[0]})-(${sides[1]})`))
        p.push("The expected equation does not parse as a single equation.");
      break;
    }
    case "interval": {
      if (
        !onlyKeys(value, [
          "kind",
          "value",
          "endpoints",
          "approximateRelative",
        ]) ||
        (value.approximateRelative !== undefined &&
          !(
            typeof value.approximateRelative === "number" &&
            value.approximateRelative > 0 &&
            value.approximateRelative <= 0.05
          )) ||
        !isText(value.value) ||
        !["strict", "ignore"].includes(String(value.endpoints))
      )
        return ["Interval specs need a value and an endpoints policy."];
      if (!parseIntervals(value.value))
        p.push("The expected intervals do not parse.");
      break;
    }
    case "expression_list": {
      if (
        !onlyKeys(value, [
          "kind",
          "values",
          "ordered",
          "variables",
          "sample",
          "approximateRelative",
        ]) ||
        (value.approximateRelative !== undefined &&
          !(
            typeof value.approximateRelative === "number" &&
            value.approximateRelative > 0 &&
            value.approximateRelative <= 0.05
          )) ||
        !Array.isArray(value.values) ||
        value.values.length > 32 ||
        !value.values.every(isText) ||
        typeof value.ordered !== "boolean" ||
        !isVars(value.variables) ||
        !isRange(value.sample)
      )
        return [
          "Expression lists need values (possibly empty), ordered, variables and an optional sample range.",
        ];
      if (
        (value.values as string[]).some(
          (v) => !itemValues(v, value.variables as string[]),
        )
      )
        p.push("An expected list item does not parse.");
      break;
    }
    case "dne":
      if (!onlyKeys(value, ["kind"])) p.push("DNE specs take no options.");
      break;
    default:
      p.push("Unknown calculus answer kind.");
  }
  return p;
}
