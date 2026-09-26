"use client";

import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  QUESTION_FEEDBACK_CATEGORIES,
  type QuestionFeedbackCategory,
  type QuestionFeedbackReceipt,
} from "@/lib/types";

/** The link under the Sheet. The flag glyph is supplied by the caller. */
export const REPORT_A_PROBLEM_LABEL = "Report a problem with this question";

export const QUESTION_FEEDBACK_CATEGORY_LABELS: Record<
  QuestionFeedbackCategory,
  string
> = {
  answer_appears_incorrect: "Answer appears incorrect",
  hint_unhelpful: "Hint unhelpful",
  other: "Other",
  solution_step_issue: "Solution-step issue",
  technical_problem: "Technical problem",
  wording_unclear: "Wording unclear",
};

/**
 * "Report a problem with this question": a disclosure under the Sheet. The
 * form opens in the page flow (never a floating panel that overflows a phone),
 * works without JavaScript as a native `<details>`, and Escape closes it and
 * returns focus to its summary.
 */
export function QuestionFeedbackForm({
  questionTitle,
  sessionId,
}: {
  questionTitle: string;
  sessionId?: string;
}) {
  const [category, setCategory] = useState<QuestionFeedbackCategory>(
    "answer_appears_incorrect",
  );
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string>();
  const [receipt, setReceipt] = useState<QuestionFeedbackReceipt>();
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const headingId = useId();
  const categoryId = useId();
  const detailsId = useId();
  const privacyId = useId();

  if (!sessionId) {
    return (
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto px-0 text-ink-muted"
        disabled
      >
        {REPORT_A_PROBLEM_LABEL}
      </Button>
    );
  }

  function closeOnEscape(event: KeyboardEvent<HTMLDetailsElement>) {
    const disclosure = detailsRef.current;
    if (event.key !== "Escape" || !disclosure?.open) {
      return;
    }
    event.stopPropagation();
    disclosure.open = false;
    disclosure.querySelector("summary")?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionId || submitting) return;

    setSubmitting(true);
    setError(undefined);
    setReceipt(undefined);
    idempotencyKey.current ??= createIdempotencyKey();

    try {
      const response = await fetch(
        `/api/tutor/session/${encodeURIComponent(sessionId)}/feedback`,
        {
          body: JSON.stringify({
            category,
            details: details.trim() || undefined,
            idempotencyKey: idempotencyKey.current,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        receipt?: QuestionFeedbackReceipt;
      };
      if (!response.ok || !payload.receipt) {
        setError(payload.error ?? "The report could not be sent.");
        return;
      }

      setReceipt(payload.receipt);
      setDetails("");
      idempotencyKey.current = null;
    } catch {
      setError("The report could not be sent. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <details
      ref={detailsRef}
      className="group min-w-0 flex-1"
      onKeyDown={closeOnEscape}
    >
      <summary className="type-small inline-flex min-h-6 cursor-pointer list-none items-center rounded-xs text-ink-muted underline-offset-4 transition-colors duration-fast hover:text-ink hover:underline focus-ring pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        {REPORT_A_PROBLEM_LABEL}
      </summary>
      <section
        aria-labelledby={headingId}
        className="mt-3 flex max-w-lg flex-col gap-4 rounded-panel bg-surface-tint p-4 text-ink"
      >
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="type-h3 text-ink">
            Report a problem
          </h2>
          <p className="type-caption line-clamp-2">{questionTitle}</p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={categoryId} className="type-body-strong text-ink">
              What went wrong?
            </label>
            <NativeSelect
              id={categoryId}
              value={category}
              disabled={submitting}
              onChange={(event) => {
                setCategory(event.target.value as QuestionFeedbackCategory);
                setReceipt(undefined);
              }}
            >
              {QUESTION_FEEDBACK_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {QUESTION_FEEDBACK_CATEGORY_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={detailsId} className="type-body-strong text-ink">
              Details (optional)
            </label>
            <Textarea
              id={detailsId}
              maxLength={1_000}
              rows={4}
              value={details}
              disabled={submitting}
              placeholder="Briefly describe the issue…"
              aria-describedby={privacyId}
              onChange={(event) => {
                setDetails(event.target.value);
                setReceipt(undefined);
              }}
            />
            <p id={privacyId} className="type-small text-ink-muted">
              Do not include your name, email, student ID, phone number,
              passwords, or other private information.
            </p>
          </div>

          {receipt ? (
            <Alert variant="success" role="status">
              <AlertDescription className="text-ink">
                {receipt.acknowledgement}
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert role="alert">
              <AlertDescription className="text-ink">{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="submit"
            variant="secondary"
            className="w-fit pointer-coarse:h-11"
            loading={submitting}
          >
            <Send aria-hidden="true" />
            Send report
          </Button>
        </form>
      </section>
    </details>
  );
}

function createIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `feedback:${crypto.randomUUID()}`
    : `feedback:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
