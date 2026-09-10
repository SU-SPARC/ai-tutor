import {
  parseRational,
  rationalFromNumber,
  rationalsEqual,
  withinTolerance,
  type Rational,
} from "./rational.ts";

export type ToleranceSpec =
  | { mode: "exact" }
  | { mode: "absolute" | "relative"; value: number }
  | { mode: "combined"; absolute: number; relative: number }
  | { mode: "decimals"; places: number }
  | { mode: "significant"; digits: number };
export type NumericAnswerSpec = {
  kind: "numeric";
  value: string;
  domain: "probability" | "count" | "real";
  percentMode: "decimal" | "percent" | "either";
  tolerance: ToleranceSpec;
  requiredForm?:
    | "decimal"
    | "fraction"
    | "simplified_fraction"
    | "percent"
    | "integer";
  formPolicy?: "note" | "require";
  unit?: { label: string; required: boolean };
};
export type AnswerSpec =
  | NumericAnswerSpec
  | {
      kind: "categorical";
      canonical: string;
      aliases: string[];
      forbiddenTerms?: string[];
    }
  | {
      kind: "number_list";
      values: string[];
      ordered: boolean;
      labels?: string[];
      tolerance: ToleranceSpec;
    };
export type CheckDetail =
  | "close_rounding"
  | "percent_decimal_confusion"
  | "complement"
  | "unsimplified"
  | "wrong_form"
  | "missing_unit"
  | "unknown_token";
export type TypedCheckResult = {
  outcome: "correct" | "incorrect" | "unreadable";
  isCorrect: boolean;
  confidence: number;
  feedback: string;
  normalizedExpectedAnswer: string;
  normalizedStudentAnswer: string;
  detail?: CheckDetail;
};
export type AnswerSpecIssue = {
  code:
    | "invalid_answer_spec"
    | "answer_value_unparseable"
    | "tolerance_out_of_bounds"
    | "accepted_answer_inconsistent"
    | "percent_mode_missing"
    | "required_form_unsatisfiable"
    | "categorical_alias_empty";
  message: string;
};

const zero = BigInt(0),
  one = BigInt(1),
  hundred = BigInt(100);
/** List grammar separators; canonical list values and labels may never contain them. */
const LIST_SEPARATOR = /[,;]/;
const abs = (n: bigint) => (n < zero ? -n : n);
const text = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= 500;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown, min = 0): v is string[] =>
  Array.isArray(v) && v.length >= min && v.length <= 32 && v.every(text);
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));
const inRange = (r: Rational) => r.n >= zero && r.n <= r.d;
function reduce(r: Rational): Rational {
  let a = abs(r.n),
    b = r.d;
  while (b) {
    const rest = a % b;
    a = b;
    b = rest;
  }
  return { n: r.n / a, d: r.d / a };
}
const show = (r: Rational) => {
  const value = reduce(r);
  return value.d === one ? String(value.n) : `${value.n}/${value.d}`;
};
const mul = (a: Rational, b: Rational): Rational => ({
  n: a.n * b.n,
  d: a.d * b.d,
});
const power = (n: number): Rational =>
  n < 0
    ? { n: one, d: BigInt(10) ** BigInt(-n) }
    : { n: BigInt(10) ** BigInt(n), d: one };

/** Exact half-unit boundaries, with no JS-double floor for typed specifications. */
export function toleranceFor(
  expected: Rational,
  spec: ToleranceSpec,
): Rational | undefined {
  const magnitude = { n: abs(expected.n), d: expected.d };
  switch (spec.mode) {
    case "exact":
      return { n: zero, d: one };
    case "absolute":
      return rationalFromNumber(spec.value);
    case "relative":
      return expected.n === zero
        ? undefined
        : mul(magnitude, rationalFromNumber(spec.value)!);
    case "combined": {
      const absolute = rationalFromNumber(spec.absolute)!;
      const relative = mul(magnitude, rationalFromNumber(spec.relative)!);
      return absolute.n * relative.d >= relative.n * absolute.d
        ? absolute
        : relative;
    }
    case "decimals":
      return mul({ n: one, d: BigInt(2) }, power(-spec.places));
    case "significant": {
      if (expected.n === zero) return undefined;
      let exponent =
        magnitude.n.toString().length - magnitude.d.toString().length;
      const boundary = power(exponent);
      if (magnitude.n * boundary.d < boundary.n * magnitude.d) exponent--;
      return mul({ n: one, d: BigInt(2) }, power(exponent - spec.digits + 1));
    }
  }
}

