/**
 * Answer notation: what the math answer field shows, and what it sends.
 *
 * The server grades a small numeric grammar (`parseRational` in
 * `src/lib/tutor/answer/rational.ts`): a number, `a/b`, `\frac{a}{b}`, a
 * percent, scientific notation. The field lets students write more than that
 * (powers, roots, π, e, factorials, binomials, parentheses, + − × ÷), so this
 * module turns every entry into one checker-plain string:
 *
 * - An entry that already fits the grammar is sent **verbatim** and never
 *   reduced (`2/4` stays `2/4`, so the form check can still say
 *   "unsimplified").
 * - Anything else is evaluated here: exactly with BigInt rationals where the
 *   result is rational (sent as `p/q` in lowest terms or an integer), and as a
 *   15-significant-digit decimal when it is not (roots, π, e, non-integer
 *   powers).
 * - A decimal comma or a mixed number is rejected with a one-line hint.
 * - Anything unreadable is sent raw, and the server answers "Couldn't read
 *   that answer" (not counted as an attempt).
 *
 * Pure: no DOM, no React, safe in node tests and on the server.
 */

import { parseRational } from "@/lib/tutor/answer/rational";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AnswerEntryStatus =
  /** Nothing typed. */
  | "empty"
  /** Fits the checker grammar; `sent` is the entry as written. */
  | "grammar"
  /** An expression evaluated here; `sent` is its value. */
  | "evaluated"
  /** Readable but refused (decimal comma, mixed number); see `hint`. */
  | "rejected"
  /** Could not be read; `sent` is the raw entry. */
  | "unparsed";

export type AnswerEntry = {
  status: AnswerEntryStatus;
  /** The checker-plain string that is sent and graded. */
  sent: string;
  /** KaTeX source for how the entry reads ("\left(\frac{1}{2}\right)^{3}"). */
  notation?: string;
  /** KaTeX source for the value ("\frac{1}{8}", "1.4142"). Evaluated only. */
  valueLatex?: string;
  /** The value is a rounded decimal (irrational result). */
  approximate?: boolean;
  value?: number;
  /** One plain sentence shown instead of a reading ("Use a point for decimals."). */
  hint?: string;
};

export const DECIMAL_COMMA_HINT = "Use a point for decimals.";
export const MIXED_NUMBER_HINT = "Write 3/2 or 1.5, not 1 1/2.";
export const TOO_LARGE_HINT =
  "That number is too large to check. Try a simpler form.";

// ---------------------------------------------------------------------------
// Format hint → answer type (one helper for practice and the landing hero)
// ---------------------------------------------------------------------------

const NUMERIC_FORMAT_HINT = /decimal|fraction|percent|number|numeric|digit/i;
const LIST_FORMAT_HINT = /separated by commas/i;

/**
 * The one word for the Sheet's mono header line, derived from the
 * plain-language format hint the student reads under the field, so the two
 * never disagree.
 */
export function answerTypeFromHint(
  inputFormatHint: string,
): "numeric" | "text" {
  return NUMERIC_FORMAT_HINT.test(inputFormatHint) ? "numeric" : "text";
}

/**
 * Which answer field a question gets: the math field (and keypad) for single
 * numeric answers; the plain text input for words and for number lists.
 */
export function answerNotationFromHint(
  inputFormatHint: string,
): "math" | "text" {
  return answerTypeFromHint(inputFormatHint) === "numeric" &&
    !LIST_FORMAT_HINT.test(inputFormatHint)
    ? "math"
    : "text";
}

