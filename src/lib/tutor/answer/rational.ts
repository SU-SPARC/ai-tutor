/** Exact, bounded numeric grammar. No expression evaluation or external parser. */
export type Rational = { n: bigint; d: bigint };
export type RationalParseOptions = { stripCurrency?: boolean };

// The same parse also retains SQL-compatible floating-point operation order for
// publication gates. Student grading consumes only the exact rational value.
type ParsedValue = { exact: Rational; approximate: number };

type Token =
  | { kind: "number"; value: ParsedValue }
  | { kind: "+" | "-" | "/" | "{" | "}" | "frac" | "percent" };

const UNICODE_FRACTIONS: Record<string, Rational> = {
  "½": { n: BigInt(1), d: BigInt(2) },
  "¼": { n: BigInt(1), d: BigInt(4) },
  "¾": { n: BigInt(3), d: BigInt(4) },
};

export function parseRational(
  input: string,
  options: RationalParseOptions = {},
): Rational | undefined {
  return parseValue(input, options)?.exact;
}

function parseValue(
  input: string,
  options: RationalParseOptions,
): ParsedValue | undefined {
  if (input.length > 500) return undefined;
  let text = stripWrappers(input);
  if (options.stripCurrency && text.startsWith("$")) text = text.slice(1);
  const tokens = tokenize(text);
  if (!tokens?.length) return undefined;
  let cursor = 0;

  function consume(kind: Token["kind"]): boolean {
    if (tokens?.[cursor]?.kind !== kind) return false;
    cursor += 1;
    return true;
  }

  function primary(): ParsedValue | undefined {
    const negative = consume("-");
    if (!negative) consume("+");
    const token = tokens?.[cursor++];
    let value: ParsedValue | undefined;
    if (token?.kind === "number") value = token.value;
    else if (token?.kind === "frac") {
      if (!consume("{")) return undefined;
      const numerator = valueExpression();
      if (!numerator || !consume("}") || !consume("{")) return undefined;
      const denominator = valueExpression();
      if (!denominator || !consume("}")) return undefined;
      value = divideValues(numerator, denominator);
    }
    return (
      value &&
      (negative
        ? {
            exact: { n: -value.exact.n, d: value.exact.d },
            approximate: -value.approximate,
          }
        : value)
    );
  }

  function valueExpression(): ParsedValue | undefined {
    let value = primary();
    if (!value) return undefined;
    if (consume("/")) {
      const denominator = primary();
      if (!denominator) return undefined;
      value = divideValues(value, denominator);
    }
    if (value && consume("percent"))
      value = {
        exact: reduced(value.exact.n, value.exact.d * BigInt(100)),
        approximate: value.approximate / 100,
      };
    return value;
  }

  const value = valueExpression();
  return cursor === tokens.length ? value : undefined;
}

/** Publication checks keep their existing currency support and tolerance floor. */
export function numericAnswerMatches(
  answer: string,
  numericValue: number,
  tolerance: number,
): boolean {
  const parsed = parseValue(answer, { stripCurrency: true });
  if (!parsed) return false;
  // Migration 015 compares double precision values with this tolerance floor.
  const value = parsed.approximate;
  return (
    Number.isFinite(value) &&
    Math.abs(value - numericValue) <= Math.max(tolerance, 1e-9)
  );
}

export function rationalsEqual(left: Rational, right: Rational): boolean {
  return left.n * right.d === right.n * left.d;
}

export function withinTolerance(
  left: Rational,
  right: Rational,
  tolerance: Rational,
): boolean {
  const difference = left.n * right.d - right.n * left.d;
  return absolute(difference) * tolerance.d <= tolerance.n * left.d * right.d;
}

/** Authored finite JS numbers may use exponents beyond the student grammar. */
export function rationalFromNumber(value: number): Rational | undefined {
  return Number.isFinite(value) ? decimalRational(String(value)) : undefined;
}

export function rationalToNumber(value: Rational): number {
  const numerator = Number(value.n),
    denominator = Number(value.d);
  if (Number.isFinite(numerator) && Number.isFinite(denominator))
    return numerator / denominator;
  // Nested bounded fractions can still produce integers beyond Number's range.
  const n = absolute(value.n).toString(),
    d = value.d.toString();
  const nHead = n.slice(0, 16),
    dHead = d.slice(0, 16);
  return (
    (value.n < BigInt(0) ? -1 : 1) *
    (Number(nHead) / Number(dHead)) *
    10 ** (n.length - nHead.length - d.length + dHead.length)
  );
}