function validTolerance(value: unknown): value is ToleranceSpec {
  if (!record(value)) return false;
  const finite = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e30;
  switch (value.mode) {
    case "exact":
      return keys(value, ["mode"]);
    case "absolute":
    case "relative":
      return keys(value, ["mode", "value"]) && finite(value.value);
    case "combined":
      return (
        keys(value, ["mode", "absolute", "relative"]) &&
        finite(value.absolute) &&
        finite(value.relative)
      );
    case "decimals":
      return (
        keys(value, ["mode", "places"]) &&
        Number.isInteger(value.places) &&
        Number(value.places) >= 0 &&
        Number(value.places) <= 15
      );
    case "significant":
      return (
        keys(value, ["mode", "digits"]) &&
        Number.isInteger(value.digits) &&
        Number(value.digits) >= 1 &&
        Number(value.digits) <= 15
      );
    default:
      return false;
  }
}

/** Bounded literal normalization; correctness never uses a substring match. */
export function normalizeCategory(input: string): string {
  return input
    .slice(0, 500)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.,!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function normalizeListLabel(input: string): string {
  return input.slice(0, 80).toLowerCase().replace(/\s/g, "");
}

function numericInput(input: string, spec: NumericAnswerSpec) {
  let raw = input.trim();
  // Inspect form/percent metadata inside the same bounded math wrappers as Phase A.
  for (const [start, end] of [
    ["\\(", "\\)"],
    ["\\[", "\\]"],
    ["$$", "$$"],
    ["$", "$"],
  ]) {
    if (
      raw.length >= start.length + end.length &&
      raw.startsWith(start) &&
      raw.endsWith(end)
    ) {
      raw = raw.slice(start.length, -end.length).trim();
      break;
    }
  }
  if (raw.startsWith("\\text{") && raw.endsWith("}"))
    raw = raw.slice(6, -1).trim();
  let unitPresent = false;
  if (spec.unit) {
    const label = spec.unit.label;
    if (raw.startsWith(label)) {
      raw = raw.slice(label.length).trim();
      unitPresent = true;
    } else if (raw.endsWith(label)) {
      raw = raw.slice(0, -label.length).trim();
      unitPresent = true;
    }
  }
  const markedPercent = raw.endsWith("%") || raw.endsWith("percent");
  let value = parseRational(raw);
  if (value && spec.percentMode === "percent" && !markedPercent)
    value = reduce({ n: value.n, d: value.d * hundred });
  return { raw, value, markedPercent, unitPresent };
}

/** List commas are separators, never thousands grouping. Whitespace may separate plain values. */
function parseList(
  input: string,
  labels?: string[],
): { values: Rational[]; labels?: string[] } | undefined {
  let raw = input.trim();
  if (raw.length > 500 || !raw) return undefined;
  const wrappers: Record<string, string> = { "[": "]", "{": "}", "(": ")" };
  if (wrappers[raw[0]]) {
    if (!raw.endsWith(wrappers[raw[0]])) return undefined;
    raw = raw.slice(1, -1).trim();
  }
  const pieces = LIST_SEPARATOR.test(raw)
    ? raw.split(LIST_SEPARATOR)
    : !labels && parseRational(raw)
      ? [raw]
      : raw.split(/\s+/);
  if (!pieces.length || pieces.length > 32) return undefined;
  const values: Rational[] = [],
    foundLabels: string[] = [];
  for (const piece of pieces) {
    const separator = piece.lastIndexOf("=");
    if (labels && separator < 0) return undefined;
    const numberText = labels ? piece.slice(separator + 1) : piece;
    const value = parseRational(numberText.trim());
    if (!value) return undefined;
    values.push(value);
    if (labels) {
      const label = normalizeListLabel(piece.slice(0, separator));
      if (!label || foundLabels.includes(label)) return undefined;
      foundLabels.push(label);
    }
  }
  return { values, labels: labels ? foundLabels : undefined };
}

function formDetail(
  raw: string,
  value: Rational,
  required: NumericAnswerSpec["requiredForm"],
): CheckDetail | undefined {
  if (!required) return undefined;
  const compact = raw.replace(/\s/g, "");
  const fraction =
    compact.match(/^([+-]?[0-9]{1,32})\/([+-]?[0-9]{1,32})$/) ??
    compact.match(
      /^\\(?:frac|dfrac|tfrac)\{([+-]?[0-9]{1,32})\}\{([+-]?[0-9]{1,32})\}$/,
    );
  switch (required) {
    case "fraction":
      return fraction ? undefined : "wrong_form";
    case "simplified_fraction": {
      if (!fraction) return "wrong_form";
      let a = abs(BigInt(fraction[1])),
        b = abs(BigInt(fraction[2]));
      while (b) {
        const rest = a % b;
        a = b;
        b = rest;
      }
      return a === one && BigInt(fraction[2]) > zero
        ? undefined
        : "unsimplified";
    }
    case "decimal":
      return /^[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(
        compact,
      )
        ? undefined
        : "wrong_form";
    case "integer":
      return value.d !== zero && value.n % value.d === zero
        ? undefined
        : "wrong_form";
    case "percent":
      return compact.endsWith("%") || compact.endsWith("percent")
        ? undefined
        : "wrong_form";
  }
}

function result(
  outcome: TypedCheckResult["outcome"],
  student: string,
  expected: string,
  detail?: CheckDetail,
  feedback?: string,
): TypedCheckResult {
  return {
    outcome,
    isCorrect: outcome === "correct",
    confidence:
      outcome === "correct" ? 0.98 : outcome === "unreadable" ? 0.1 : 0.2,
    normalizedStudentAnswer: student.slice(0, 500),
    normalizedExpectedAnswer: expected.slice(0, 500),
    detail,
    feedback:
      feedback ??
      (detail === "unsimplified"
        ? "Correct value — please simplify the fraction."
        : detail === "missing_unit"
          ? "Include the declared unit with your answer."
          : detail === "wrong_form"
            ? "Use the requested answer form."
            : outcome === "correct"
              ? "Correct. Your answer matches the configured answer."
              : outcome === "unreadable"
                ? "I could not read that answer. Check the requested notation."
                : "Not quite. Your answer does not match the expected answer."),
  };
}

function checkValidSpec(student: string, spec: AnswerSpec): TypedCheckResult {
  if (spec.kind === "categorical") {
    const normalized = normalizeCategory(student);
    const forbidden = spec.forbiddenTerms?.some((term) =>
      ` ${normalized} `.includes(` ${normalizeCategory(term)} `),
    );
    return result(
      !forbidden &&
        [spec.canonical, ...spec.aliases].some(
          (alias) => normalizeCategory(alias) === normalized,
        )
        ? "correct"
        : "incorrect",
      normalized,
      normalizeCategory(spec.canonical),
    );
  }
  if (spec.kind === "number_list") {
    const expected = spec.values.map((v) => parseRational(v)!);
    const parsed = parseList(student, spec.labels);
    const label = spec.values.join(", ");
    if (!parsed)
      return result("unreadable", student.trim(), label, "unknown_token");
    const matches = (i: number, j: number) =>
      (!spec.labels ||
        normalizeListLabel(spec.labels[j]) === parsed.labels?.[i]) &&
      withinTolerance(
        parsed.values[i],
        expected[j],
        toleranceFor(expected[j], spec.tolerance)!,
      );
    let correct = parsed.values.length === expected.length;
    if (correct && spec.ordered)
      correct = expected.every((_, i) => matches(i, i));
    else if (correct) {
      // Maximum bipartite matching preserves multiplicity even when tolerances overlap.
      const owners = Array<number>(expected.length).fill(-1);
      const assign = (i: number, seen: Set<number>): boolean => {
        for (let j = 0; j < expected.length; j++) {
          if (seen.has(j) || !matches(i, j)) continue;
          seen.add(j);
          if (owners[j] === -1 || assign(owners[j], seen)) {
            owners[j] = i;
            return true;
          }
        }
        return false;
      };
      correct = parsed.values.every((_, i) => assign(i, new Set()));
    }
    return result(
      correct ? "correct" : "incorrect",
      parsed.values.map(show).join(", "),
      label,
    );
  }
  const expected = numericInput(spec.value, spec).value!;
  const parsed = numericInput(student, spec);
  if (!parsed.value)
    return result(
      "unreadable",
      student.trim(),
      show(expected),
      "unknown_token",
    );
  const value = parsed.value;
  const tolerance = toleranceFor(expected, spec.tolerance)!;
  const normalized = show(value);
  if (
    (spec.domain === "probability" && !inRange(value)) ||
    (spec.domain === "count" && value.n % value.d !== zero) ||
    !withinTolerance(value, expected, tolerance)
  ) {
    let detail: CheckDetail | undefined;
    if (
      rationalsEqual(value, { n: expected.n * hundred, d: expected.d }) ||
      rationalsEqual(value, { n: expected.n, d: expected.d * hundred })
    )
      detail = "percent_decimal_confusion";
    else if (
      inRange(expected) &&
      rationalsEqual(value, { n: expected.d - expected.n, d: expected.d })
    )
      detail = "complement";
    else if (
      withinTolerance(value, expected, {
        n: tolerance.n * BigInt(10),
        d: tolerance.d,
      })
    )
      detail = "close_rounding";
    return result("incorrect", normalized, show(expected), detail);
  }
  if (spec.unit?.required && !parsed.unitPresent)
    return result("incorrect", normalized, show(expected), "missing_unit");
  // The value already matched. Percent notation in decimal mode is a form
  // requirement, so formPolicy decides the outcome exactly as for requiredForm.
  const percentNotation =
    spec.percentMode === "decimal" && parsed.markedPercent;
  const detail = percentNotation
    ? "wrong_form"
    : formDetail(
        parsed.raw,
        value,
        spec.requiredForm ?? (spec.domain === "count" ? "integer" : undefined),
      );
  const outcome =
    detail && spec.formPolicy === "require" ? "incorrect" : "correct";
  return result(
    outcome,
    normalized,
    show(expected),
    detail,
    percentNotation
      ? outcome === "correct"
        ? "Correct value — write it as an unscaled decimal or fraction rather than a percentage."
        : "Write the answer as an unscaled decimal or fraction rather than a percentage."
      : undefined,
  );
}

export function validateAnswerSpec(
  value: unknown,
  acceptedAnswers?: string[],
): AnswerSpecIssue[] {
  const issues: AnswerSpecIssue[] = [];
  const add = (code: AnswerSpecIssue["code"], message: string) => {
    issues.push({ code, message });
  };
  if (!record(value))
    return [
      {
        code: "invalid_answer_spec",
        message: "Answer spec must be an object.",
      },
    ];
  if (value.kind === "numeric") {
    if (
      !keys(value, [
        "kind",
        "value",
        "domain",
        "percentMode",
        "tolerance",
        "requiredForm",
        "formPolicy",
        "unit",
      ]) ||
      !text(value.value) ||
      !["probability", "count", "real"].includes(String(value.domain))
    )
      add(
        "invalid_answer_spec",
        "Numeric specs require a bounded canonical value and domain.",
      );
    if (!["decimal", "percent", "either"].includes(String(value.percentMode)))
      add("percent_mode_missing", "Choose an explicit percent mode.");
    if (
      value.requiredForm !== undefined &&
      ![
        "decimal",
        "fraction",
        "simplified_fraction",
        "percent",
        "integer",
      ].includes(String(value.requiredForm))
    )
      add("invalid_answer_spec", "Unknown required answer form.");
    if (
      value.formPolicy !== undefined &&
      !["note", "require"].includes(String(value.formPolicy))
    )
      add("invalid_answer_spec", "Unknown form policy.");
    if (
      value.unit !== undefined &&
      (!record(value.unit) ||
        !keys(value.unit, ["label", "required"]) ||
        !text(value.unit.label) ||
        value.unit.label.length > 40 ||
        value.unit.label !== value.unit.label.trim() ||
        !/^[\p{L}$€£¥°][\p{L}\p{N} $€£¥°/²³-]*$/u.test(value.unit.label) ||
        typeof value.unit.required !== "boolean")
    )
      add(
        "invalid_answer_spec",
        "Unit requires a short literal label and a required flag.",
      );
  } else if (value.kind === "categorical") {
    if (
      !keys(value, ["kind", "canonical", "aliases", "forbiddenTerms"]) ||
      !text(value.canonical) ||
      !normalizeCategory(value.canonical)
    )
      add(
        "invalid_answer_spec",
        "Categorical specs require a canonical answer.",
      );
    if (
      !strings(value.aliases) ||
      value.aliases.some((v) => !normalizeCategory(v))
    )
      add(
        "categorical_alias_empty",
        "Aliases must be bounded nonempty answers.",
      );
    if (
      value.forbiddenTerms !== undefined &&
      (!strings(value.forbiddenTerms) ||
        value.forbiddenTerms.some((v) => !normalizeCategory(v)))
    )
      add(
        "invalid_answer_spec",
        "Forbidden terms must be bounded nonempty phrases.",
      );
  } else if (value.kind === "number_list") {
    if (
      !keys(value, ["kind", "values", "ordered", "labels", "tolerance"]) ||
      !strings(value.values, 1) ||
      typeof value.ordered !== "boolean"
    )
      add(
        "invalid_answer_spec",
        "Lists require 1–32 values and an ordered flag.",
      );
    // Students cannot reproduce "1,000" inside a list: the comma is always a separator.
    else if (value.values.some((v) => LIST_SEPARATOR.test(v)))
      add(
        "invalid_answer_spec",
        "List values must not contain the separators , or ; — write 1000 rather than 1,000.",
      );
    if (
      value.labels !== undefined &&
      (!strings(value.labels, 1) ||
        !Array.isArray(value.values) ||
        value.labels.length !== value.values.length ||
        value.labels.some(
          (v) =>
            v.length > 80 ||
            LIST_SEPARATOR.test(v) ||
            !/^[A-Za-z0-9_().=\s-]+$/.test(v),
        ) ||
        new Set(value.labels.map(normalizeListLabel)).size !==
          value.labels.length)
    )
      add(
        "invalid_answer_spec",
        "Labels must be unique and correspond to each value.",
      );
  } else add("invalid_answer_spec", "Unknown answer kind.");
  if (value.kind !== "categorical" && !validTolerance(value.tolerance))
    add(
      "tolerance_out_of_bounds",
      "Tolerance must be finite, nonnegative, and use a supported mode (0–15 places or 1–15 significant digits).",
    );
  if (issues.length) return issues;
  const spec = value as AnswerSpec;
  if (spec.kind !== "categorical") {
    const expected =
      spec.kind === "numeric"
        ? [numericInput(spec.value, spec).value]
        : spec.values.map((v) => parseRational(v));
    if (expected.some((v) => !v))
      return [
        {
          code: "answer_value_unparseable",
          message:
            "Every canonical value must parse with the bounded numeric grammar.",
        },
      ];
    for (const item of expected as Rational[]) {
      const tol = toleranceFor(item, spec.tolerance);
      if (!tol)
        add(
          "tolerance_out_of_bounds",
          "Relative and significant tolerances require a nonzero expected value.",
        );
      if (spec.kind === "numeric") {
        if (spec.domain === "probability") {
          if (!inRange(item))
            add(
              "invalid_answer_spec",
              "Expected probability must lie in [0,1].",
            );
          const relative =
            spec.tolerance.mode === "relative"
              ? spec.tolerance.value
              : spec.tolerance.mode === "combined"
                ? spec.tolerance.relative
                : 0;
          const absolute =
            spec.tolerance.mode === "combined"
              ? rationalFromNumber(spec.tolerance.absolute)!
              : spec.tolerance.mode === "relative"
                ? { n: zero, d: one }
                : tol;
          if (
            relative > 0.02 ||
            (absolute && absolute.n * hundred > absolute.d)
          )
            add(
              "tolerance_out_of_bounds",
              "Probability tolerances are limited to 0.01 absolute and 0.02 relative.",
            );
        }
        if (
          spec.domain === "count" &&
          (spec.tolerance.mode !== "exact" || item.n % item.d !== zero)
        )
          add(
            "tolerance_out_of_bounds",
            "Counts require an integer canonical value and exact tolerance.",
          );
        if (spec.requiredForm === "integer" && item.n % item.d !== zero)
          add(
            "required_form_unsatisfiable",
            "A noninteger value cannot satisfy integer form.",
          );
        if (spec.requiredForm === "percent" && spec.percentMode === "decimal")
          add(
            "required_form_unsatisfiable",
            "Decimal-only mode cannot require percent notation.",
          );
        if (
          spec.requiredForm === "decimal" &&
          spec.tolerance.mode === "exact"
        ) {
          let d = item.d;
          while (d % BigInt(2) === zero) d /= BigInt(2);
          while (d % BigInt(5) === zero) d /= BigInt(5);
          if (d !== one)
            add(
              "required_form_unsatisfiable",
              "An exact repeating fraction cannot be written as a finite decimal.",
            );
        }
      }
    }
  }
  if (issues.length) return issues;
  const answers =
    spec.kind === "categorical"
      ? [spec.canonical, ...spec.aliases, ...(acceptedAnswers ?? [])]
      : (acceptedAnswers ?? []);
  if (
    answers.some(
      (answer) =>
        !text(answer) || checkValidSpec(answer, spec).outcome !== "correct",
    )
  )
    add(
      "accepted_answer_inconsistent",
      "Every accepted answer must satisfy the typed checker, including required units and form.",
    );
  return issues;
}

/** Safe boundary for callers receiving untrusted authored or generated metadata. */
export function checkTypedAnswer(
  student: string,
  spec: AnswerSpec,
): TypedCheckResult {
  if (
    student.length > 500 ||
    !student.trim() ||
    validateAnswerSpec(spec).length
  )
    return result(
      "unreadable",
      student.slice(0, 500).trim(),
      "",
      "unknown_token",
    );
  return checkValidSpec(student, spec);
}

export function answerSpecFromSnapshot(
  snapshot: unknown,
): AnswerSpec | undefined {
  if (
    !record(snapshot) ||
    !record(snapshot.answer) ||
    snapshot.answer.spec === undefined
  )
    return undefined;
  // Preserve invalid metadata so it fails closed; never downgrade a malformed typed snapshot to legacy.
  return snapshot.answer.spec as AnswerSpec;
}

/** Provider output is still untrusted; validateAnswerSpec is authoritative. */
export const ANSWER_SPEC_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["numeric", "categorical", "number_list"] },
    value: { type: "string", maxLength: 500 },
    domain: { type: "string", enum: ["probability", "count", "real"] },
    percentMode: { type: "string", enum: ["decimal", "percent", "either"] },
    canonical: { type: "string", maxLength: 500 },
    aliases: {
      type: "array",
      maxItems: 32,
      items: { type: "string", maxLength: 500 },
    },
    forbiddenTerms: {
      type: "array",
      maxItems: 32,
      items: { type: "string", maxLength: 500 },
    },
    values: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: { type: "string", maxLength: 500 },
    },
    labels: {
      type: "array",
      maxItems: 32,
      items: { type: "string", maxLength: 80 },
    },
    ordered: { type: "boolean" },
    requiredForm: {
      type: "string",
      enum: [
        "decimal",
        "fraction",
        "simplified_fraction",
        "percent",
        "integer",
      ],
    },
    formPolicy: { type: "string", enum: ["note", "require"] },
    unit: {
      type: "object",
      additionalProperties: false,
      required: ["label", "required"],
      properties: {
        label: { type: "string", maxLength: 40 },
        required: { type: "boolean" },
      },
    },
    tolerance: {
      type: "object",
      additionalProperties: false,
      required: ["mode"],
      properties: {
        mode: {
          type: "string",
          enum: [
            "exact",
            "absolute",
            "relative",
            "combined",
            "decimals",
            "significant",
          ],
        },
        value: { type: "number", minimum: 0 },
        absolute: { type: "number", minimum: 0 },
        relative: { type: "number", minimum: 0 },
        places: { type: "integer", minimum: 0, maximum: 15 },
        digits: { type: "integer", minimum: 1, maximum: 15 },
      },
    },
  },
  required: ["kind"],
  additionalProperties: false,
};
