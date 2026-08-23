"use client";

import { useRef, useState, type FormEvent } from "react";
import { Flag, Loader2, Send } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { nativeSelectClassName } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  QUESTION_FEEDBACK_CATEGORIES,
  type QuestionFeedbackCategory,
  type QuestionFeedbackReceipt,
} from "@/lib/types";

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

  if (!sessionId) {
    return (
      <Button type="button" variant="ghost" size="sm" disabled>
        <Flag className="h-4 w-4" aria-hidden="true" />
        Report
      </Button>
    );
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
    <details className="group relative">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <Flag className="h-4 w-4" aria-hidden="true" />
        Report
      </summary>
      <div className="absolute top-10 right-0 z-30 w-[min(24rem,calc(100vw-3rem))] rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg">
        <div>
          <h2 className="font-semibold">Report a problem</h2>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {questionTitle}
          </p>
        </div>

        <form className="mt-4 space-y-4" onSubmit={submit}>
          <label className="block space-y-1.5 text-sm font-medium">
            What went wrong?
            <select
              className={nativeSelectClassName}
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
            </select>
          </label>

          <label className="block space-y-1.5 text-sm font-medium">
            Details (optional)
            <Textarea
              maxLength={1_000}
              rows={4}
              value={details}
              disabled={submitting}
              placeholder="Briefly describe the issue."
              onChange={(event) => {
                setDetails(event.target.value);
                setReceipt(undefined);
              }}
            />
          </label>
          <p className="text-xs leading-5 text-muted-foreground">
            Do not include your name, email, student ID, phone number,
            passwords, or other private information.
          </p>

          {receipt ? (
            <Alert variant="success" role="status">
              <AlertDescription>{receipt.acknowledgement}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" size="sm" disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            Send report
          </Button>
        </form>
      </div>
    </details>
  );
}

function createIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `feedback:${crypto.randomUUID()}`
    : `feedback:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
