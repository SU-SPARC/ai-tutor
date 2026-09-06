import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProfessorQuestionReserveControls } from "@/components/professor/professor-question-reserve-controls";
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
    expect(html).toContain("Remove reserve");
    expect(html).toContain("Students cannot see it");
  });
});

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
