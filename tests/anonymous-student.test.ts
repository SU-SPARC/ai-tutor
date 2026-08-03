import { describe, expect, it } from "vitest";

import {
  ANONYMOUS_STUDENT_STORAGE_KEY,
  anonymousTutorSessionStorageKey,
  isAnonymousStudentId,
} from "@/lib/auth/anonymous-student";

describe("legacy anonymous student identity", () => {
  it("recognizes only bounded legacy opaque identifiers", () => {
    expect(isAnonymousStudentId("anonymous-student-valid-123")).toBe(true);
    expect(isAnonymousStudentId("student@example.test")).toBe(false);
    expect(isAnonymousStudentId("Jane Student")).toBe(false);
    expect(isAnonymousStudentId("short")).toBe(false);
  });

  it("uses question-only local storage pointers, never an identity value", () => {
    const key = anonymousTutorSessionStorageKey("dice-sum-eight");

    expect(key).toContain("dice-sum-eight");
    expect(key).not.toContain("anonymous-student");
    expect(key).not.toBe(ANONYMOUS_STUDENT_STORAGE_KEY);
  });
});
