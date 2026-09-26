"use client";

import { useId, useState } from "react";
import { Bookmark, BookmarkX, Shuffle } from "lucide-react";

import {
  ProfessorTime,
  SavedForLaterChip,
} from "@/components/professor/professor-question-labels";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusChip } from "@/components/ui/status-chip";
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

/**
 * "Save for later": keep an approved question out of the student catalog
 * without rejecting it, and optionally let the similar-practice flow reach
 * it. One quiet panel that shows the reserve when there is one and the form
 * when there is not.
 */
export function ProfessorQuestionReserveControls({
  disabled,
  onMessage,
  onUpdated,
  question,
}: {
  disabled: boolean;
  onMessage: (message: string) => void;
  onUpdated: (question: QuestionLifecycleDto) => void;
  question: QuestionLifecycleDto;
}) {
  const [active, setActive] = useState(false);
  const [note, setNote] = useState("");
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
      onMessage("Other requires an audit note.");
      return;
    }
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
        onMessage(payload.error ?? "Save for later could not be updated.");
        return;
      }
      onUpdated(payload.question);
      setNote("");
      onMessage(
        {
          allow_practice:
            "Allowed for optional similar-problem practice. It remains unpublished and absent from student listings.",
          disallow_practice:
            "Removed from optional similar-problem practice. It remains saved for later.",
          release:
            "Removed from Save for later. It can now be published when ready.",
          reserve:
            "Saved for later. This question remains approved and hidden from students.",
        }[action],
      );
    } catch {
      onMessage("Save for later could not be updated.");
    } finally {
      setActive(false);
    }
  }

  if (question.reserve) {
    return (
      <section
        aria-labelledby={headingId}
        className="flex flex-col gap-3 rounded-panel bg-sheet p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={headingId} className="type-h3 text-ink">
            Saved for later
          </h3>
          <SavedForLaterChip
            practiceAllowed={question.reserve.practiceAllowed}
          />
          <StatusChip
            icon={false}
            label={
              question.reserve.practiceAllowed
                ? "Eligible for similar practice"
                : "Reserve only"
            }
            tone={question.reserve.practiceAllowed ? "approved" : "neutral"}
          />
        </div>
        <p className="type-small max-w-prose text-ink">
          {questionReserveReasonLabel(question.reserve.reasonCode)}
          {question.reserve.note ? ` · ${question.reserve.note}` : ""}
        </p>
        <p className="type-small max-w-prose text-ink-muted">
          Reserved by {question.reserve.reservedBy.displayName} on{" "}
          <ProfessorTime value={question.reserve.reservedAt} />. It is never
          shown in student listings
          {question.reserve.practiceAllowed
            ? "; students may reach it only through the controlled optional-practice flow."
            : "."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
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
              ? "Disable similar practice"
              : "Allow as similar-problem practice"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || active}
            onClick={() => void update("release")}
          >
            <BookmarkX aria-hidden="true" />
            Remove reserve
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="@container flex flex-col gap-4 rounded-panel bg-sheet p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="type-h3 text-ink">
          Save for later
        </h3>
        <p className="type-small max-w-prose text-ink-muted">
          Keep this good, approved question in the professor catalog without
          publishing it to students.
        </p>
      </div>
      <div className="grid gap-4 @xl:grid-cols-[14rem_minmax(0,1fr)_auto] @xl:items-end">
        <Field label="Reason">
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
          label={`Note ${reasonCode === "other" ? "(required)" : "(optional)"}`}
        >
          <Textarea
            className="min-h-10"
            maxLength={1000}
            rows={1}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || active}
          loading={active}
          onClick={() => void update("reserve")}
        >
          <Bookmark aria-hidden="true" />
          Save for later
        </Button>
      </div>
    </section>
  );
}
