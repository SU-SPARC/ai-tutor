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
      { code: "duplicate_repetition", label: "Same as another question" },
      { code: "incorrect_answer", label: "Answer is wrong" },
      { code: "poor_wording", label: "Wording is unclear" },
      { code: "wrong_topic", label: "Belongs in a different topic" },
      { code: "wrong_difficulty", label: "Wrong difficulty" },
      { code: "weak_hints", label: "Hints need work" },
      { code: "weak_solution", label: "Solution needs work" },
      {
        code: "provenance_source_issue",
        label: "Problem with where it came from",
      },
      { code: "out_of_scope", label: "Not covered in my course" },
      { code: "other", label: "Something else (please explain)" },
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
      { code: "content_correction", label: "Fixing a mistake" },
      {
        code: "restore_previous_release",
        label: "Putting back an earlier version",
      },
      { code: "course_retired", label: "Course no longer runs" },
    ]);
  });

  it("labels lifecycle reasons the same way in history", () => {
    for (const { code, label } of PROFESSOR_LIFECYCLE_REASONS) {
      expect(professorReviewReasonLabel(code)).toBe(label);
    }
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
