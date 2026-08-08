import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProfessorQuestionBatchConfirmation } from "@/components/professor/professor-question-batch-confirmation";
import type { QuestionLifecycleDto, QuestionVersionDto } from "@/lib/types";

describe("professor question batch review UI", () => {
  it("shows an explicit selected-question and topic confirmation before publication", () => {
    const questions = [
      lifecycleFixture(1, "Basic probability", "basic-probability"),
      lifecycleFixture(2, "Conditional probability", "conditional-probability"),
    ];
    const markup = renderToStaticMarkup(
      createElement(ProfessorQuestionBatchConfirmation, {
        action: "publish",
        disabled: false,
        inspections: questions.map((question, index) => ({
          inspectedAt: `2026-08-08T12:0${index}:00.000Z`,
          professorDisplayName: "Lifecycle Professor",
          professorUserId: "user:lifecycle-professor",
          questionId: question.questionId,
          versionId: question.workingVersion.versionId,
        })),
        onCancel: vi.fn(),
        onCompleted: vi.fn(),
        questions,
        reasonCode: "verified_batch",
        revisionMethod: "manual",
        topics: [
          { id: "basic-probability", title: "Basic probability" },
          {
            id: "conditional-probability",
            title: "Conditional probability",
          },
        ],
      }),
    );

    expect(markup).toContain("Confirm batch publish");
    expect(markup).toContain("Batch question 1");
    expect(markup).toContain("Batch question 2");
    expect(markup).toContain("Basic probability: 1");
    expect(markup).toContain("Conditional probability: 1");
    expect(markup).toContain("one transaction, or to none of them");
    expect(markup).toContain(
      "Student visibility changes only after the complete transaction commits",
    );
    expect(markup.toLowerCase()).not.toContain("approve all");
    expect(markup.toLowerCase()).not.toContain("batch approve");
  });

  it("exposes inspection-gated batch actions without an approval action", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "src/components/professor/professor-question-lifecycle-panel.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("Mark this version inspected");
    expect(source).toContain("Select inspected version of");
    expect(source).toContain("Batch request revision");
    expect(source).toContain("Batch reject");
    expect(source).toContain("Review batch publication");
    expect(source).not.toContain("Batch approve");
    expect(source).not.toContain("Approve all");
  });
});

function lifecycleFixture(
  index: number,
  topicTitle: string,
  topicId: string,
): QuestionLifecycleDto {
  const version = versionFixture(index, topicTitle, topicId);
  return {
    allowedActions: ["publish", "request_revision", "reject"],
    events: [],
    questionId: version.id,
    recordState: "active",
    regenerationAllowed: true,
    versions: [version],
    workingVersion: version,
  };
}

function versionFixture(
  index: number,
  topicTitle: string,
  topicId: string,
): QuestionVersionDto {
  return {
    allowedActions: ["publish", "request_revision", "reject"],
    answer: {
      acceptedAnswers: ["0.25"],
      explanation: "Divide one favorable outcome by four outcomes.",
      numericValue: 0.25,
      tolerance: 0.001,
    },
    contentHash: String(index).repeat(64),
    createdAt: "2026-08-08T10:00:00.000Z",
    createdBy: {
      displayName: "Lifecycle Professor",
      occurredAt: "2026-08-08T10:00:00.000Z",
      userId: "user:lifecycle-professor",
    },
    creationMethod: "manual",
    difficulty: "foundational",
    generationMetadata: {},
    hints: ["Count favorable outcomes."],
    id: `batch-question-${index}`,
    misconceptions: [],
    prompt: `${topicTitle}: what is one divided by four?`,
    schemaVersion: 2,
    solutionSteps: ["Compute 1 / 4."],
    source: {
      sourceType: "generated_original",
      trustLevel: "generated_unverified",
      visibility: "public",
    },
    state: "approved",
    title: `Batch question ${index}`,
    topicId,
    validationStatus: "valid",
    versionId: 200 + index,
    versionNumber: 2,
  };
}