/** The question asks for a percentage, so the keypad highlights `%`. */
export function formatHintAsksForPercent(inputFormatHint: string): boolean {
  return /asks for a percentage/i.test(inputFormatHint);
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type Op =
  | "+"
  | "-"
  | "*"
  | "/"
  | "div"
  | "^"
  | "!"
  | "%"
  | "("
  | ")"
  | "["
  | "]"
  | ",";

type Tok =
  | { k: "num"; text: string }
  | { k: "op"; v: Op }
  | { k: "const"; v: "pi" | "e" }
  /** `\frac{a}{b}`, `½`: arguments already tokenized. */
  | { k: "frac"; a: Tok[]; b: Tok[] }
  | { k: "binom"; a: Tok[]; b: Tok[] }
  | { k: "sqrt"; arg?: Tok[]; index?: Tok[] }
  /** LaTeX `^{...}`: the exponent already tokenized. */
  | { k: "sup"; arg: Tok[] }
  /** LaTeX braces `{...}`: an invisible group. */
  | { k: "group"; toks: Tok[] }
  /** Plain `C(`: n choose k, arguments follow as `n , k )`. */
  | { k: "choose" };

class NotationError extends Error {
  constructor(readonly hint?: string) {
    super(hint ?? "unreadable");
  }
}

function fail(hint?: string): never {
  throw new NotationError(hint);
}

const isDigit = (char: string | undefined) =>
  char !== undefined && char >= "0" && char <= "9";

/**
 * Reads a number literal starting at `start`: digits, one decimal point,
 * thousands separators (`,`, and in LaTeX `{,}` or `\,`) and an `e±n`
 * exponent. Returns the literal in plain form ("1,000.5", "1.2e-3").
 */
function readNumber(
  src: string,
  start: number,
  latex: boolean,
): { text: string; end: number } {
  let i = start;
  let text = "";
  const separatorAt = (at: number): number => {
    // The length of a thousands separator at `at`, when a digit follows.
    for (const sep of latex ? ["{,}", "\\,", ","] : [","]) {
      if (src.startsWith(sep, at) && isDigit(src[at + sep.length])) {
        return sep.length;
      }
    }
    return 0;
  };

  while (i < src.length) {
    const char = src[i];
    if (isDigit(char) || char === ".") {
      text += char;
      i += 1;
      continue;
    }
    const sep = separatorAt(i);
    if (sep > 0 && text.length > 0 && !text.includes(".")) {
      // A thousands separator is followed by exactly three digits. Anything
      // else ends the number here: the comma is then a stray decimal comma
      // (rejected by the parser) or, in plain `C(10,3)`, an argument separator.
      let run = 0;
      while (isDigit(src[i + sep + run])) run += 1;
      if (run !== 3) break;
      text += ",";
      i += sep;
      continue;
    }
    break;
  }

  if ((text.match(/\./g) ?? []).length > 1 || text === ".") {
    fail();
  }
  if (text.includes(",")) {
    const integer = text.split(".")[0];
    if (
      !/^[0-9]{1,3}(?:,[0-9]{3})+$/.test(integer) ||
      integer.startsWith("0,")
    ) {
      fail(DECIMAL_COMMA_HINT);
    }
  }

  // Scientific notation, as the checker reads it: 1.2e-3, 3E5.
  const exponent = /^[eE]([+-]?)(\d+)/.exec(src.slice(i));
  if (exponent) {
    text += `e${exponent[1] === "+" ? "" : exponent[1]}${exponent[2]}`;
    i += exponent[0].length;
  }
  return { text, end: i };
}

const UNICODE_FRACTIONS: Record<string, [string, string]> = {
  "½": ["1", "2"],
  "¼": ["1", "4"],
  "¾": ["3", "4"],
};

/** Plain text a student typed (or the keypad inserted before MathLive loads). */
function tokenizePlain(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const char = src[i];
    const rest = src.slice(i);
    if (/\s/.test(char)) {
      i += 1;
    } else if (isDigit(char) || (char === "." && isDigit(src[i + 1]))) {
      const { text, end } = readNumber(src, i, false);
      toks.push({ k: "num", text });
      i = end;
    } else if (UNICODE_FRACTIONS[char]) {
      const [a, b] = UNICODE_FRACTIONS[char];
      toks.push({
        k: "frac",
        a: [{ k: "num", text: a }],
        b: [{ k: "num", text: b }],
      });
      i += 1;
    } else if (rest.startsWith("**")) {
      toks.push({ k: "op", v: "^" });
      i += 2;
    } else if (/^percent/i.test(rest)) {
      toks.push({ k: "op", v: "%" });
      i += 7;
    } else if (/^sqrt/i.test(rest)) {
      toks.push({ k: "sqrt" });
      i += 4;
    } else if (/^pi(?![a-z])/i.test(rest)) {
      toks.push({ k: "const", v: "pi" });
      i += 2;
    } else if (/^C\s*\(/.test(rest)) {
      toks.push({ k: "choose" });
      i += 1;
    } else {
      const single: Record<string, Tok> = {
        "+": { k: "op", v: "+" },
        "-": { k: "op", v: "-" },
        "−": { k: "op", v: "-" },
        "*": { k: "op", v: "*" },
        "×": { k: "op", v: "*" },
        "·": { k: "op", v: "*" },
        "/": { k: "op", v: "/" },
        "÷": { k: "op", v: "div" },
        "^": { k: "op", v: "^" },
        "!": { k: "op", v: "!" },
        "%": { k: "op", v: "%" },
        "(": { k: "op", v: "(" },
        ")": { k: "op", v: ")" },
        ",": { k: "op", v: "," },
        π: { k: "const", v: "pi" },
        e: { k: "const", v: "e" },
        "√": { k: "sqrt" },
      };
      const tok = single[char];
      if (!tok) fail();
      toks.push(tok);
      i += 1;
    }
  }
  return toks;
}

/** Reads a balanced `{...}` starting at `open` (which must be `{`). */
function readBraced(src: string, open: number): { body: string; end: number } {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "\\") {
      i += 1;
      continue;
    }
    if (src[i] === "{") depth += 1;
    if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return { body: src.slice(open + 1, i), end: i + 1 };
    }
  }
  return fail();
}

/** Reads a balanced `[...]` starting at `open`. */
function readBracketed(
  src: string,
  open: number,
): { body: string; end: number } {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    if (src[i] === "}") depth -= 1;
    if (src[i] === "]" && depth === 0) {
      return { body: src.slice(open + 1, i), end: i };
    }
  }
  return fail();
}

