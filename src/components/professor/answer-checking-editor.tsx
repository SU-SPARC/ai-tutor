"use client";

import { useRef, useState, type ReactElement, type ReactNode } from "react";
import type { QuestionContent } from "@/lib/types";
import {
  validateAnswerSpec,
  type AnswerSpec,
  type AnswerSpecIssue,
  type NumericAnswerSpec,
  type ToleranceSpec,
} from "@/lib/tutor/answer/spec";
import { parseRational } from "@/lib/tutor/answer/rational";
import type { AnswerCheckResult } from "@/lib/tutor/answer-checker";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Field as FieldPrimitive } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusChip } from "@/components/ui/status-chip";
import { LinesTextarea } from "@/components/professor/lines-textarea";

export { normalizeLines } from "@/components/professor/lines-textarea";

type Answer = QuestionContent["answer"];
type CategoricalSpec = Extract<AnswerSpec, { kind: "categorical" }>;
type NumberListSpec = Extract<AnswerSpec, { kind: "number_list" }>;

/**
 * How the answer is checked. "auto" reads the correct answer: a number is
 * checked as a number, anything else as words. "legacy" keeps the older
 * checking (the listed answers, no typed rules).
 */
type CheckingChoice =
  | "auto"
  | "numeric"
  | "categorical"
  | "number_list"
  | "legacy";

