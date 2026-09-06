import { describe, expect, it } from "vitest";

import {
  PROFESSOR_LIFECYCLE_REASONS,
  PROFESSOR_REVIEW_REASONS,
  professorReviewReasonLabel,
  professorReviewReasonRequiresNote,
} from "@/lib/tutor/professor-review-reasons";

describe("professor review reasons", () => {
  it("defines every stable dropdown reason and its professor-facing label", () => {
    expect(PROFESSOR_REVIEW_REASONS).toEqual([
      { code: "duplicate_repetition", label: "Duplicate / repetition" },
      { code: "incorrect_answer", label: "Incorrect answer" },
      { code: "poor_wording", label: "Poor wording" },
      { code: "wrong_topic", label: "Wrong topic" },
      { code: "wrong_difficulty", label: "Wrong difficulty" },
      { code: "weak_hints", label: "Weak hints" },
      { code: "weak_solution", label: "Weak solution" },
      {
        code: "provenance_source_issue",
        label: "Provenance / source issue",
      },
      { code: "out_of_scope", label: "Out of scope" },
      { code: "other", label: "Other" },
    ]);
    for (const { code, label } of PROFESSOR_REVIEW_REASONS) {
      expect(professorReviewReasonLabel(code)).toBe(label);
    }
  });

  it("requires a note only for Other", () => {
    expect(professorReviewReasonRequiresNote("other")).toBe(true);
    for (const { code } of PROFESSOR_REVIEW_REASONS) {
      if (code !== "other") {
        expect(professorReviewReasonRequiresNote(code)).toBe(false);
      }
    }
  });

  it("offers stable reasons for unpublish, rollback, and retirement actions", () => {
    expect(PROFESSOR_LIFECYCLE_REASONS).toEqual([
      { code: "content_correction", label: "Content correction" },
      {
        code: "restore_previous_release",
        label: "Restore previous release",
      },
      { code: "course_retired", label: "Course retired" },
    ]);
  });

  it.each([
    ["professor_rejected", "Professor rejected"],
    ["imported_review_state", "Imported review state"],
    ["manual_revision_requested", "Manual revision requested"],
    ["regeneration_requested", "Regeneration requested"],
    ["legacy_custom_reason", "Legacy custom reason"],
  ])("keeps legacy reason %s readable", (code, label) => {
    expect(professorReviewReasonLabel(code)).toBe(label);
  });
});