const SKIPPED_COMMANDS = new Set([
  "left",
  "right",
  "bigl",
  "bigr",
  "Bigl",
  "Bigr",
  "quad",
  "qquad",
  "displaystyle",
  "textstyle",
]);

/**
 * One TeX argument: a braced group, a single command, or a single character
 * (`\frac12` is one half).
 */
function readArg(src: string, at: number): { toks: Tok[]; end: number } {
  let i = at;
  while (src[i] === " ") i += 1;
  if (src[i] === "{") {
    const { body, end } = readBraced(src, i);
    return { toks: tokenizeLatex(body), end };
  }
  if (src[i] === "\\") {
    let j = i + 1;
    while (/[a-zA-Z]/.test(src[j] ?? "")) j += 1;
    if (j === i + 1) j += 1;
    return { toks: tokenizeLatex(src.slice(i, j)), end: j };
  }
  if (i >= src.length) fail();
  return { toks: tokenizeLatex(src[i]), end: i + 1 };
}

/** The LaTeX a MathLive field produces. */
function tokenizeLatex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const char = src[i];
    if (/\s/.test(char) || char === "~") {
      i += 1;
      continue;
    }
    if (isDigit(char) || (char === "." && isDigit(src[i + 1]))) {
      const { text, end } = readNumber(src, i, true);
      toks.push({ k: "num", text });
      i = end;
      continue;
    }
    if (char === "#") fail(); // an empty MathLive placeholder (#?, #@, #0)
    if (char === "{") {
      if (src.startsWith("{,}", i)) {
        // A comma MathLive wrote as `{,}` outside a number.
        fail(DECIMAL_COMMA_HINT);
      }
      const { body, end } = readBraced(src, i);
      toks.push({ k: "group", toks: tokenizeLatex(body) });
      i = end;
      continue;
    }
    if (char === "^") {
      const { toks: arg, end } = readArg(src, i + 1);
      toks.push({ k: "sup", arg });
      i = end;
      continue;
    }
    if (char === "\\") {
      let j = i + 1;
      while (/[a-zA-Z]/.test(src[j] ?? "")) j += 1;
      const name = j === i + 1 ? (src[j] ?? "") : src.slice(i + 1, j);
      if (j === i + 1) j += 1;
      i = j;

      if (
        name === "," ||
        name === ";" ||
        name === ":" ||
        name === "!" ||
        name === " "
      ) {
        continue;
      }
      if (SKIPPED_COMMANDS.has(name)) {
        if (src[i] === ".") i += 1; // \left. and \right.
        continue;
      }
      if (name === "%") {
        toks.push({ k: "op", v: "%" });
        continue;
      }
      if (name === "{" || name === "}") fail();
      if (
        [
          "frac",
          "dfrac",
          "tfrac",
          "cfrac",
          "binom",
          "dbinom",
          "tbinom",
        ].includes(name)
      ) {
        const a = readArg(src, i);
        const b = readArg(src, a.end);
        toks.push(
          name.endsWith("binom")
            ? { k: "binom", a: a.toks, b: b.toks }
            : { k: "frac", a: a.toks, b: b.toks },
        );
        i = b.end;
        continue;
      }
      if (name === "sqrt") {
        let index: Tok[] | undefined;
        while (src[i] === " ") i += 1;
        if (src[i] === "[") {
          const { body, end } = readBracketed(src, i);
          index = tokenizeLatex(body);
          i = end + 1;
        }
        const arg = readArg(src, i);
        toks.push({ k: "sqrt", arg: arg.toks, index });
        i = arg.end;
        continue;
      }
      if (
        [
          "text",
          "mathrm",
          "textrm",
          "operatorname",
          "mathit",
          "mathbf",
        ].includes(name)
      ) {
        while (src[i] === " ") i += 1;
        if (src[i] !== "{") fail();
        const { body, end } = readBraced(src, i);
        if (body.trim() === "e") {
          toks.push({ k: "const", v: "e" });
        } else if (name === "text" && body.trim() === "%") {
          toks.push({ k: "op", v: "%" });
        } else {
          fail();
        }
        i = end;
        continue;
      }
      const command: Record<string, Tok> = {
        pi: { k: "const", v: "pi" },
        exponentialE: { k: "const", v: "e" },
        times: { k: "op", v: "*" },
        cdot: { k: "op", v: "*" },
        ast: { k: "op", v: "*" },
        div: { k: "op", v: "div" },
        minus: { k: "op", v: "-" },
        lparen: { k: "op", v: "(" },
        rparen: { k: "op", v: ")" },
      };
      const tok = command[name];
      if (!tok) fail(); // \placeholder, \mathrm{x}, anything else
      toks.push(tok);
      continue;
    }
    const single: Record<string, Tok> = {
      "+": { k: "op", v: "+" },
      "-": { k: "op", v: "-" },
      "−": { k: "op", v: "-" },
      "*": { k: "op", v: "*" },
      "×": { k: "op", v: "*" },
      "·": { k: "op", v: "*" },
      "/": { k: "op", v: "/" },
      "÷": { k: "op", v: "div" },
      "!": { k: "op", v: "!" },
      "%": { k: "op", v: "%" },
      "(": { k: "op", v: "(" },
      ")": { k: "op", v: ")" },
      "[": { k: "op", v: "[" },
      "]": { k: "op", v: "]" },
      ",": { k: "op", v: "," },
      π: { k: "const", v: "pi" },
      e: { k: "const", v: "e" },
    };
    const tok = single[char];
    if (!tok) fail();
    toks.push(tok);
    i += 1;
  }
  return toks;
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

