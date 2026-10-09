/**
 * Reading generated computation expressions. The only evaluator is the
 * existing exact arithmetic one (`evaluateEntry`); nothing here evaluates
 * JavaScript, LaTeX, or any other generated text.
 */

import { evaluateEntry } from "@/lib/math/answer-notation";
import type { AnswerSpec, NumericAnswerSpec } from "@/lib/tutor/answer/spec";

/**
 * Digits, decimal points, + - * / ^ ! ( ) , whitespace, and the two named
 * operations the evaluator knows, `C(n, k)` and `sqrt`. No identifiers,
 * constants (π, e), percent signs, or LaTeX: a computation states every
 * number it uses.
 */
const COMPUTATION_CHARACTERS = /^(?:[0-9.+\-*/^!(),\s]|C(?=\s*\()|sqrt)+$/;

/** Numbers a computation may use without stating them as parameters. */
export const ALLOWED_COMPUTATION_CONSTANTS = [0, 1, 2] as const;

export type ComputationResult =
  | { ok: true; sent: string }
  | { ok: false; reason: string };

/**
 * Evaluates a computation exactly. `sent` is the checker-plain value (`7/12`,
 * `10`, or a 15-digit decimal for irrational results). Division by zero, an
 * unknown token, or an oversized value is a failure, never a value.
 */
export function evaluateComputation(expression: string): ComputationResult {
  const source = expression.trim();
  if (!COMPUTATION_CHARACTERS.test(source)) {
    return {
      ok: false,
      reason: "Only numbers, + - * / ^ !, parentheses, C(n, k), and sqrt are allowed.",
    };
  }
  const entry = evaluateEntry(source);
  if (entry.status !== "grammar" && entry.status !== "evaluated") {
    return { ok: false, reason: "The expression could not be evaluated." };
  }
  // A bare grammar value (`1/0` is not one) is the value itself.
  return { ok: true, sent: entry.sent };
}

/** Every number literal in a computation, in order. */
export function computationNumbers(expression: string): number[] {
  return (expression.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/**
 * The operations a computation performs, as a sorted multiset, so two
 * computations can be compared for "the same skill". Unary and binary minus
 * are not distinguished.
 */
export function operatorSignature(expression: string): string {
  const counts = new Map<string, number>();
  const add = (name: string, count: number) => {
    if (count > 0) counts.set(name, (counts.get(name) ?? 0) + count);
  };
  const source = expression.replace(/\s+/g, "");
  add("choose", (source.match(/C\(/g) ?? []).length);
  add("sqrt", (source.match(/sqrt/g) ?? []).length);
  add("factorial", (source.match(/!/g) ?? []).length);
  add("power", (source.match(/\^/g) ?? []).length);
  add("multiply", (source.match(/\*/g) ?? []).length);
  add("divide", (source.match(/\//g) ?? []).length);
  add("add", (source.match(/\+/g) ?? []).length);
  add("subtract", (source.match(/-/g) ?? []).length);
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name}:${count}`)
    .join(",");
}

/** The operation names in a signature, ignoring how often each appears. */
export function operatorKinds(signature: string): Set<string> {
  return new Set(
    signature
      .split(",")
      .filter(Boolean)
      .map((entry) => entry.split(":")[0]),
  );
}

/**
 * The spec used to ask "is this value the answer?" rather than "is this
 * submission in the required form?": form and unit requirements become
 * notes, exactly as the intake's answer-in-solution check does.
 */
export function valueCheckSpec(spec: AnswerSpec): AnswerSpec {
  if (spec.kind !== "numeric") return spec;
  const relaxed: NumericAnswerSpec = { ...spec, formPolicy: "note" };
  if (spec.unit) relaxed.unit = { ...spec.unit, required: false };
  return relaxed;
}

/**
 * The spec's domain and tolerance applied to a computed value, without the
 * form requirement (a computed `7/12` need not be in decimal form). Used to
 * reuse `validateAnswerSpec`'s probability and count domain rules.
 */
export function domainCheckSpec(
  spec: NumericAnswerSpec,
  value: string,
): NumericAnswerSpec {
  return {
    kind: "numeric",
    value,
    domain: spec.domain,
    percentMode: spec.percentMode,
    tolerance: spec.tolerance,
  };
}
