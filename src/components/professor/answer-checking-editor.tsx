"use client";

import { useState, type ReactNode } from "react";
import type { QuestionContent } from "@/lib/types";
import type {
  AnswerSpec,
  NumericAnswerSpec,
  ToleranceSpec,
} from "@/lib/tutor/answer/spec";
import type { AnswerCheckResult } from "@/lib/tutor/answer-checker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nativeSelectClassName } from "@/components/ui/native-select";
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

function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span>{title}</span>
      {children}
    </label>
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
        placeholder={placeholder}
        values={values}
        onChange={onChange}
      />
    </Field>
  );
}

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
    <fieldset disabled={disabled} className="grid gap-4 rounded-lg border p-4">
      <legend className="px-1 font-medium">Answer checking</legend>
      <Field title="Answer kind">
        <select
          className={nativeSelectClassName}
          value={spec?.kind ?? "legacy"}
          onChange={(e) => chooseKind(e.target.value)}
        >
          <option value="legacy">Existing answer checking</option>
          <option value="numeric">Numeric</option>
          <option value="categorical">Short answer</option>
          <option value="number_list">List of numbers</option>
        </select>
      </Field>
      {!spec && (
        <p className="text-sm text-muted-foreground">
          This question keeps its existing answer behavior. Choose a kind to
          author explicit checking rules in the next saved version.
        </p>
      )}
      {spec?.kind === "numeric" && (
        <>
          <Field title="Canonical answer">
            <Input
              value={spec.value}
              maxLength={500}
              onChange={(e) => numeric({ value: e.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field title="Domain">
              <select
                className={nativeSelectClassName}
                value={spec.domain}
                onChange={(e) => {
                  const domain = e.target.value as NumericAnswerSpec["domain"];
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
              </select>
            </Field>
            <Field title="Percent interpretation">
              <select
                className={nativeSelectClassName}
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
                <option value="percent">Percentage points (25 or 25%)</option>
                <option value="either">
                  Decimal or marked percent (0.25 or 25%)
                </option>
              </select>
            </Field>
          </div>
          <p className="text-sm text-muted-foreground">
            Percent interpretation applies to the canonical answer too.
            Tolerances use decimal values after percent conversion.
          </p>
          <ToleranceEditor
            value={spec.tolerance}
            onChange={(tolerance) => numeric({ tolerance })}
            exactOnly={spec.domain === "count"}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field title="Requested form">
              <select
                className={nativeSelectClassName}
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
                {[
                  "decimal",
                  "fraction",
                  "simplified_fraction",
                  "percent",
                  "integer",
                ].map((v) => (
                  <option key={v} value={v}>
                    {v.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field title="Form policy">
              <select
                className={nativeSelectClassName}
                value={spec.formPolicy ?? "note"}
                onChange={(e) =>
                  numeric({ formPolicy: e.target.value as "note" | "require" })
                }
              >
                <option value="note">
                  Accept correct value and give a note
                </option>
                <option value="require">Require the requested form</option>
              </select>
            </Field>
          </div>
          <Field title="Unit label (optional)">
            <Input
              value={spec.unit?.label ?? ""}
              maxLength={40}
              placeholder="$ or cm"
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
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={spec.unit.required}
                onChange={(e) =>
                  numeric({
                    unit: {
                      label: spec.unit!.label,
                      required: e.target.checked,
                    },
                  })
                }
              />
              Require the unit in the answer
            </label>
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
          <p className="text-sm text-muted-foreground">
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
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={spec.ordered}
              onChange={(e) => setSpec({ ...spec, ordered: e.target.checked })}
            />
            Require this order
          </label>
          <LinesField
            title="Labels (one per value, optional)"
            placeholder="P(X=0)"
            values={spec.labels ?? []}
            onChange={(labels) =>
              setSpec({ ...spec, labels: labels.length ? labels : undefined })
            }
          />
          <ToleranceEditor
            value={spec.tolerance}
            onChange={(tolerance) => setSpec({ ...spec, tolerance })}
          />
          <p className="text-sm text-muted-foreground">
            Students may separate values with commas or semicolons, so expected
            values and labels must not contain commas or semicolons (write 1000,
            not 1,000). Labels use forms such as P(X=0)=1/10. Duplicate values
            retain their multiplicity.
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
      <div className="grid gap-2 border-t pt-3">
        <Field title="Try an answer">
          <Input
            maxLength={500}
            value={trial}
            onChange={(e) => setTrial(e.target.value)}
          />
        </Field>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={simulate}
        >
          {pending ? "Checking…" : "Try answer"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Preview only. No student session or attempt is recorded.
        </p>
        <div role="status" aria-live="polite">
          {shown?.error ??
            (shown?.result && (
              <>
                <p className="font-medium">
                  {shown.result.outcome === "correct"
                    ? "Correct"
                    : shown.result.outcome === "incorrect"
                      ? "Incorrect"
                      : "Unreadable input"}
                </p>
                <p>{shown.result.feedback}</p>
                <p className="text-sm">
                  Normalized: {shown.result.normalizedStudentAnswer}
                </p>
              </>
            ))}
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
    <div className="grid gap-2">
      <Field title="Tolerance">
        <select
          className={nativeSelectClassName}
          value={value.mode}
          onChange={(e) => mode(e.target.value)}
        >
          <option value="exact">Exact</option>
          {!exactOnly &&
            ["absolute", "relative", "combined", "decimals", "significant"].map(
              (v) => (
                <option value={v} key={v}>
                  {v === "decimals"
                    ? "Decimal places"
                    : v === "significant"
                      ? "Significant digits"
                      : v}
                </option>
              ),
            )}
        </select>
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
        <div className="grid gap-2 sm:grid-cols-2">
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
        </div>
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