type Node =
  | { t: "num"; text: string }
  | { t: "const"; v: "pi" | "e" }
  | { t: "neg" | "pos"; a: Node }
  | { t: "add" | "sub"; a: Node; b: Node }
  /** `*`, `×`, `·`, or two factors side by side (`2\pi`). */
  | { t: "mul"; a: Node; b: Node; implicit: boolean }
  /** `÷`. */
  | { t: "div"; a: Node; b: Node }
  /** `\frac{a}{b}` or a plain `a/b`. */
  | { t: "frac"; a: Node; b: Node }
  | { t: "pow"; a: Node; b: Node }
  | { t: "fact"; a: Node }
  | { t: "sqrt"; a: Node; n?: Node }
  | { t: "binom"; a: Node; b: Node }
  /** Parentheses the student wrote. */
  | { t: "paren"; a: Node }
  /** LaTeX braces: grouping without visible parentheses. */
  | { t: "group"; a: Node }
  /** A trailing percent sign on the whole entry. */
  | { t: "pct"; a: Node };

function startsPrimary(tok: Tok | undefined): boolean {
  if (!tok) return false;
  if (tok.k === "op") return tok.v === "(";
  return tok.k !== "sup";
}

/** Recursive descent over a token list. Throws `NotationError` on failure. */
function parseTokens(toks: Tok[], allowPercent: boolean): Node {
  let pos = 0;
  const peek = () => toks[pos];
  const isOp = (v: Op) => {
    const tok = toks[pos];
    return tok?.k === "op" && tok.v === v;
  };
  const eat = (v: Op) => {
    if (isOp(v)) {
      pos += 1;
      return true;
    }
    return false;
  };

  function sub(list: Tok[]): Node {
    return parseTokens(list, false);
  }

  function expr(): Node {
    let node = term();
    for (;;) {
      if (eat("+")) node = { t: "add", a: node, b: term() };
      else if (eat("-")) node = { t: "sub", a: node, b: term() };
      else return node;
    }
  }

  function term(): Node {
    let node = unary();
    for (;;) {
      if (eat("*")) node = { t: "mul", a: node, b: unary(), implicit: false };
      else if (eat("div")) node = { t: "div", a: node, b: unary() };
      else if (eat("/")) node = { t: "frac", a: node, b: unary() };
      else if (startsPrimary(peek())) {
        const next = peek();
        const numberLike =
          next?.k === "num" || next?.k === "frac" || next?.k === "group";
        if (numberLike) {
          // "1 1/2", "1\frac{1}{2}": a mixed number. Implicit multiplication
          // would be a guess, so ask for an improper fraction or a decimal.
          const whole = node.t === "neg" || node.t === "pos" ? node.a : node;
          const mixed =
            whole.t === "num" &&
            (next?.k === "frac" ||
              (next?.k === "num" &&
                toks[pos + 1]?.k === "op" &&
                (toks[pos + 1] as { v: Op }).v === "/"));
          fail(mixed ? MIXED_NUMBER_HINT : undefined);
        }
        node = { t: "mul", a: node, b: power(), implicit: true };
      } else return node;
    }
  }

  function unary(): Node {
    if (eat("-")) return { t: "neg", a: unary() };
    if (eat("+")) return { t: "pos", a: unary() };
    return power();
  }

  function power(): Node {
    const base = postfix();
    const tok = peek();
    if (tok?.k === "sup") {
      pos += 1;
      return withFactorials({ t: "pow", a: base, b: sub(tok.arg) });
    }
    if (eat("^")) return { t: "pow", a: base, b: unary() };
    return base;
  }

  function withFactorials(node: Node): Node {
    let result = node;
    while (eat("!")) result = { t: "fact", a: result };
    return result;
  }

  function postfix(): Node {
    return withFactorials(primary());
  }

  function primary(): Node {
    const tok = peek();
    if (!tok) fail();
    pos += 1;
    switch (tok.k) {
      case "num":
        return { t: "num", text: tok.text };
      case "const":
        return { t: "const", v: tok.v };
      case "frac":
        return { t: "frac", a: sub(tok.a), b: sub(tok.b) };
      case "binom":
        return { t: "binom", a: sub(tok.a), b: sub(tok.b) };
      case "group":
        return { t: "group", a: sub(tok.toks) };
      case "sqrt": {
        if (tok.arg) {
          return {
            t: "sqrt",
            a: sub(tok.arg),
            n: tok.index ? sub(tok.index) : undefined,
          };
        }
        // Plain "sqrt(2)", "√2", "√(1/4)".
        return { t: "sqrt", a: postfix() };
      }
      case "choose": {
        if (!eat("(")) fail();
        const n = expr();
        if (!eat(",")) fail();
        const k = expr();
        if (!eat(")")) fail();
        return { t: "binom", a: n, b: k };
      }
      case "op": {
        if (tok.v === "(") {
          const inner = expr();
          if (!eat(")")) fail();
          return { t: "paren", a: inner };
        }
        if (tok.v === ",") fail(DECIMAL_COMMA_HINT);
        return fail();
      }
      default:
        return fail();
    }
  }

  if (toks.length === 0) fail();
  let node = expr();
  if (allowPercent && eat("%")) node = { t: "pct", a: node };
  if (pos < toks.length) {
    const rest = toks[pos];
    if (rest.k === "op" && rest.v === ",") fail(DECIMAL_COMMA_HINT);
    fail();
  }
  return node;
}

