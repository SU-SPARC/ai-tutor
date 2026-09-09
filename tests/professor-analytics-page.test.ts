import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProfessorAnalyticsError from "@/app/professor/analytics/error";
import ProfessorAnalyticsLoading from "@/app/professor/analytics/loading";
import ProfessorAnalyticsPage from "@/app/professor/analytics/page";
import { InstructorCohortPanel } from "@/components/professor/instructor-cohort-panel";
import { InstructorPracticePerformance } from "@/components/professor/instructor-practice-performance";
import type {
  InstructorCohortAnalytics,
  ProfessorPracticeAnalytics,
} from "@/lib/types";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

describe("professor analytics page", () => {
  beforeEach(() => {
    vi.stubEnv("APP_DEMO_MODE", "true");
  });

  afterEach(() => {
    resetAuthMocks();
    vi.unstubAllEnvs();
  });

  it("server-renders one cohort, topic, and question analytics experience", async () => {
    mockPrincipal(TEST_PROFESSOR);

    const markup = renderToStaticMarkup(await ProfessorAnalyticsPage());

    expect(markup).toContain("Class practice");
    expect(markup).toContain("Topic performance");
    expect(markup).toContain("Question performance");
    expect(markup).toContain("Answer attempts");
    expect(markup).not.toContain("Load analytics");
    expect(markup).not.toContain("Generated question review");
    expect(markup).not.toContain("Generated approved");
  });

  it("keeps the analytics page professor-only", async () => {
    mockPrincipal(undefined);
    await expect(ProfessorAnalyticsPage()).rejects.toThrow();

    mockPrincipal(TEST_STUDENT);
    await expect(ProfessorAnalyticsPage()).rejects.toThrow();
  });

  it("orders questions by evidence and renders em dashes for zero attempts", () => {
    const markup = renderToStaticMarkup(
      createElement(InstructorPracticePerformance, {
        practice: practiceAnalytics(),
      }),
    );
    const lowAccuracyIndex = markup.indexOf("Established low accuracy");
    const higherAccuracyIndex = markup.indexOf("Established higher accuracy");
    const lowVolumeIndex = markup.indexOf("Low-volume question");
    const zeroAttemptIndex = markup.indexOf("Zero-attempt question");

    expect(lowAccuracyIndex).toBeGreaterThan(-1);
    expect(higherAccuracyIndex).toBeGreaterThan(lowAccuracyIndex);
    expect(lowVolumeIndex).toBeGreaterThan(higherAccuracyIndex);
    expect(zeroAttemptIndex).toBeGreaterThan(lowVolumeIndex);
    expect(markup.match(/>—<\/td>/g)).toHaveLength(2);
  });

  it("shows excluded professor sessions only when there are any", () => {
    const visible = renderToStaticMarkup(
      createElement(InstructorCohortPanel, {
        cohort: cohortAnalytics({ excludedStaffSessions: 1 }),
      }),
    );
    const hidden = renderToStaticMarkup(
      createElement(InstructorCohortPanel, {
        cohort: cohortAnalytics({ excludedStaffSessions: 0 }),
      }),
    );

    expect(visible).toContain(
      "1 session by a professor account is excluded.",
    );
    expect(hidden).not.toContain("professor account");
  });

  it("uses safe loading and error states without exposing an error message", () => {
    const loadingMarkup = renderToStaticMarkup(
      createElement(ProfessorAnalyticsLoading),
    );
    const errorMarkup = renderToStaticMarkup(
      createElement(ProfessorAnalyticsError, {
        error: new Error("select secret from production_database"),
        reset: vi.fn(),
      }),
    );

    expect(loadingMarkup).toContain("Loading published-practice performance");
    expect(loadingMarkup).toContain('aria-busy="true"');
    expect(errorMarkup).toContain("Course analytics could not be loaded");
    expect(errorMarkup).toContain("temporarily unavailable");
    expect(errorMarkup).not.toMatch(/select secret|production_database/i);
  });
});

function cohortAnalytics(
  overrides: Partial<InstructorCohortAnalytics> = {},
): InstructorCohortAnalytics {
  return {
    activeStudents: 3,
    attempts: 15,
    blockedAttempts: 1,
    correctAttempts: 5,
    excludedStaffSessions: 0,
    extraPracticeSessions: 1,
    hintsUsed: 4,
    llmAttempts: 1,
    misconceptions: [],
    mode: "database",
    retrievalAttempts: 1,
    ruleAttempts: 14,
    sessions: 7,
    solutionsRevealed: 2,
    studentsNeedingAttention: 1,
    ...overrides,
  };
}

function practiceAnalytics(): ProfessorPracticeAnalytics {
  return {
    generatedQuestionOutcomes: {
      approved: 0,
      needs_edit: 0,
      needs_regeneration: 0,
      needs_review: 0,
      rejected: 0,
    },
    mode: "database",
    questions: [
      {
        attempts: 0,
        correctAttempts: 0,
        hintsUsed: 0,
        incorrectAttempts: 0,
        llmAttempts: 0,
        questionId: "zero-attempt",
        questionTitle: "Zero-attempt question",
        stepsRevealed: 0,
        topicId: "zero-topic",
        topicTitle: "Zero-attempt topic",
      },
      {
        attempts: 3,
        correctAttempts: 0,
        hintsUsed: 1,
        incorrectAttempts: 3,
        llmAttempts: 0,
        questionId: "low-volume",
        questionTitle: "Low-volume question",
        stepsRevealed: 0,
        topicId: "conditional-probability",
        topicTitle: "Conditional Probability",
      },
      {
        attempts: 5,
        correctAttempts: 3,
        hintsUsed: 2,
        incorrectAttempts: 1,
        llmAttempts: 1,
        questionId: "established-higher",
        questionTitle: "Established higher accuracy",
        stepsRevealed: 1,
        topicId: "conditional-probability",
        topicTitle: "Conditional Probability",
      },
      {
        attempts: 4,
        correctAttempts: 1,
        hintsUsed: 2,
        incorrectAttempts: 3,
        llmAttempts: 0,
        questionId: "established-low",
        questionTitle: "Established low accuracy",
        stepsRevealed: 2,
        topicId: "conditional-probability",
        topicTitle: "Conditional Probability",
      },
    ],
    summary: {
      totalAttempts: 12,
      totalHintsUsed: 5,
      totalStepsRevealed: 3,
      totalTutorSessions: 4,
    },
    topics: [
      {
        attempts: 0,
        correctAttempts: 0,
        hintsUsed: 0,
        llmAttempts: 0,
        stepsRevealed: 0,
        topicId: "zero-topic",
        topicTitle: "Zero-attempt topic",
      },
      {
        attempts: 12,
        correctAttempts: 4,
        hintsUsed: 5,
        llmAttempts: 1,
        stepsRevealed: 3,
        topicId: "conditional-probability",
        topicTitle: "Conditional Probability",
      },
    ],
  };
}
