"use client";

import { useState } from "react";
import { Bookmark, BookmarkX, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { nativeSelectClassName } from "@/components/ui/native-select";
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
  const canReserve =
    question.recordState === "active" &&
    !question.publishedVersion &&
    ["approved", "unpublished"].includes(question.workingVersion.state);

  if (!question.reserve && !canReserve) return null;

  async function update(action: "reserve" | "release") {
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
        action === "reserve"
          ? "Saved for later. This question remains approved and hidden from students."
          : "Removed from Save for later. It can now be published when ready.",
      );
    } catch {
      onMessage("Save for later could not be updated.");
    } finally {
      setActive(false);
    }
  }

  if (question.reserve) {
    return (
      <section className="mb-4 space-y-2 border border-border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Saved for later</Badge>
              <span className="text-sm font-medium">
                {questionReserveReasonLabel(question.reserve.reasonCode)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Reserved by {question.reserve.reservedBy.displayName} on{" "}
              {question.reserve.reservedAt}. Students cannot see it.
            </p>
            {question.reserve.note ? (
              <p className="mt-1 text-sm">{question.reserve.note}</p>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || active}
            onClick={() => void update("release")}
          >
            {active ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <BookmarkX className="h-4 w-4" />
            )}
            Remove reserve
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-4 space-y-3 border border-border bg-muted/20 p-3">
      <div>
        <h3 className="text-sm font-medium">Save for later</h3>
        <p className="text-xs text-muted-foreground">
          Keep this good, approved question in the professor catalog without
          publishing it to students.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-[14rem_minmax(0,1fr)_auto] md:items-end">
        <label className="space-y-1 text-xs text-muted-foreground">
          Reason
          <select
            className={nativeSelectClassName}
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
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Note {reasonCode === "other" ? "(required)" : "(optional)"}
          <Textarea
            className="min-h-10"
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <Button
          type="button"
          size="sm"
          disabled={disabled || active}
          onClick={() => void update("reserve")}
        >
          {active ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Bookmark className="h-4 w-4" />
          )}
          Save for later
        </Button>
      </div>
    </section>
  );
}