// ---------------------------------------------------------------------------
// Grammar shapes: entries the checker already reads, sent verbatim
// ---------------------------------------------------------------------------

function unwrap(node: Node): Node {
  let current = node;
  while (current.t === "paren" || current.t === "group") current = current.a;
  return current;
}

/** `lit`, `-lit`, `+lit` as the checker writes them. */
function signedLiteral(node: Node): string | undefined {
  const inner = node.t === "group" ? unwrap(node) : node;
  if (inner.t === "num") return inner.text;
  if ((inner.t === "neg" || inner.t === "pos") && unwrap(inner.a).t === "num") {
    const literal = unwrap(inner.a) as { text: string };
    return `${inner.t === "neg" ? "-" : "+"}${literal.text}`;
  }
  const sci = scientificLiteral(inner);
  if (sci) return sci;
  return undefined;
}

/** `1.2 \times 10^{-3}` → `1.2e-3`. */
function scientificLiteral(node: Node): string | undefined {
  if (node.t !== "mul" || node.implicit) return undefined;
  const mantissa = unwrap(node.a);
  const power = node.b;
  if (
    mantissa.t !== "num" ||
    mantissa.text.includes("e") ||
    power.t !== "pow"
  ) {
    return undefined;
  }
  const base = unwrap(power.a);
  if (base.t !== "num" || base.text !== "10") return undefined;
  const exponent = unwrap(power.b);
  const exponentText =
    exponent.t === "num"
      ? exponent.text
      : exponent.t === "neg" && unwrap(exponent.a).t === "num"
        ? `-${(unwrap(exponent.a) as { text: string }).text}`
        : undefined;
  if (!exponentText || !/^-?\d+$/.test(exponentText)) return undefined;
  return `${mantissa.text}e${exponentText}`;
}

/** The plain grammar form of an entry, or undefined when it needs evaluating. */
function grammarForm(root: Node): string | undefined {
  let percent = false;
  let node = unwrap(root);
  if (node.t === "pct") {
    percent = true;
    node = unwrap(node.a);
  }

  let core: string | undefined = signedLiteral(node);
  if (!core && (node.t === "frac" || node.t === "div")) {
    const top = signedLiteral(node.a);
    const bottom = signedLiteral(node.b);
    if (top && bottom) core = `${top}/${bottom}`;
  }
  if (!core && node.t === "neg") {
    const inner = unwrap(node.a);
    if (inner.t === "frac" || inner.t === "div") {
      const top = signedLiteral(inner.a);
      const bottom = signedLiteral(inner.b);
      if (top && bottom && !/^[+-]/.test(top)) core = `-${top}/${bottom}`;
    }
  }
  if (!core) return undefined;
  const text = percent ? `${core}%` : core;
  return parseRational(text) ? text : undefined;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

type Exact = { n: bigint; d: bigint };
type Value = { exact: Exact } | { approx: number };

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);
/** Past this many bits an exact value is carried as a float instead. */
const MAX_BITS = 4096;

const abs = (value: bigint) => (value < ZERO ? -value : value);

function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y !== ZERO) {
    const r = x % y;
    x = y;
    y = r;
  }
  return x;
}

function exact(n: bigint, d: bigint): Value {
  if (d === ZERO) fail();
  if (d < ZERO) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || ONE;
  const reduced = { n: n / g, d: d / g };
  if (reduced.n.toString(2).length + reduced.d.toString(2).length > MAX_BITS) {
    return { approx: exactToNumber(reduced) };
  }
  return { exact: reduced };
}

function exactToNumber(value: Exact): number {
  const n = Number(value.n);
  const d = Number(value.d);
  if (Number.isFinite(n) && Number.isFinite(d)) return n / d;
  const nText = abs(value.n).toString();
  const dText = value.d.toString();
  const nHead = nText.slice(0, 17);
  const dHead = dText.slice(0, 17);
  return (
    (value.n < ZERO ? -1 : 1) *
    (Number(nHead) / Number(dHead)) *
    10 ** (nText.length - nHead.length - dText.length + dHead.length)
  );
}

const toNumber = (value: Value) =>
  "exact" in value ? exactToNumber(value.exact) : value.approx;

