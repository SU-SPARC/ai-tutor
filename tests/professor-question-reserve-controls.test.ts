import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProfessorQuestionReserveControls } from "@/components/professor/professor-question-reserve-controls";
import { ProfessorQuestionLifecyclePanel } from "@/components/professor/professor-question-lifecycle-panel";
import type { QuestionLifecycleDto } from "@/lib/types";

describe("ProfessorQuestionReserveControls", () => {
  it("offers all reserve reasons on eligible approved content", () => {
    const html = renderToStaticMarkup(
      createElement(ProfessorQuestionReserveControls, {
        disabled: false,
        onMessage: vi.fn(),
        onUpdated: vi.fn(),
        question: question(),
      }),
    );

    for (const label of [
      "Repetitive",
      "Save for later",
      "Future topic",
      "Extra practice",
      "Other",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Keep this good, approved question");
    expect(html).toContain("Why?");
    expect(html).toContain("Only instructors see this.");
  });

  it("labels a reserve and offers an explicit removal action", () => {
    const html = renderToStaticMarkup(
      createElement(ProfessorQuestionReserveControls, {
        disabled: false,
        onMessage: vi.fn(),
        onUpdated: vi.fn(),
        question: question({
          reserve: {
            note: "Useful after the midterm.",
            practiceAllowed: true,
            reasonCode: "future_topic",
            reservedAt: "2026-09-06T12:00:00.000Z",
            reservedBy: {
              displayName: "Professor Test",
              occurredAt: "2026-09-06T12:00:00.000Z",
              userId: "user:professor",
            },
          },
        }),
      }),
    );

    expect(html).toContain("Saved for later");
    expect(html).toContain("Future topic");
    expect(html).toContain("Useful after the midterm.");
    expect(html).toContain("Take out of Saved for later");
    expect(html).toContain("Saved for later · extra practice");
    expect(html).toContain("Stop offering as extra practice");
    expect(html).toContain("never shown in the students&#x27; question list");
    expect(html).not.toMatch(/reserve|similar practice/i);
  });

  it("labels every Reserve ledger action in the professor timeline", () => {
    const version = question().workingVersion;
    const reserveQuestion = question({
      reserveEvents: [
        reserveEvent(1, "reserve"),
        reserveEvent(2, "allow_practice"),
        reserveEvent(3, "disallow_practice"),
        reserveEvent(4, "release"),
      ],
    });
    const html = renderToStaticMarkup(
      createElement(ProfessorQuestionLifecyclePanel, {
        focusQuestionId: reserveQuestion.questionId,
        hideBulkControls: true,
        initialDashboard: {
          inspections: [],
          mode: "database",
          questions: [reserveQuestion],
          readOnly: true,
          topics: [{ id: version.topicId, title: "Topic" }],
        },
      }),
    );

    expect(html).toContain("Saved for later");
    expect(html).toContain("Offered as extra practice");
    expect(html).toContain("No longer offered as extra practice");
    expect(html).toContain("Taken out of Saved for later");
  });
});

function reserveEvent(
  id: number,
  action: "allow_practice" | "disallow_practice" | "release" | "reserve",
) {
  return {
    action,
    actor: {
      displayName: "Professor Test",
      occurredAt: `2026-09-06T12:0${id}:00.000Z`,
      userId: "user:professor",
    },
    id,
    versionId: 1,
  } as const;
}

function question(
  overrides: Partial<QuestionLifecycleDto> = {},
): QuestionLifecycleDto {
  const version = {
    allowedActions: ["publish", "archive"],
    answer: {
      acceptedAnswers: ["1/2"],
      explanation: "Divide one by two.",
      numericValue: 0.5,
      tolerance: 0.001,
    },
    contentHash: "a".repeat(64),
    createdAt: "2026-09-06T11:00:00.000Z",
    createdBy: {
      displayName: "Professor Test",
      occurredAt: "2026-09-06T11:00:00.000Z",
      userId: "user:professor",
    },
    creationMethod: "manual",
    difficulty: "foundational",
    generationMetadata: {},
    hints: ["Count the outcomes."],
    id: "question:reserve",
    misconceptions: [],
    prompt: "What is one divided by two?",
    schemaVersion: 2,
    solutionSteps: ["Compute 1 / 2."],
    source: {
      originalityNote: "Original test question.",
      sourceType: "professor_provided",
      trustLevel: "public_original",
      visibility: "public",
    },
    state: "approved",
    title: "Reserve question",
    topicId: "topic",
    validationStatus: "valid",
    versionId: 1,
    versionNumber: 1,
  } as const;
  return {
    allowedActions: ["publish", "archive"],
    events: [],
    provenanceCorrectionAllowed: false,
    questionId: "question:reserve",
    recordState: "active",
    regenerationAllowed: false,
    reserveEvents: [],
    versions: [version],
    workingVersion: version,
    ...overrides,
  } as QuestionLifecycleDto;
}