function tokenize(text: string): Token[] | undefined {
  const tokens: Token[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const char = text[cursor];
    if (/^\s$/.test(char)) {
      cursor += 1;
      continue;
    }
    if (tokens.length === 64) return undefined;
    if (isDigit(char) || char === ".") {
      const start = cursor;
      while (
        isDigit(text[cursor]) ||
        text[cursor] === "." ||
        text[cursor] === ","
      )
        cursor += 1;
      const mantissa = text.slice(start, cursor);
      const parts = mantissa.split(".");
      if (
        parts.length > 2 ||
        (parts.length === 2 && !/^[0-9]+$/.test(parts[1]))
      )
        return undefined;
      const integer = parts[0];
      if (
        integer &&
        !/^[0-9]+$/.test(integer) &&
        !/^[0-9]{1,3}(?:,[0-9]{3})+$/.test(integer)
      )
        return undefined;
      if (!integer && parts.length !== 2) return undefined;
      let digits = 0;
      for (const item of mantissa) if (isDigit(item)) digits += 1;
      if (digits > 32) return undefined;
      if (text[cursor] === "e" || text[cursor] === "E") {
        cursor += 1;
        if (text[cursor] === "+" || text[cursor] === "-") cursor += 1;
        const exponentStart = cursor;
        while (isDigit(text[cursor])) cursor += 1;
        const exponent = text.slice(exponentStart, cursor);
        if (!exponent || digits + exponent.length > 32 || Number(exponent) > 30)
          return undefined;
      }
      tokens.push({
        kind: "number",
        value: {
          exact: decimalRational(text.slice(start, cursor)),
          approximate: Number(text.slice(start, cursor).replaceAll(",", "")),
        },
      });
    } else if (Object.hasOwn(UNICODE_FRACTIONS, char)) {
      const exact = { ...UNICODE_FRACTIONS[char] };
      tokens.push({
        kind: "number",
        value: { exact, approximate: rationalToNumber(exact) },
      });
      cursor += 1;
    } else if (
      char === "+" ||
      char === "-" ||
      char === "/" ||
      char === "{" ||
      char === "}"
    ) {
      tokens.push({ kind: char });
      cursor += 1;
    } else if (char === "%" || text.startsWith("\\%", cursor)) {
      tokens.push({ kind: "percent" });
      cursor += char === "%" ? 1 : 2;
    } else if (text.slice(cursor, cursor + 7).toLowerCase() === "percent") {
      tokens.push({ kind: "percent" });
      cursor += 7;
    } else if (char === "\\") {
      const start = ++cursor;
      while (cursor < text.length && /^[a-z]$/.test(text[cursor])) cursor += 1;
      const command = text.slice(start, cursor);
      if (command !== "frac" && command !== "dfrac" && command !== "tfrac")
        return undefined;
      tokens.push({ kind: "frac" });
    } else return undefined;
  }
  return tokens;
}

function stripWrappers(input: string): string {
  let text = input.trim();
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
      text = text.slice(start.length, -end.length).trim();
      break;
    }
  }
  if (text.startsWith("\\text{") && text.endsWith("}"))
    text = text.slice(6, -1).trim();
  return text;
}

/** Called only on validated literals or finite Number.toString() output. */
function decimalRational(literal: string): Rational {
  const [mantissa, exponentText] = literal.toLowerCase().split("e");
  const [integer, fraction = ""] = mantissa.replaceAll(",", "").split(".");
  const exponent = Number(exponentText ?? 0) - fraction.length;
  const digits = BigInt(`${integer || "0"}${fraction}`);
  return exponent >= 0
    ? reduced(digits * BigInt(10) ** BigInt(exponent), BigInt(1))
    : reduced(digits, BigInt(10) ** BigInt(-exponent));
}

function divideValues(
  left: ParsedValue,
  right: ParsedValue,
): ParsedValue | undefined {
  return right.exact.n === BigInt(0)
    ? undefined
    : {
        exact: reduced(
          left.exact.n * right.exact.d,
          left.exact.d * right.exact.n,
        ),
        approximate: left.approximate / right.approximate,
      };
}

function reduced(n: bigint, d: bigint): Rational {
  if (d < BigInt(0)) {
    n = -n;
    d = -d;
  }
  let a = absolute(n),
    b = d;
  while (b !== BigInt(0)) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return { n: n / a, d: d / a };
}

function absolute(value: bigint): bigint {
  return value < BigInt(0) ? -value : value;
}
function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}
