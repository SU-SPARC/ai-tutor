export const PROFESSOR_REVIEW_REASONS = [
  { code: "duplicate_repetition", label: "Duplicate / repetition" },
  { code: "incorrect_answer", label: "Incorrect answer" },
  { code: "poor_wording", label: "Poor wording" },
  { code: "wrong_topic", label: "Wrong topic" },
  { code: "wrong_difficulty", label: "Wrong difficulty" },
  { code: "weak_hints", label: "Weak hints" },
  { code: "weak_solution", label: "Weak solution" },
  { code: "provenance_source_issue", label: "Provenance / source issue" },
  { code: "out_of_scope", label: "Out of scope" },
  { code: "other", label: "Other" },
] as const;

export type ProfessorReviewReasonCode =
  (typeof PROFESSOR_REVIEW_REASONS)[number]["code"];

export const PROFESSOR_LIFECYCLE_REASONS = [
  { code: "content_correction", label: "Content correction" },
  { code: "restore_previous_release", label: "Restore previous release" },
  { code: "course_retired", label: "Course retired" },
] as const;

const REASON_LABELS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    PROFESSOR_REVIEW_REASONS.map(({ code, label }) => [code, label]),
  ),
  clarify_wording: "Clarify wording",
  content_correction: "Content correction",
  course_retired: "Course retired",
  imported_review_state: "Imported review state",
  incorrect_structure: "Incorrect structure",
  manual_revision_requested: "Manual revision requested",
  professor_rejected: "Professor rejected",
  regeneration_requested: "Regeneration requested",
  restore_previous_release: "Restore previous release",
  verified_batch: "Verified batch",
  working_version_superseded: "Working version superseded",
};

export function professorReviewReasonLabel(reasonCode: string) {
  return REASON_LABELS[reasonCode] ?? humanizeReasonCode(reasonCode);
}

export function professorReviewReasonRequiresNote(
  reasonCode: string | undefined,
) {
  return reasonCode === "other";
}

function humanizeReasonCode(reasonCode: string) {
  const words = reasonCode.trim().replaceAll("_", " ");
  return words ? words[0].toUpperCase() + words.slice(1) : "Unknown reason";
}
