import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import ProfessorStudentsPage from "@/app/professor/students/page";
import { deriveAttentionSignals } from "@/lib/data/instructor-student-repository";
import {
  getInstructorCohortAnalytics,
  getInstructorStudentDetail,
  listInstructorStudents,
} from "@/lib/data/data-store";
import {
  requireStudent,
  type AnalyticsAuthorization,
} from "@/lib/auth/authorization";
import {
  assignStudentLabels,
  formatAccuracy,
  isStudentKey,
  misconceptionLabel,
  studentLabel,
} from "@/lib/professor/student-pseudonym";
import type { InstructorStudentTopicPerformance } from "@/lib/types";

import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

function topic(
  overrides: Partial<InstructorStudentTopicPerformance>,
): InstructorStudentTopicPerformance {
  return {
    attempts: 0,
    correctAttempts: 0,
    hintsUsed: 0,
    incorrectAttempts: 0,
    misconceptionAttempts: 0,
    solutionsRevealed: 0,
    topicId: "conditional-probability",
    topicTitle: "Conditional Probability",
    ...overrides,
  };
}

describe("student pseudonyms", () => {
  it("labels a student by a short code rather than any stored identifier", () => {
    expect(studentLabel("8f2a1b3c".padEnd(64, "0"))).toBe("Student 8F2A");
  });

  it("lengthens both labels when two keys share a prefix", () => {
    const labels = assignStudentLabels([
      "8f2a1111".padEnd(64, "0"),
      "8f2a2222".padEnd(64, "0"),
      "aabb3333".padEnd(64, "0"),
    ]);

    expect(labels.get("8f2a1111".padEnd(64, "0"))).toBe("Student 8F2A1111");
    expect(labels.get("8f2a2222".padEnd(64, "0"))).toBe("Student 8F2A2222");
    expect(labels.get("aabb3333".padEnd(64, "0"))).toBe("Student AABB");
  });

  it("accepts only a hex digest as a student key", () => {
    expect(isStudentKey("a".repeat(64))).toBe(true);
    expect(isStudentKey("A".repeat(64))).toBe(false);
    expect(isStudentKey("a".repeat(63))).toBe(false);
    expect(isStudentKey("anon:11111111-1111-1111-1111-111111111111")).toBe(
      false,
    );
    expect(isStudentKey("' or 1=1 --")).toBe(false);
    expect(isStudentKey(undefined)).toBe(false);
  });

  it("reports accuracy only when there is something to divide", () => {
    expect(formatAccuracy(1, 4)).toBe("25%");
    expect(formatAccuracy(0, 0)).toBe("—");
  });

  it("humanizes a misconception code without inventing a description", () => {
    expect(
      misconceptionLabel("conditional-probability-denominator-mistake"),
    ).toBe("Conditional probability denominator mistake");
    expect(misconceptionLabel("unknown_code")).toBe("Unknown code");
  });
});

describe("attention signals", () => {
  it("flags a topic only after repeated attempts at low accuracy", () => {
    const belowThreshold = deriveAttentionSignals({
      misconceptions: [],
      topics: [topic({ attempts: 3, correctAttempts: 0 })],
    });
    const flagged = deriveAttentionSignals({
      misconceptions: [],
      topics: [topic({ attempts: 8, correctAttempts: 2 })],
    });

    expect(belowThreshold).toHaveLength(0);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({
      attempts: 8,
      code: "repeated_topic_difficulty",
      correctAttempts: 2,
      detail: "2 of 8 attempts correct",
      topicTitle: "Conditional Probability",
    });
  });

  it("does not flag a student who is answering correctly", () => {
    expect(
      deriveAttentionSignals({
        misconceptions: [],
        topics: [topic({ attempts: 10, correctAttempts: 9 })],
      }),
    ).toHaveLength(0);
  });

  it("flags a recurring misconception only once it repeats", () => {
    expect(
      deriveAttentionSignals({
        misconceptions: [{ label: "Denominator mistake", sessions: 2 }],
        topics: [],
      }),
    ).toHaveLength(0);
    expect(
      deriveAttentionSignals({
        misconceptions: [{ label: "Denominator mistake", sessions: 3 }],
        topics: [],
      }),
    ).toMatchObject([
      {
        code: "repeated_misconception",
        detail: "Denominator mistake recorded in 3 sessions",
      },
    ]);
  });

  it("flags reliance on revealed solutions", () => {
    expect(
      deriveAttentionSignals({
        misconceptions: [],
        topics: [
          topic({ attempts: 3, correctAttempts: 1, solutionsRevealed: 4 }),
        ],
      }),
    ).toMatchObject([{ code: "solution_reliance" }]);
  });
});

describe("instructor analytics authorization", () => {
  beforeEach(() => {
    vi.stubEnv("APP_DEMO_MODE", "true");
  });

  afterEach(() => {
    resetAuthMocks();
    vi.unstubAllEnvs();
  });

  it("refuses every instructor read for an authenticated student", async () => {
    mockPrincipal(TEST_STUDENT);
    const student =
      (await requireStudent()) as unknown as AnalyticsAuthorization;

    await expect(listInstructorStudents(student)).rejects.toThrow();
    await expect(
      getInstructorStudentDetail(student, "a".repeat(64)),
    ).rejects.toThrow();
    await expect(getInstructorCohortAnalytics(student)).rejects.toThrow();
  });

  it("redirects an anonymous visitor away from the student list", async () => {
    mockPrincipal(undefined);

    await expect(
      ProfessorStudentsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow();
  });

  it("redirects an authenticated student away from the student list", async () => {
    mockPrincipal(TEST_STUDENT);

    await expect(
      ProfessorStudentsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow();
  });

  it("shows a professor the demo-mode empty state rather than an error", async () => {
    mockPrincipal(TEST_PROFESSOR);

    const markup = renderToStaticMarkup(
      await ProfessorStudentsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toContain("Students");
    expect(markup).toContain("there is no class to list here");
    expect(markup).toContain('href="/professor/students"');
  });
});