/** Typed categorical answers keep the legacy accepted answers equal to canonical plus aliases. */
export function categoricalAcceptedAnswers(spec: {
  canonical: string;
  aliases: string[];
}): string[] {
  return Array.from(
    new Set(
      [spec.canonical, ...spec.aliases]
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  );
}

/** A labelled control; `title` is the visible label. */
function Field({
  children,
  description,
  error,
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  title: string;
}) {
  return (
    <FieldPrimitive label={title} description={description} error={error}>
      {children as ReactElement<Record<string, unknown>>}
    </FieldPrimitive>
  );
}

function LinesField({
  description,
  error,
  title,
  values,
  onChange,
  placeholder,
}: {
  description?: ReactNode;
  error?: ReactNode;
  title: string;
  values: string[];
  onChange: (lines: string[]) => void;
  placeholder?: string;
}) {
  return (
    <Field title={title} description={description} error={error}>
      <LinesTextarea
        className="min-h-24 font-mono"
        placeholder={placeholder}
        values={values}
        onChange={onChange}
      />
    </Field>
  );
}

const REQUESTED_FORM_LABELS: Record<
  NonNullable<NumericAnswerSpec["requiredForm"]>,
  string
> = {
  decimal: "Decimal (0.25)",
  fraction: "Fraction (1/4)",
  integer: "Whole number",
  percent: "Percent (25%)",
  simplified_fraction: "Fraction in lowest terms",
};

const TOLERANCE_MODE_LABELS: Record<string, string> = {
  absolute: "Within a set amount",
  combined: "Within a set amount or a share of the answer",
  decimals: "Rounded to a number of decimal places",
  relative: "Within a share of the answer",
  significant: "Rounded to a number of significant digits",
};

const CHECKING_LABELS: Record<CheckingChoice, string> = {
  auto: "Automatically: as a number when it is one, otherwise as words",
  categorical: "As words or a short phrase",
  legacy: "Compare with the listed answers only (older style)",
  number_list: "As a list of numbers",
  numeric: "As a number",
};

const CONTROL = "min-h-11";

function uniqueNonEmpty(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function detectKind(value: string): "numeric" | "categorical" {
  return parseRational(value.trim()) ? "numeric" : "categorical";
}

function detectDomain(value: string): NumericAnswerSpec["domain"] {
  const parsed = parseRational(value.trim());
  if (!parsed) return "probability";
  const positive = parsed.d > BigInt(0);
  const n = positive ? parsed.n : -parsed.n;
  const d = positive ? parsed.d : -parsed.d;
  return n >= BigInt(0) && n <= d ? "probability" : "real";
}

function defaultNumeric(value: string): NumericAnswerSpec {
  return {
    kind: "numeric",
    value,
    domain: detectDomain(value),
    percentMode: "either",
    tolerance: { mode: "absolute", value: 0.001 },
  };
}

function initialChoice(answer: Answer): CheckingChoice {
  const spec = answer.spec;
  if (!spec)
    return answer.acceptedAnswers.some((entry) => entry.trim())
      ? "legacy"
      : "auto";
  if (spec.kind === "number_list") return "number_list";
  const current = spec.kind === "numeric" ? spec.value : spec.canonical;
  return !current.trim() || detectKind(current) === spec.kind
    ? "auto"
    : spec.kind;
}

/** Plain-language field errors from the typed checker's validation. */
function plainIssues(spec: AnswerSpec, issues: AnswerSpecIssue[]) {
  const errors: {
    correct?: string;
    others?: string;
    tolerance?: string;
    form?: string;
    percent?: string;
    unit?: string;
    labels?: string;
  } = {};
  for (const issue of issues) {
    switch (issue.code) {
      case "answer_value_unparseable":
        errors.correct ??=
          spec.kind === "number_list"
            ? "Each line needs one number, like 0.25 or 1/4."
            : "We couldn't read this as a number. Try a form like 0.25, 1/4 or 25%.";
        break;
      case "accepted_answer_inconsistent":
      case "categorical_alias_empty":
        errors.others ??=
          "Every answer in this list must also count as correct. Remove any that don't match the correct answer.";
        break;
      case "tolerance_out_of_bounds":
        if (issue.message.includes("Counts require"))
          errors.correct ??= "A count must be a whole number.";
        else
          errors.tolerance ??= issue.message.includes("Probability")
            ? "For a probability, the margin can be at most 0.01."
            : issue.message.includes("nonzero")
              ? "This kind of margin doesn't work when the correct answer is 0."
              : "Please choose a margin of 0 or more.";
        break;
      case "required_form_unsatisfiable":
        errors.form ??=
          "The correct answer can't be written in this form. Choose another form or “Any form”.";
        break;
      case "percent_mode_missing":
        errors.percent ??= "Please choose how to read percentages.";
        break;
      default:
        if (issue.message.includes("[0,1]"))
          errors.correct ??= "A probability must be between 0 and 1.";
        else if (issue.message.includes("separators"))
          errors.correct ??=
            "Write numbers without commas or semicolons, for example 1000 rather than 1,000.";
        else if (issue.message.includes("Labels"))
          errors.labels ??=
            "Give each value one label, and don't repeat a label.";
        else if (issue.message.includes("Unit"))
          errors.unit ??= "Use a short unit such as $ or cm.";
        else if (issue.message.includes("Forbidden"))
          errors.others ??= "Leave out blank lines and symbols-only phrases.";
        else
          errors.correct ??=
            "Please check the correct answer. Use letters or numbers.";
    }
  }
  return errors;
}

/**
 * The answer and how it is checked. The default view is one "Correct answer"
 * field, the other answers to accept and a tester; every checking rule sits in
 * "Answer checking options (advanced)", closed until the professor opens it.
 * The emitted value keeps the same shape as before (accepted answers,
 * explanation, optional typed spec).
 */
export function AnswerCheckingEditor({
  answer,
  onChange,
  disabled = false,
}: {
  answer: Answer;
  onChange: (answer: Answer) => void;
  disabled?: boolean;
}) {
  const spec = answer.spec;
  const [choice, setChoice] = useState<CheckingChoice>(() =>
    initialChoice(answer),
  );
  // Kept while "auto" switches between a number and words mid-typing, so a
  // professor's number settings are not lost on the way through "1/".
  const lastNumeric = useRef<NumericAnswerSpec | undefined>(
    spec?.kind === "numeric" ? spec : undefined,
  );
  const lastForbidden = useRef<string[] | undefined>(
    spec?.kind === "categorical" ? spec.forbiddenTerms : undefined,
  );
  const [trial, setTrial] = useState("");
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<{
    key: string;
    result?: AnswerCheckResult;
    error?: string;
  }>();
  const previewKey = JSON.stringify([answer, trial]);

  const shownChoice: CheckingChoice = spec
    ? spec.kind === "number_list"
      ? "number_list"
      : choice === "auto"
        ? "auto"
        : spec.kind
    : choice === "auto"
      ? "auto"
      : "legacy";

  // The two default fields, read from whichever shape the answer has.
  const correct =
    spec?.kind === "numeric"
      ? spec.value
      : spec?.kind === "categorical"
        ? spec.canonical
        : (answer.acceptedAnswers[0] ?? "");
  const others =
    spec?.kind === "categorical"
      ? spec.aliases
      : spec?.kind === "numeric"
        ? answer.acceptedAnswers.filter(
            (entry) => entry.trim() !== spec.value.trim(),
          )
        : spec?.kind === "number_list"
          ? answer.acceptedAnswers
          : answer.acceptedAnswers.slice(1);

  function remember(next: AnswerSpec | undefined) {
    if (next?.kind === "numeric") lastNumeric.current = next;
    if (next?.kind === "categorical")
      lastForbidden.current = next.forbiddenTerms;
  }
  function setSpec(next: AnswerSpec | undefined) {
    remember(next);
    if (next)
      onChange({
        acceptedAnswers: answer.acceptedAnswers,
        explanation: answer.explanation,
        spec: next,
      });
    else {
      const nextAnswer = { ...answer };
      delete nextAnswer.spec;
      onChange(nextAnswer);
    }
  }
  function emitNumeric(next: NumericAnswerSpec, nextOthers: string[]) {
    remember(next);
    onChange({
      acceptedAnswers: uniqueNonEmpty([next.value, ...nextOthers]),
      explanation: answer.explanation,
      spec: next,
    });
  }
  function setCategorical(next: CategoricalSpec) {
    remember(next);
    onChange({
      acceptedAnswers: categoricalAcceptedAnswers(next),
      explanation: answer.explanation,
      spec: next,
    });
  }
  function categoricalFrom(
    canonical: string,
    aliases: string[],
  ): CategoricalSpec {
    return {
      kind: "categorical",
      canonical,
      aliases,
      ...(lastForbidden.current?.length
        ? { forbiddenTerms: lastForbidden.current }
        : {}),
    };
  }
  function numericFrom(value: string, pinned: boolean): NumericAnswerSpec {
    const previous = lastNumeric.current;
    if (!previous) return defaultNumeric(value);
    return {
      ...previous,
      value,
      // While checking is automatic the kind of number follows the answer.
      ...(pinned ? {} : { domain: detectDomain(value) }),
    };
  }
  function numeric(change: Partial<NumericAnswerSpec>) {
    if (spec?.kind !== "numeric") return;
    // An explicit number setting keeps this a number from now on.
    if (choice === "auto") setChoice("numeric");
    setSpec({ ...spec, ...change });
  }

  function changeCorrect(value: string) {
    if (spec?.kind === "number_list") return;
    if (!spec && choice === "legacy") {
      onChange({ ...answer, acceptedAnswers: [value, ...others] });
      return;
    }
    const kind =
      choice === "numeric" || choice === "categorical"
        ? choice
        : value.trim()
          ? detectKind(value)
          : (spec?.kind ?? "categorical");
    if (!spec && !value.trim()) {
      onChange({ ...answer, acceptedAnswers: others });
      return;
    }
    if (kind === "numeric")
      emitNumeric(numericFrom(value, choice === "numeric"), others);
    else setCategorical(categoricalFrom(value, others));
  }

  function changeOthers(lines: string[]) {
    if (spec?.kind === "numeric") emitNumeric(spec, lines);
    else if (spec?.kind === "categorical")
      setCategorical({ ...spec, aliases: lines });
    else if (spec?.kind === "number_list")
      onChange({ ...answer, acceptedAnswers: lines });
    else
      onChange({
        ...answer,
        acceptedAnswers: correct.trim() ? [correct, ...lines] : lines,
      });
  }

  function chooseChecking(next: CheckingChoice) {
    setChoice(next);
    if (next === "legacy") {
      setSpec(undefined);
      return;
    }
    if (next === "number_list") {
      if (spec?.kind === "number_list") return;
      setSpec({
        kind: "number_list",
        values: correct.trim() ? [correct.trim()] : [],
        ordered: true,
        tolerance: { mode: "exact" },
      });
      return;
    }
    const start =
      spec?.kind === "number_list" ? (answer.acceptedAnswers[0] ?? "") : correct;
    const kind =
      next === "auto"
        ? start.trim()
          ? detectKind(start)
          : undefined
        : next;
    if (!kind) return;
    if (kind === "numeric")
      emitNumeric(numericFrom(start, next === "numeric"), others);
    else setCategorical(categoricalFrom(start, others));
  }

  async function simulate() {
    setPending(true);
    try {
      const response = await fetch("/api/professor/answer-checker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer, studentAnswer: trial }),
      });
      const payload = await response.json();
      setPreview({
        key: previewKey,
        ...(response.ok
          ? { result: payload }
          : {
              error:
                "We couldn't try that answer. Check the notes next to the fields above, then try again.",
            }),
      });
    } catch {
      setPreview({
        key: previewKey,
        error: "That didn't work. Try again.",
      });
    } finally {
      setPending(false);
    }
  }
  const shown = preview?.key === previewKey ? preview : undefined;

  const hasCorrect =
    spec?.kind === "number_list"
      ? spec.values.some((value) => value.trim())
      : correct.trim().length > 0;
  const issues =
    spec && hasCorrect
      ? validateAnswerSpec(spec, answer.acceptedAnswers)
      : [];
  const errors = spec ? plainIssues(spec, issues) : {};
  const advancedError = Boolean(
    errors.tolerance ||
      errors.form ||
      errors.percent ||
      errors.unit ||
      errors.labels,
  );

  return (
    <fieldset
      disabled={disabled}
      className="@container min-w-0 rounded-panel bg-surface-tint p-4 sm:p-5"
    >
      <legend className="float-left mb-4 w-full type-h3 text-ink">
        Answer
      </legend>
      <div className="clear-left flex flex-col gap-4">
        {spec?.kind === "number_list" ? (
          <LinesField
            title="Correct values (one per line)"
            description="One number per line, like 0.25 or 1/4. Don't use commas inside a number."
            error={errors.correct}
            values={spec.values}
            onChange={(values) => setSpec({ ...spec, values })}
          />
        ) : (
          <Field
            title="Correct answer"
            description="For example 0.25 or 1/4. Equivalent forms like 25% are accepted."
            error={errors.correct}
          >
            <Input
              mono
              className={CONTROL}
              value={correct}
              maxLength={500}
              onChange={(e) => changeCorrect(e.target.value)}
            />
          </Field>
        )}
        <LinesField
          title="Other answers to accept (optional, one per line)"
          error={errors.others}
          values={others}
          onChange={changeOthers}
        />
        {advancedError ? (
          <p className="type-body font-medium text-red-700">
            Please check “Answer checking options (advanced)” below.
          </p>
        ) : null}

        <details
          className="group rounded-control border border-rule bg-sheet"
          open={advancedError ? true : undefined}
        >
          <summary className="flex min-h-11 cursor-pointer items-center px-4 py-2 type-body-strong text-ink focus-ring">
            Answer checking options (advanced)
          </summary>
          <div className="flex flex-col gap-4 border-t border-rule p-4">
            <Field title="How should the answer be checked?">
              <NativeSelect
                className={CONTROL}
                value={shownChoice}
                onChange={(e) =>
                  chooseChecking(e.target.value as CheckingChoice)
                }
              >
                {(
                  [
                    "auto",
                    "numeric",
                    "categorical",
                    "number_list",
                    "legacy",
                  ] as const
                ).map((value) => (
                  <option key={value} value={value}>
                    {CHECKING_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {!spec && (
              <p className="type-body max-w-prose text-ink">
                {shownChoice === "legacy"
                  ? "A student's answer counts as correct when it matches one of the answers above."
                  : "Type the correct answer above and we'll choose how to check it."}
              </p>
            )}
            {spec?.kind === "numeric" && (
              <>
                <div className="grid gap-4 @lg:grid-cols-2">
                  <Field title="What kind of number is it?">
                    <NativeSelect
                      className={CONTROL}
                      value={spec.domain}
                      onChange={(e) => {
                        const domain = e.target
                          .value as NumericAnswerSpec["domain"];
                        numeric({
                          domain,
                          tolerance:
                            domain === "count"
                              ? { mode: "exact" }
                              : { mode: "absolute", value: 0.001 },
                          requiredForm:
                            domain === "count" ? "integer" : undefined,
                        });
                      }}
                    >
                      <option value="probability">
                        A probability (between 0 and 1)
                      </option>
                      <option value="count">A count (whole number)</option>
                      <option value="real">Any number</option>
                    </NativeSelect>
                  </Field>
                  <Field
                    title="How to read percentages"
                    description="This also applies to the correct answer."
                    error={errors.percent}
                  >
                    <NativeSelect
                      className={CONTROL}
                      value={spec.percentMode}
                      onChange={(e) =>
                        numeric({
                          percentMode: e.target
                            .value as NumericAnswerSpec["percentMode"],
                        })
                      }
                    >
                      <option value="either">
                        0.25 and 25% both mean one quarter
                      </option>
                      <option value="decimal">
                        Only 0.25 or 1/4 (no percent sign)
                      </option>
                      <option value="percent">25 means 25%</option>
                    </NativeSelect>
                  </Field>
                </div>
                <ToleranceEditor
                  error={errors.tolerance}
                  value={spec.tolerance}
                  onChange={(tolerance) => numeric({ tolerance })}
                  exactOnly={spec.domain === "count"}
                />
                <div className="grid gap-4 @lg:grid-cols-2">
                  <Field
                    title="Ask for a particular form"
                    error={errors.form}
                  >
                    <NativeSelect
                      className={CONTROL}
                      value={spec.requiredForm ?? ""}
                      onChange={(e) =>
                        numeric({
                          requiredForm: e.target.value
                            ? (e.target
                                .value as NumericAnswerSpec["requiredForm"])
                            : undefined,
                        })
                      }
                    >
                      <option value="">Any form</option>
                      {(
                        [
                          "decimal",
                          "fraction",
                          "simplified_fraction",
                          "percent",
                          "integer",
                        ] as const
                      ).map((v) => (
                        <option key={v} value={v}>
                          {REQUESTED_FORM_LABELS[v]}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field title="If a student uses a different form">
                    <NativeSelect
                      className={CONTROL}
                      value={spec.formPolicy ?? "note"}
                      onChange={(e) =>
                        numeric({
                          formPolicy: e.target.value as "note" | "require",
                        })
                      }
                    >
                      <option value="note">
                        Count it as correct and add a note
                      </option>
                      <option value="require">Count it as not correct</option>
                    </NativeSelect>
                  </Field>
                </div>
                <Field
                  title="Unit (optional)"
                  description="For example $ or cm."
                  error={errors.unit}
                >
                  <Input
                    className={CONTROL}
                    value={spec.unit?.label ?? ""}
                    maxLength={40}
                    onChange={(e) =>
                      numeric({
                        unit: e.target.value
                          ? {
                              label: e.target.value,
                              required: spec.unit?.required ?? false,
                            }
                          : undefined,
                      })
                    }
                  />
                </Field>
                {spec.unit && (
                  <CheckboxField
                    label="Students must write the unit"
                    checked={spec.unit.required}
                    onCheckedChange={(checked) =>
                      numeric({
                        unit: {
                          label: spec.unit!.label,
                          required: checked === true,
                        },
                      })
                    }
                  />
                )}
              </>
            )}
            {spec?.kind === "categorical" && (
              <LinesField
                title="Phrases that make an answer wrong (optional, one per line)"
                description="An answer containing one of these is never counted as correct."
                values={spec.forbiddenTerms ?? []}
                onChange={(forbiddenTerms) =>
                  setCategorical({
                    ...spec,
                    forbiddenTerms: forbiddenTerms.length
                      ? forbiddenTerms
                      : undefined,
                  })
                }
              />
            )}
            {spec?.kind === "number_list" && (
              <NumberListOptions
                error={errors.tolerance}
                labelsError={errors.labels}
                spec={spec}
                onChange={setSpec}
              />
            )}
          </div>
        </details>

        <div className="flex flex-col gap-3 border-t border-rule pt-4">
          <Field
            title="Try a student answer"
            description="Type what a student might write. This is only a test: nothing is saved."
          >
            <Input
              mono
              className={CONTROL}
              maxLength={500}
              value={trial}
              onChange={(e) => setTrial(e.target.value)}
            />
          </Field>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-fit"
            disabled={pending}
            onClick={simulate}
          >
            {pending ? "Checking…" : "Check this answer"}
          </Button>
          <div role="status" aria-live="polite">
            {shown?.error ? (
              <p className="type-body text-red-700">{shown.error}</p>
            ) : shown?.result ? (
              <div className="flex flex-col gap-1.5">
                <StatusChip
                  label={
                    shown.result.outcome === "correct"
                      ? "Correct"
                      : shown.result.outcome === "incorrect"
                        ? "Not correct"
                        : "Couldn't read that answer"
                  }
                  tone={
                    shown.result.outcome === "correct"
                      ? "correct"
                      : shown.result.outcome === "incorrect"
                        ? "wrong"
                        : "neutral"
                  }
                />
                <p className="type-body max-w-prose text-ink">
                  {shown.result.feedback}
                </p>
                <p className="type-small text-ink-muted">
                  Read as:{" "}
                  <span className="font-mono">
                    {shown.result.normalizedStudentAnswer}
                  </span>
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </fieldset>
  );
}

function NumberListOptions({
  error,
  labelsError,
  onChange,
  spec,
}: {
  error?: string;
  labelsError?: string;
  onChange: (spec: NumberListSpec) => void;
  spec: NumberListSpec;
}) {
  return (
    <>
      <CheckboxField
        label="Require this order"
        checked={spec.ordered}
        onCheckedChange={(checked) =>
          onChange({ ...spec, ordered: checked === true })
        }
      />
      <LinesField
        title="Labels (optional, one per value)"
        description="For example P(X=0). Students may then write P(X=0)=1/10."
        error={labelsError}
        placeholder="P(X=0)…"
        values={spec.labels ?? []}
        onChange={(labels) =>
          onChange({ ...spec, labels: labels.length ? labels : undefined })
        }
      />
      <ToleranceEditor
        error={error}
        value={spec.tolerance}
        onChange={(tolerance) => onChange({ ...spec, tolerance })}
      />
      <p className="type-body max-w-prose text-ink">
        Students may separate values with commas or semicolons, so write 1000
        rather than 1,000. A value listed twice must appear twice.
      </p>
    </>
  );
}

function ToleranceEditor({
  error,
  value,
  onChange,
  exactOnly = false,
}: {
  error?: string;
  value: ToleranceSpec;
  onChange: (v: ToleranceSpec) => void;
  exactOnly?: boolean;
}) {
  function mode(next: string) {
    if (next === "exact") onChange({ mode: "exact" });
    else if (next === "decimals") onChange({ mode: "decimals", places: 3 });
    else if (next === "significant")
      onChange({ mode: "significant", digits: 3 });
    else if (next === "combined")
      onChange({ mode: "combined", absolute: 0.001, relative: 0.01 });
    else onChange({ mode: next as "absolute" | "relative", value: 0.001 });
  }
  return (
    <div className="grid gap-4 @lg:grid-cols-2">
      <Field title="How close counts as correct" error={error}>
        <NativeSelect
          className={CONTROL}
          value={value.mode}
          onChange={(e) => mode(e.target.value)}
        >
          <option value="exact">Exactly equal</option>
          {!exactOnly &&
            ["absolute", "relative", "combined", "decimals", "significant"].map(
              (v) => (
                <option value={v} key={v}>
                  {TOLERANCE_MODE_LABELS[v] ?? v}
                </option>
              ),
            )}
        </NativeSelect>
      </Field>
      {(value.mode === "absolute" || value.mode === "relative") && (
        <Field
          title={
            value.mode === "absolute"
              ? "Allowed difference"
              : "Allowed share of the answer"
          }
          description={
            value.mode === "absolute"
              ? "For example 0.001."
              : "For example 0.01 for 1%."
          }
        >
          <Input
            className={CONTROL}
            type="number"
            min={0}
            step="any"
            value={value.value}
            onChange={(e) =>
              onChange({ ...value, value: Number(e.target.value) })
            }
          />
        </Field>
      )}
      {value.mode === "combined" && (
        <>
          <Field title="Allowed difference">
            <Input
              className={CONTROL}
              type="number"
              min={0}
              step="any"
              value={value.absolute}
              onChange={(e) =>
                onChange({ ...value, absolute: Number(e.target.value) })
              }
            />
          </Field>
          <Field title="Allowed share of the answer">
            <Input
              className={CONTROL}
              type="number"
              min={0}
              step="any"
              value={value.relative}
              onChange={(e) =>
                onChange({ ...value, relative: Number(e.target.value) })
              }
            />
          </Field>
        </>
      )}
      {value.mode === "decimals" && (
        <Field title="Decimal places">
          <Input
            className={CONTROL}
            type="number"
            min={0}
            max={15}
            value={value.places}
            onChange={(e) =>
              onChange({ ...value, places: Number(e.target.value) })
            }
          />
        </Field>
      )}
      {value.mode === "significant" && (
        <Field title="Significant digits">
          <Input
            className={CONTROL}
            type="number"
            min={1}
            max={15}
            value={value.digits}
            onChange={(e) =>
              onChange({ ...value, digits: Number(e.target.value) })
            }
          />
        </Field>
      )}
    </div>
  );
}
