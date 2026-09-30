export const PROFESSOR_REVIEW_REASONS = [
  { code: "duplicate_repetition", label: "Same as another question" },
  { code: "incorrect_answer", label: "Answer is wrong" },
  { code: "poor_wording", label: "Wording is unclear" },
  { code: "wrong_topic", label: "Belongs in a different topic" },
  { code: "wrong_difficulty", label: "Wrong difficulty" },
  { code: "weak_hints", label: "Hints need work" },
  { code: "weak_solution", label: "Solution needs work" },
  { code: "provenance_source_issue", label: "Problem with where it came from" },
  { code: "out_of_scope", label: "Not covered in my course" },
  { code: "other", label: "Something else (please explain)" },
] as const;

export type ProfessorReviewReasonCode =
  (typeof PROFESSOR_REVIEW_REASONS)[number]["code"];

export const PROFESSOR_LIFECYCLE_REASONS = [
  { code: "content_correction", label: "Fixing a mistake" },
  { code: "restore_previous_release", label: "Putting back an earlier version" },
  { code: "course_retired", label: "Course no longer runs" },
] as const;

const REASON_LABELS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    PROFESSOR_REVIEW_REASONS.map(({ code, label }) => [code, label]),
  ),
  clarify_wording: "Clarify wording",
  content_correction: "Fixing a mistake",
  course_retired: "Course no longer runs",
  imported_review_state: "Imported review state",
  incorrect_structure: "Incorrect structure",
  manual_revision_requested: "Manual revision requested",
  professor_rejected: "Professor rejected",
  regeneration_requested: "Regeneration requested",
  restore_previous_release: "Putting back an earlier version",
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