function approx(x: number): Value {
  if (!Number.isFinite(x)) fail();
  return { approx: x };
}

function literalValue(text: string): Value {
  const [mantissa, exponentText] = text.toLowerCase().split("e");
  const [integer, fraction = ""] = mantissa.replace(/,/g, "").split(".");
  const exponent = Number(exponentText ?? 0) - fraction.length;
  if (Math.abs(exponent) > 400) return approx(Number(text.replace(/,/g, "")));
  const digits = BigInt(`${integer || "0"}${fraction}`);
  return exponent >= 0
    ? exact(digits * TEN ** BigInt(exponent), ONE)
    : exact(digits, TEN ** BigInt(-exponent));
}

const isInteger = (value: Value): value is { exact: Exact } =>
  "exact" in value && value.exact.d === ONE;

/** The exact integer k-th root of a non-negative BigInt, when there is one. */
function integerRoot(value: bigint, k: number): bigint | undefined {
  if (value < ZERO) return undefined;
  if (value < BigInt(2)) return value;
  const K = BigInt(k);
  // Newton's method from a float estimate.
  let x = BigInt(Math.max(1, Math.round(Math.pow(Number(value), 1 / k))));
  if (!Number.isFinite(Number(value))) {
    x = ONE << BigInt(Math.ceil(value.toString(2).length / k));
  }
  for (let step = 0; step < 200; step += 1) {
    const next = ((K - ONE) * x + value / x ** (K - ONE)) / K;
    if (next === x) break;
    x = next;
  }
  for (const candidate of [x - ONE, x, x + ONE]) {
    if (candidate >= ZERO && candidate ** K === value) return candidate;
  }
  return undefined;
}

/** The real k-th root of a value, exact when it is a perfect power. */
function root(value: Value, k: number): Value {
  if (!Number.isInteger(k) || k < 1) fail();
  if ("exact" in value) {
    const { n, d } = value.exact;
    const negative = n < ZERO;
    if (negative && k % 2 === 0) fail();
    const top = integerRoot(abs(n), k);
    const bottom = integerRoot(d, k);
    if (top !== undefined && bottom !== undefined) {
      return exact(negative ? -top : top, bottom);
    }
  }
  const x = toNumber(value);
  if (x < 0 && k % 2 === 0) fail();
  return approx(x < 0 ? -Math.pow(-x, 1 / k) : Math.pow(x, 1 / k));
}

function power(base: Value, exponent: Value): Value {
  if ("exact" in base && "exact" in exponent) {
    const { n: p, d: q } = exponent.exact;
    if (q === ONE) {
      const magnitude = Number(abs(p));
      const bits =
        base.exact.n.toString(2).length + base.exact.d.toString(2).length;
      if (bits * magnitude <= MAX_BITS * 2) {
        const e = abs(p);
        if (p < ZERO && base.exact.n === ZERO) fail();
        const n = base.exact.n ** e;
        const d = base.exact.d ** e;
        return p < ZERO ? exact(d, n) : exact(n, d);
      }
    } else if (q <= BigInt(12) && abs(p) <= BigInt(64)) {
      // A rational exponent: exact when the root comes out even (4^{1/2}).
      return root(power(base, exact(p, ONE)), Number(q));
    }
  }
  const x = toNumber(base);
  const y = toNumber(exponent);
  if (x < 0 && !Number.isInteger(y)) fail();
  return approx(Math.pow(x, y));
}

function factorial(value: Value): Value {
  if (!isInteger(value)) fail();
  const n = value.exact.n;
  if (n < ZERO || n > BigInt(170)) fail();
  let result = ONE;
  for (let i = BigInt(2); i <= n; i += ONE) result *= i;
  return exact(result, ONE);
}

function binomial(nValue: Value, kValue: Value): Value {
  if (!isInteger(nValue) || !isInteger(kValue)) fail();
  const n = nValue.exact.n;
  let k = kValue.exact.n;
  if (n < ZERO || k < ZERO || n > BigInt(10000)) fail();
  if (k > n) return exact(ZERO, ONE);
  if (k > n - k) k = n - k;
  let result = ONE;
  for (let i = ONE; i <= k; i += ONE) {
    result = (result * (n - k + i)) / i;
  }
  return exact(result, ONE);
}

function arith(
  a: Value,
  b: Value,
  exactOp: (x: Exact, y: Exact) => Value,
  floatOp: (x: number, y: number) => number,
): Value {
  if ("exact" in a && "exact" in b) return exactOp(a.exact, b.exact);
  return approx(floatOp(toNumber(a), toNumber(b)));
}

