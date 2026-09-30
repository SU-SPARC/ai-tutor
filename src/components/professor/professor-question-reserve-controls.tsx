"use client";

import { useId, useState } from "react";
import { Bookmark, BookmarkX, Shuffle } from "lucide-react";

import {
  plainActionError,
  ProfessorTime,
  SavedForLaterChip,
} from "@/components/professor/professor-question-labels";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  QUESTION_RESERVE_REASONS,
  questionReserveReasonLabel,
  questionReserveReasonRequiresNote,
} from "@/lib/tutor/professor-question-reserve";
import type {
  QuestionLifecycleDto,
  QuestionReserveReasonCode,
} from "@/lib/types";

/** What happened, for the confirmation toast the caller shows. */
const DONE_MESSAGES = {
  allow_practice:
    "It can now be offered as extra practice. It stays out of the students' question list.",
  disallow_practice:
    "It is no longer offered as extra practice. It stays saved for later.",
  release:
    "Taken out of Saved for later. You can show it to students when you're ready.",
  reserve: "Saved for later. It stays approved, and students can't see it.",
} as const;

/**
 * "Save for later": keep an approved question out of the students' list
 * without rejecting it, and optionally offer it as extra practice. One quiet
 * panel that shows the saved state when there is one and the form when not.
 */
export function ProfessorQuestionReserveControls({
  disabled,
  onMessage,
  onUpdated,
  question,
}: {
  disabled: boolean;
  /** A plain sentence about what just happened (the caller toasts it). */
  onMessage: (message: string) => void;
  onUpdated: (question: QuestionLifecycleDto) => void;
  question: QuestionLifecycleDto;
}) {
  const [active, setActive] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [noteError, setNoteError] = useState<string>();
  const [reasonCode, setReasonCode] =
    useState<QuestionReserveReasonCode>("save_for_later");
  const headingId = useId();
  const canReserve =
    question.recordState === "active" &&
    !question.publishedVersion &&
    ["approved", "unpublished"].includes(question.workingVersion.state);

  if (!question.reserve && !canReserve) return null;

  async function update(
    action: "reserve" | "release" | "allow_practice" | "disallow_practice",
  ) {
    if (
      action === "reserve" &&
      questionReserveReasonRequiresNote(reasonCode) &&
      !note.trim()
    ) {
      setNoteError("Please add a short note when you choose Other.");
      return;
    }
    setNoteError(undefined);
    setError(undefined);
    setActive(true);
    try {
      const response = await fetch(
        `/api/professor/questions/${encodeURIComponent(question.questionId)}/reserve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            action,
            expectedWorkingVersionId: question.workingVersion.versionId,
            note: note.trim() || undefined,
            reasonCode: action === "reserve" ? reasonCode : undefined,
          }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        question?: QuestionLifecycleDto;
      };
      if (!response.ok || !payload.question) {
        setError(plainActionError(response.status));
        return;
      }
      onUpdated(payload.question);
      setNote("");
      onMessage(DONE_MESSAGES[action]);
    } catch {
      setError(plainActionError());
    } finally {
      setActive(false);
    }
  }

  const errorLine = (
    <div role="status" aria-live="polite">
      {error ? <p className="type-body text-red-700">{error}</p> : null}
    </div>
  );

  if (question.reserve) {
    return (
      <section
        id="saved-for-later"
        aria-labelledby={headingId}
        className="flex scroll-mt-24 flex-col gap-3 rounded-panel bg-sheet p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={headingId} className="type-h3 text-ink">
            Saved for later
          </h3>
          <SavedForLaterChip
            practiceAllowed={question.reserve.practiceAllowed}
          />
        </div>
        <p className="type-body max-w-prose text-ink">
          Why: {questionReserveReasonLabel(question.reserve.reasonCode)}
          {question.reserve.note ? ` · ${question.reserve.note}` : ""}
        </p>
        <p className="type-body max-w-prose text-ink">
          Saved by {question.reserve.reservedBy.displayName} on{" "}
          <ProfessorTime dateOnly value={question.reserve.reservedAt} />. It is
          never shown in the students&apos; question list
          {question.reserve.practiceAllowed
            ? ", but it can be offered as extra practice."
            : "."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={disabled || active}
            loading={active}
            onClick={() =>
              void update(
                question.reserve!.practiceAllowed
                  ? "disallow_practice"
                  : "allow_practice",
              )
            }
          >
            <Shuffle aria-hidden="true" />
            {question.reserve.practiceAllowed
              ? "Stop offering as extra practice"
              : "Offer as extra practice"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={disabled || active}
            onClick={() => void update("release")}
          >
            <BookmarkX aria-hidden="true" />
            Take out of Saved for later
          </Button>
        </div>
        {errorLine}
      </section>
    );
  }

  return (
    <section
      id="saved-for-later"
      aria-labelledby={headingId}
      className="@container flex scroll-mt-24 flex-col gap-4 rounded-panel bg-sheet p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="type-h3 text-ink">
          Save for later
        </h3>
        <p className="type-body max-w-prose text-ink">
          Keep this good, approved question out of the students&apos; list
          without rejecting it.
        </p>
      </div>
      <div className="grid gap-4 @xl:grid-cols-[14rem_minmax(0,1fr)_auto] @xl:items-end">
        <Field label="Why?">
          <NativeSelect
            value={reasonCode}
            onChange={(event) =>
              setReasonCode(event.target.value as QuestionReserveReasonCode)
            }
          >
            {QUESTION_RESERVE_REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label={reasonCode === "other" ? "Note (required)" : "Note (optional)"}
          description="Only instructors see this."
          error={noteError}
        >
          <Textarea
            className="min-h-11"
            maxLength={1000}
            rows={1}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Button
          type="button"
          variant="secondary"
          className="h-11"
          disabled={disabled || active}
          loading={active}
          onClick={() => void update("reserve")}
        >
          <Bookmark aria-hidden="true" />
          Save for later
        </Button>
      </div>
      {errorLine}
    </section>
  );
}
