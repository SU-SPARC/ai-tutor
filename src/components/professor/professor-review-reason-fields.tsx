"use client";

import { nativeSelectClassName } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  PROFESSOR_LIFECYCLE_REASONS,
  PROFESSOR_REVIEW_REASONS,
  professorReviewReasonRequiresNote,
} from "@/lib/tutor/professor-review-reasons";

export function ProfessorReviewReasonFields({
  disabled,
  includeLifecycleReasons = false,
  note,
  onNoteChange,
  onReasonCodeChange,
  reasonCode,
}: {
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
    <div className="grid gap-3 md:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Decision reason
        <select
          aria-label="Decision reason"
          className={nativeSelectClassName}
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
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Audit note {noteRequired ? "(required for Other)" : "(optional)"}
        <Textarea
          className="min-h-20"
          disabled={disabled}
          maxLength={1000}
          placeholder={
            noteRequired
              ? "Describe the reason for this decision"
              : "Add context for the lifecycle history"
          }
          required={noteRequired}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
        />
      </label>
    </div>
  );
}