function evaluate(node: Node): Value {
  switch (node.t) {
    case "num":
      return literalValue(node.text);
    case "const":
      return approx(node.v === "pi" ? Math.PI : Math.E);
    case "neg": {
      const value = evaluate(node.a);
      return "exact" in value
        ? exact(-value.exact.n, value.exact.d)
        : approx(-value.approx);
    }
    case "pos":
    case "paren":
    case "group":
      return evaluate(node.a);
    case "add":
      return arith(
        evaluate(node.a),
        evaluate(node.b),
        (x, y) => exact(x.n * y.d + y.n * x.d, x.d * y.d),
        (x, y) => x + y,
      );
    case "sub":
      return arith(
        evaluate(node.a),
        evaluate(node.b),
        (x, y) => exact(x.n * y.d - y.n * x.d, x.d * y.d),
        (x, y) => x - y,
      );
    case "mul":
      return arith(
        evaluate(node.a),
        evaluate(node.b),
        (x, y) => exact(x.n * y.n, x.d * y.d),
        (x, y) => x * y,
      );
    case "div":
    case "frac":
      return arith(
        evaluate(node.a),
        evaluate(node.b),
        (x, y) => exact(x.n * y.d, x.d * y.n),
        (x, y) => {
          if (y === 0) fail();
          return x / y;
        },
      );
    case "pow":
      return power(evaluate(node.a), evaluate(node.b));
    case "fact":
      return factorial(evaluate(node.a));
    case "sqrt": {
      const index = node.n ? evaluate(node.n) : exact(BigInt(2), ONE);
      if (!isInteger(index)) {
        return power(evaluate(node.a), approx(1 / toNumber(index)));
      }
      return root(evaluate(node.a), Number(index.exact.n));
    }
    case "binom":
      return binomial(evaluate(node.a), evaluate(node.b));
    case "pct":
      // Handled by the caller: the percent sign is kept on what is sent.
      return evaluate(node.a);
  }
}

/** 15 significant digits, trailing zeros dropped, in the checker's grammar. */
export function formatDecimal(x: number): string {
  if (!Number.isFinite(x)) fail();
  if (x === 0) return "0";
  const [mantissa, exponent] = x.toPrecision(15).split("e");
  const trimmed = mantissa.includes(".")
    ? mantissa.replace(/0+$/, "").replace(/\.$/, "")
    : mantissa;
  if (!exponent) return trimmed;
  return `${trimmed}e${Number(exponent)}`;
}

function exactPlain(value: Exact): string {
  return value.d === ONE ? value.n.toString() : `${value.n}/${value.d}`;
}

function exactLatex(value: Exact): string {
  if (value.d === ONE) return value.n.toString();
  const sign = value.n < ZERO ? "-" : "";
  return `${sign}\\frac{${abs(value.n)}}{${value.d}}`;
}

/** Up to 4 decimals for display ("1.4142"); the value sent keeps 15 digits. */
function displayDecimal(x: number): string {
  if (Math.abs(x) >= 1e6 || (Math.abs(x) < 1e-4 && x !== 0)) {
    const [mantissa, exponent] = x.toPrecision(5).split("e");
    if (!exponent) return mantissa;
    return `${mantissa.replace(/0+$/, "").replace(/\.$/, "")}\\times10^{${Number(exponent)}}`;
  }
  return String(Number(x.toFixed(4)));
}

// ---------------------------------------------------------------------------
// Rendering an AST as LaTeX (the preview, and plainToLatex)
// ---------------------------------------------------------------------------

function numberLatex(text: string): string {
  const [mantissa, exponent] = text.split(/[eE]/);
  const grouped = mantissa.replace(/,/g, "{,}");
  return exponent === undefined
    ? grouped
    : `${grouped}\\times10^{${exponent.replace(/^\+/, "")}}`;
}

function toLatex(node: Node): string {
  switch (node.t) {
    case "num":
      return numberLatex(node.text);
    case "const":
      return node.v === "pi" ? "\\pi" : "e";
    case "neg":
      return `-${toLatex(node.a)}`;
    case "pos":
      return `+${toLatex(node.a)}`;
    case "add":
      return `${toLatex(node.a)}+${toLatex(node.b)}`;
    case "sub":
      return `${toLatex(node.a)}-${toLatex(node.b)}`;
    case "mul": {
      const left = toLatex(node.a);
      const right = toLatex(node.b);
      return node.implicit
        ? `${left}${/^[a-zA-Z]/.test(right) ? " " : ""}${right}`
        : `${left}\\times ${right}`;
    }
    case "div":
      return `${toLatex(node.a)}\\div ${toLatex(node.b)}`;
    case "frac": {
      const top = unwrapParen(node.a);
      if (top.t === "neg") {
        return `-\\frac{${toLatex(top.a)}}{${toLatex(unwrapParen(node.b))}}`;
      }
      return `\\frac{${toLatex(top)}}{${toLatex(unwrapParen(node.b))}}`;
    }
    case "pow": {
      const base = toLatex(node.a);
      const needsBraces =
        node.a.t !== "num" &&
        node.a.t !== "const" &&
        node.a.t !== "paren" &&
        node.a.t !== "group";
      return `${needsBraces ? `{${base}}` : base}^{${toLatex(unwrapParen(node.b))}}`;
    }
    case "fact":
      return `${toLatex(node.a)}!`;
    case "sqrt":
      return node.n
        ? `\\sqrt[${toLatex(unwrapParen(node.n))}]{${toLatex(unwrapParen(node.a))}}`
        : `\\sqrt{${toLatex(unwrapParen(node.a))}}`;
    case "binom":
      return `\\binom{${toLatex(node.a)}}{${toLatex(node.b)}}`;
    case "paren":
      return `\\left(${toLatex(node.a)}\\right)`;
    case "group":
      return `{${toLatex(node.a)}}`;
    case "pct":
      return `${toLatex(node.a)}\\%`;
  }
}

