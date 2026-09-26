"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import type { QuestionContent } from "@/lib/types";
import type {
  AnswerSpec,
  NumericAnswerSpec,
  ToleranceSpec,
} from "@/lib/tutor/answer/spec";
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
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  title: string;
}) {
  return (
    <FieldPrimitive label={title} description={description}>
      {children as ReactElement<Record<string, unknown>>}
    </FieldPrimitive>
  );
}

function LinesField({
  title,
  values,
  onChange,
  placeholder,
}: {
  title: string;
  values: string[];
  onChange: (lines: string[]) => void;
  placeholder?: string;
}) {
  return (
    <Field title={title}>
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
  decimal: "Decimal",
  fraction: "Fraction",
  integer: "Whole number",
  percent: "Percent",
  simplified_fraction: "Simplified fraction",
};

const TOLERANCE_MODE_LABELS: Record<string, string> = {
  absolute: "Absolute difference",
  combined: "Absolute and relative",
  decimals: "Decimal places",
  relative: "Relative difference",
  significant: "Significant digits",
};

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
  const [trial, setTrial] = useState("");
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<{
    key: string;
    result?: AnswerCheckResult;
    error?: string;
  }>();
  const previewKey = JSON.stringify([answer, trial]);
  function setSpec(next: AnswerSpec | undefined) {
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
  function numeric(change: Partial<NumericAnswerSpec>) {
    if (spec?.kind === "numeric") setSpec({ ...spec, ...change });
  }
  function setCategorical(next: CategoricalSpec) {
    onChange({
      acceptedAnswers: categoricalAcceptedAnswers(next),
      explanation: answer.explanation,
      spec: next,
    });
  }
  function chooseKind(kind: string) {
    const canonical = answer.acceptedAnswers[0] ?? "";
    if (kind === "legacy") setSpec(undefined);
    else if (kind === "numeric")
      setSpec({
        kind,
        value: canonical,
        domain: "probability",
        percentMode: "either",
        tolerance: { mode: "absolute", value: 0.001 },
      });
    else if (kind === "categorical")
      setCategorical({
        kind,
        canonical,
        aliases: [...answer.acceptedAnswers],
      });
    else
      setSpec({
        kind: "number_list",
        values: [canonical],
        ordered: true,
        tolerance: { mode: "exact" },
      });
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
          : { error: payload.error ?? "Could not check this configuration." }),
      });
    } catch {
      setPreview({
        key: previewKey,
        error: "The checker is unavailable. Try again.",
      });
    } finally {
      setPending(false);
    }
  }
  const shown = preview?.key === previewKey ? preview : undefined;
  return (
    <fieldset
      disabled={disabled}
      className="@container min-w-0 rounded-panel bg-surface-tint p-4 sm:p-5"
    >
      <legend className="float-left mb-4 w-full type-h3 text-ink">
        Answer checking
      </legend>
      <div className="clear-left flex flex-col gap-4">
        <Field title="Answer kind">
          <NativeSelect
            value={spec?.kind ?? "legacy"}
            onChange={(e) => chooseKind(e.target.value)}
          >
            <option value="legacy">Existing answer checking</option>
            <option value="numeric">Numeric</option>
            <option value="categorical">Short answer</option>
            <option value="number_list">List of numbers</option>
          </NativeSelect>
        </Field>
        {!spec && (
          <p className="type-small max-w-prose text-ink-muted">
            This question keeps its existing answer behavior. Choose a kind to
            author explicit checking rules in the next saved version.
          </p>
        )}
        {spec?.kind === "numeric" && (
          <>
            <Field title="Canonical answer">
              <Input
                mono
                value={spec.value}
                maxLength={500}
                onChange={(e) => numeric({ value: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 @lg:grid-cols-2">
              <Field title="Domain">
                <NativeSelect
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
                      requiredForm: domain === "count" ? "integer" : undefined,
                    });
                  }}
                >
                  <option value="probability">Probability</option>
                  <option value="count">Count</option>
                  <option value="real">Real number</option>
                </NativeSelect>
              </Field>
              <Field
                title="Percent interpretation"
                description="Applies to the canonical answer too. Tolerances use decimal values after percent conversion."
              >
                <NativeSelect
                  value={spec.percentMode}
                  onChange={(e) =>
                    numeric({
                      percentMode: e.target
                        .value as NumericAnswerSpec["percentMode"],
                    })
                  }
                >
                  <option value="decimal">
                    Unscaled value (0.25 or 1/4); percent notation follows the
                    form policy
                  </option>
                  <option value="percent">
                    Percentage points (25 or 25%)
                  </option>
                  <option value="either">
                    Decimal or marked percent (0.25 or 25%)
                  </option>
                </NativeSelect>
              </Field>
            </div>
            <ToleranceEditor
              value={spec.tolerance}
              onChange={(tolerance) => numeric({ tolerance })}
              exactOnly={spec.domain === "count"}
            />
            <div className="grid gap-4 @lg:grid-cols-2">
              <Field title="Requested form">
                <NativeSelect
                  value={spec.requiredForm ?? ""}
                  onChange={(e) =>
                    numeric({
                      requiredForm: e.target.value
                        ? (e.target.value as NumericAnswerSpec["requiredForm"])
                        : undefined,
                    })
                  }
                >
                  <option value="">Any supported form</option>
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
              <Field title="Form policy">
                <NativeSelect
                  value={spec.formPolicy ?? "note"}
                  onChange={(e) =>
                    numeric({
                      formPolicy: e.target.value as "note" | "require",
                    })
                  }
                >
                  <option value="note">
                    Accept correct value and give a note
                  </option>
                  <option value="require">Require the requested form</option>
                </NativeSelect>
              </Field>
            </div>
            <Field title="Unit label (optional)">
              <Input
                value={spec.unit?.label ?? ""}
                maxLength={40}
                placeholder="$ or cm…"
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
                label="Require the unit in the answer"
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
          <>
            <Field title="Canonical short answer">
              <Input
                value={spec.canonical}
                maxLength={500}
                onChange={(e) =>
                  setCategorical({ ...spec, canonical: e.target.value })
                }
              />
            </Field>
            <LinesField
              title="Aliases — accepted equivalent answers (one per line)"
              values={spec.aliases}
              onChange={(aliases) => setCategorical({ ...spec, aliases })}
            />
            <p className="type-small max-w-prose text-ink-muted">
              The canonical answer and its aliases are the accepted answers for
              this question; there is no separate accepted-answer list to
              maintain.
            </p>
            <LinesField
              title="Forbidden phrases (one per line, optional)"
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
          </>
        )}
        {spec?.kind === "number_list" && (
          <>
            <LinesField
              title="Expected values (one per line)"
              values={spec.values}
              onChange={(values) => setSpec({ ...spec, values })}
            />
            <CheckboxField
              label="Require this order"
              checked={spec.ordered}
              onCheckedChange={(checked) =>
                setSpec({ ...spec, ordered: checked === true })
              }
            />
            <LinesField
              title="Labels (one per value, optional)"
              placeholder="P(X=0)…"
              values={spec.labels ?? []}
              onChange={(labels) =>
                setSpec({ ...spec, labels: labels.length ? labels : undefined })
              }
            />
            <ToleranceEditor
              value={spec.tolerance}
              onChange={(tolerance) => setSpec({ ...spec, tolerance })}
            />
            <p className="type-small max-w-prose text-ink-muted">
              Students may separate values with commas or semicolons, so
              expected values and labels must not contain commas or semicolons
              (write 1000, not 1,000). Labels use forms such as P(X=0)=1/10.
              Duplicate values retain their multiplicity.
            </p>
          </>
        )}
        {spec && spec.kind !== "categorical" && (
          <LinesField
            title="Accepted answers (one complete answer per line)"
            values={answer.acceptedAnswers}
            onChange={(acceptedAnswers) =>
              onChange({ ...answer, acceptedAnswers })
            }
          />
        )}
        <div className="flex flex-col gap-3 border-t border-rule pt-4">
          <Field
            title="Try an answer"
            description="Preview only. No student session or attempt is recorded."
          >
            <Input
              mono
              maxLength={500}
              value={trial}
              onChange={(e) => setTrial(e.target.value)}
            />
          </Field>
          <Button
            type="button"
            variant="secondary"
            className="w-fit"
            disabled={pending}
            onClick={simulate}
          >
            {pending ? "Checking…" : "Try answer"}
          </Button>
          <div role="status" aria-live="polite">
            {shown?.error ? (
              <p className="type-small text-red-700">{shown.error}</p>
            ) : shown?.result ? (
              <div className="flex flex-col gap-1.5">
                <StatusChip
                  label={
                    shown.result.outcome === "correct"
                      ? "Correct"
                      : shown.result.outcome === "incorrect"
                        ? "Incorrect"
                        : "Unreadable input"
                  }
                  tone={
                    shown.result.outcome === "correct"
                      ? "correct"
                      : shown.result.outcome === "incorrect"
                        ? "wrong"
                        : "neutral"
                  }
                />
                <p className="type-small max-w-prose text-ink">
                  {shown.result.feedback}
                </p>
                <p className="type-caption">
                  Normalized:{" "}
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

function ToleranceEditor({
  value,
  onChange,
  exactOnly = false,
}: {
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
      <Field title="Tolerance">
        <NativeSelect value={value.mode} onChange={(e) => mode(e.target.value)}>
          <option value="exact">Exact</option>
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
        <Field title="Tolerance value">
          <Input
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
          <Field title="Absolute tolerance">
            <Input
              type="number"
              min={0}
              step="any"
              value={value.absolute}
              onChange={(e) =>
                onChange({ ...value, absolute: Number(e.target.value) })
              }
            />
          </Field>
          <Field title="Relative tolerance">
            <Input
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
