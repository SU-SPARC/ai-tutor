"use client";

import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  PROFESSOR_LIFECYCLE_REASONS,
  PROFESSOR_REVIEW_REASONS,
  professorReviewReasonRequiresNote,
} from "@/lib/tutor/professor-review-reasons";

/**
 * "Why?" and "Note (optional)" for a send-back, a rejection or a removal:
 * two labelled fields in one column. The caller decides the surrounding grid
 * (pass `className="contents"` to drop them into a wider row). The optional
 * `reasonError` / `noteError` lines say what to fix, next to the field.
 */
export function ProfessorReviewReasonFields({
  className,
  disabled,
  includeLifecycleReasons = false,
  note,
  noteError,
  onNoteChange,
  onReasonCodeChange,
  reasonCode,
  reasonError,
}: {
  className?: string;
  disabled?: boolean;
  includeLifecycleReasons?: boolean;
  note: string;
  /** Shown under the note, e.g. "Please add a short note when you choose Something else." */
  noteError?: string;
  onNoteChange: (note: string) => void;
  onReasonCodeChange: (reasonCode: string) => void;
  reasonCode: string;
  /** Shown under "Why?", e.g. "Choose why you're sending this back." */
  reasonError?: string;
}) {
  const noteRequired = professorReviewReasonRequiresNote(reasonCode);
  const reasons = includeLifecycleReasons
    ? [...PROFESSOR_REVIEW_REASONS, ...PROFESSOR_LIFECYCLE_REASONS]
    : PROFESSOR_REVIEW_REASONS;

  return (
    <div className={cn("grid max-w-prose gap-4", className)}>
      <Field label="Why?" error={reasonError}>
        <NativeSelect
          className="min-h-11"
          disabled={disabled}
          value={reasonCode}
          onChange={(event) => onReasonCodeChange(event.target.value)}
        >
          <option value="">Choose a reason</option>
          {reasons.map(({ code, label }) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        label={noteRequired ? "Note" : "Note (optional)"}
        description={
          noteRequired
            ? "Please explain in a few words. Only instructors see this."
            : "Only instructors see this."
        }
        error={noteError}
      >
        <Textarea
          className="min-h-11"
          disabled={disabled}
          maxLength={1000}
          placeholder={
            noteRequired
              ? "For example: the hints give the answer away."
              : "For example: the answer should be 1/4, not 1/3."
          }
          required={noteRequired}
          rows={2}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
        />
      </Field>
    </div>
  );
}