function unwrapParen(node: Node): Node {
  let current = node;
  while (current.t === "paren" || current.t === "group") current = current.a;
  return current;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function entryFromTokens(tokenize: () => Tok[], raw: string): AnswerEntry {
  let node: Node;
  try {
    node = parseTokens(tokenize(), true);
  } catch (error) {
    if (error instanceof NotationError && error.hint) {
      return { status: "rejected", sent: raw, hint: error.hint };
    }
    return { status: "unparsed", sent: raw };
  }

  const notation = toLatex(node);
  const grammar = grammarForm(node);
  if (grammar) {
    return { status: "grammar", sent: grammar, notation };
  }

  let value: Value;
  try {
    value = evaluate(node);
  } catch {
    return { status: "unparsed", sent: raw, notation };
  }
  const percent = node.t === "pct";
  const number = toNumber(value);
  let plain =
    "exact" in value ? exactPlain(value.exact) : formatDecimal(value.approx);
  if ("exact" in value && !parseRational(plain) && Number.isFinite(number)) {
    // More than 32 digits in a part: the checker reads a rounded decimal.
    plain = formatDecimal(number);
    value = { approx: number };
  }
  const sent = percent ? `${plain}%` : plain;
  if (!parseRational(sent)) {
    return { status: "rejected", sent: raw, notation, hint: TOO_LARGE_HINT };
  }
  const valueLatex =
    "exact" in value ? exactLatex(value.exact) : displayDecimal(value.approx);
  return {
    status: "evaluated",
    sent,
    notation,
    valueLatex: percent ? `${valueLatex}\\%` : valueLatex,
    approximate: !("exact" in value),
    value: percent ? number / 100 : number,
  };
}

/** Strips `$…$`, `$$…$$`, `\(…\)`, `\[…\]` once. */
function stripMathWrappers(text: string): string {
  for (const [start, end] of [
    ["\\(", "\\)"],
    ["\\[", "\\]"],
    ["$$", "$$"],
    ["$", "$"],
  ]) {
    if (
      text.length >= start.length + end.length &&
      text.startsWith(start) &&
      text.endsWith(end)
    ) {
      return text.slice(start.length, -end.length).trim();
    }
  }
  return text;
}

/**
 * Reads a MathLive LaTeX value into the entry that is sent and previewed.
 * `sent` is the checker-plain string (raw LaTeX when it cannot be read).
 */
export function readLatexEntry(latex: string): AnswerEntry {
  const source = latex.trim();
  if (source.length === 0) return { status: "empty", sent: "" };
  // A whole `\text{…}` entry (words typed in text mode) is sent as its words.
  const text = /^\\(?:text|mathrm|textrm)\{([^{}]*)\}$/.exec(source);
  if (text && text[1].trim() !== "e") {
    return { status: "unparsed", sent: text[1].trim() };
  }
  return entryFromTokens(() => tokenizeLatex(source), source);
}

/** LaTeX → the checker-plain string that is sent (raw LaTeX when unreadable). */
export function latexToPlain(latex: string): string {
  return readLatexEntry(latex).sent;
}

/**
 * Reads a plain-text entry (the field before MathLive loads, or a restored
 * value). Anything the checker already reads is sent exactly as typed.
 */
export function evaluateEntry(plain: string): AnswerEntry {
  const source = plain.trim();
  if (source.length === 0) return { status: "empty", sent: "" };
  if (parseRational(source)) {
    return { status: "grammar", sent: source, notation: plainToLatex(source) };
  }
  const unwrapped = stripMathWrappers(source);
  if (unwrapped.includes("\\")) {
    return readLatexEntry(unwrapped);
  }
  return entryFromTokens(() => tokenizePlain(unwrapped), source);
}

function escapeText(text: string): string {
  return text.replace(/[\\{}$&#^_%~]/g, (char) =>
    char === "\\" ? "\\backslash " : `\\${char}`,
  );
}

/**
 * Plain → LaTeX, to seed the math field when a value is restored and to
 * typeset recovered answers: `1/4` → `\frac{1}{4}`, `25%` → `25\%`,
 * `1.2e-3` → `1.2\times10^{-3}`, `1,000` → `1{,}000`. LaTeX that is already
 * there is unwrapped and passed through; anything unreadable becomes
 * `\text{…}`.
 */
export function plainToLatex(plain: string): string {
  const source = plain.trim();
  if (source.length === 0) return "";
  const unwrapped = stripMathWrappers(source);
  if (unwrapped.includes("\\") || unwrapped.includes("{")) return unwrapped;
  try {
    return toLatex(parseTokens(tokenizePlain(unwrapped), true));
  } catch {
    return `\\text{${escapeText(source)}}`;
  }
}
