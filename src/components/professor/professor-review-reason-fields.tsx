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
 * The reason and audit note that go with a reject, a revision request or an
 * archive. Two labelled fields; the caller decides the grid (pass
 * `className="contents"` to drop them into a wider row).
 */
export function ProfessorReviewReasonFields({
  className,
  disabled,
  includeLifecycleReasons = false,
  note,
  onNoteChange,
  onReasonCodeChange,
  reasonCode,
}: {
  className?: string;
  disabled?: boolean;
  includeLifecycleReasons?: boolean;
  note: string;
  onNoteChange: (note: string) => void;
  onReasonCodeChange: (reasonCode: string) => void;
  reasonCode: string;
}) {
  const noteRequired = professorReviewReasonRequiresNote(reasonCode);
  const reasons = includeLifecycleReasons
    ? [...PROFESSOR_REVIEW_REASONS, ...PROFESSOR_LIFECYCLE_REASONS]
    : PROFESSOR_REVIEW_REASONS;

  return (
    <div className={cn("grid gap-4 md:grid-cols-2", className)}>
      <Field label="Decision reason">
        <NativeSelect
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
        label={`Audit note ${noteRequired ? "(required for Other)" : "(optional)"}`}
      >
        <Textarea
          className="min-h-10"
          disabled={disabled}
          maxLength={1000}
          placeholder={
            noteRequired
              ? "Say why you made this decision…"
              : "Context for the version history…"
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
