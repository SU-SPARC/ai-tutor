import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  type BatchQuestionOutcome,
  ProfessorBatchPublicationCheck,
  ProfessorQuestionBatchConfirmation,
} from "@/components/professor/professor-question-batch-confirmation";
import { ProfessorQuestionLifecyclePanel } from "@/components/professor/professor-question-lifecycle-panel";
import type {
  QuestionLifecycleDto,
  QuestionLifecycleEventDto,
  QuestionVersionDto,
} from "@/lib/types";

const TOPICS = [
  { id: "basic-probability", title: "Basic probability" },
  { id: "conditional-probability", title: "Conditional probability" },
];

describe("professor question batch review UI", () => {
  it("names every selected question, explains the publication check, and keeps publish disabled until it passes", () => {
    const questions = [
      lifecycleFixture(1, "Basic probability", "basic-probability"),
      lifecycleFixture(2, "Conditional probability", "conditional-probability"),
    ];
    const markup = renderToStaticMarkup(
      createElement(ProfessorQuestionBatchConfirmation, {
        action: "publish",
        disabled: false,
        onCancel: vi.fn(),
        onCompleted: vi.fn(),
        questions,
        revisionMethod: "manual",
        topics: TOPICS,
      }),
    );

    expect(markup).toContain("Confirm batch publish");
    expect(markup).toContain(
      "Each selected question is checked against the publication requirements first.",
    );
    expect(markup).toContain(
      "all 2 questions are published together, or none of them are",
    );
    expect(markup).toContain("Batch question 1");
    expect(markup).toContain("Batch question 2");
    expect(markup).toContain("Basic probability: 1");
    expect(markup).toContain("Conditional probability: 1");
    expect(markup).toContain("Publication check");
    expect(markup).toContain("Not checked yet");
    expect(markup).toContain(
      "The publication check has not run for this selection yet.",
    );
    expect(markup).toContain("Check again");
    expect(markup).toContain('disabled="">Publish 2 questions');
    expect(markup.toLowerCase()).not.toContain("readiness");
    expect(markup.toLowerCase()).not.toContain("approve all");
    expect(markup.toLowerCase()).not.toContain("batch approve");
  });

  it("exposes review-gated batch actions without an approval action or readiness jargon", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "src/components/professor/professor-question-lifecycle-panel.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("Mark this version inspected");
    expect(source).toContain("Approved by you");
    expect(source).toContain("Not reviewed by you");
    expect(source).toContain("Select working version of");
    expect(source).toContain("Batch request revision");
    expect(source).toContain("Batch reject");
    expect(source).toContain("Publish selected");
    expect(source).toContain("Choose the Approved view for bulk publication");
    expect(source).toContain(
      "checked against the publication requirements before anything changes",
    );
    expect(source.toLowerCase()).not.toContain("readiness");
    expect(source).not.toContain("Review batch publication");
    expect(source).not.toContain("Batch approve");
    expect(source).not.toContain("Approve all");
  });

  it("confirms a batch with a friendly reason label and optional audit note", () => {
    const questions = [
      lifecycleFixture(1, "Basic probability", "basic-probability"),
      lifecycleFixture(2, "Basic probability", "basic-probability"),
    ];
    const markup = renderToStaticMarkup(
      createElement(ProfessorQuestionBatchConfirmation, {
        action: "request_revision",
        disabled: false,
        note: "These questions repeat examples already in the topic.",
        onCancel: vi.fn(),
        onCompleted: vi.fn(),
        questions,
        reasonCode: "duplicate_repetition",
        revisionMethod: "manual",
        topics: TOPICS,
      }),
    );

    expect(markup).toContain("Duplicate / repetition");
    expect(markup).toContain(
      "Audit note: These questions repeat examples already in the topic.",
    );
    expect(markup).toContain("Confirm request revision for 2 questions");
    expect(markup).not.toContain("duplicate_repetition");
    expect(markup).not.toContain("Publication check");
  });

  it("shows one plain-language outcome per question, including why a question is blocked and what to do", () => {
    const questions = [
      lifecycleFixture(1, "Basic probability", "basic-probability"),
      lifecycleFixture(2, "Conditional probability", "conditional-probability"),
      lifecycleFixture(3, "Conditional probability", "conditional-probability"),
    ];
    const outcomes = new Map<number, BatchQuestionOutcome>([
      [
        questions[0].workingVersion.versionId,
        {
          reviewEvidence: {
            kind: "approval",
            reviewedAt: "2026-09-18T18:47:00.000Z",
          },
          status: "ready",
        },
      ],
      [
        questions[1].workingVersion.versionId,
        {
          failure: {
            code: "not_inspected",
            expectedState: "approved",
            message:
              "You have not reviewed this exact version yourself (no approval or inspection by you). Open it in the question table and choose Mark this version inspected, or handle it on its own from its row.",
            questionId: questions[1].questionId,
            versionId: questions[1].workingVersion.versionId,
          },
          status: "blocked",
        },
      ],
      [
        questions[2].workingVersion.versionId,
        {
          failure: {
            code: "validation_failed",
            expectedState: "approved",
            message: "Publication blocked: pattern provenance.",
            publicationBlockers: [
              {
                code: "invalid_source_classification",
                message:
                  'A pattern-derived question requires a linked catalogued pattern ID. Use "Correct provenance" to append an unchanged generated_original version, then review and approve that new version.',
              },
            ],
            questionId: questions[2].questionId,
            versionId: questions[2].workingVersion.versionId,
          },
          status: "blocked",
        },
      ],
    ]);
    const markup = renderToStaticMarkup(
      createElement(ProfessorBatchPublicationCheck, {
        disabled: false,
        isChecking: false,
        onRemoveQuestion: vi.fn(),
        outcomes,
        questions,
        topics: TOPICS,
      }),
    );

    expect(markup).toContain("Publication check");
    expect(markup).toContain("1 Ready");
    expect(markup).toContain("2 Blocked");
    expect(markup).toContain(
      "1 of 3 questions can be published. 2 are blocked: fix or remove them, then publish.",
    );
    expect(markup).toContain("Ready to publish");
    expect(markup).toContain(
      "You approved this exact version on 2026-09-18. It passed every publication check.",
    );
    expect(markup).toContain("Cannot publish yet");
    expect(markup).toContain("not reviewed this exact version yourself");
    expect(markup).toContain("Mark this version inspected");
    expect(markup).toContain("Publication requirements not met:");
    expect(markup).toContain("requires a linked catalogued pattern ID");
    expect(markup).toContain(
      "A provenance correction or content revision creates a new version that must be approved before it can be published.",
    );
    expect(markup.match(/Remove from selection/g)).toHaveLength(2);
    expect(markup).toContain(
      "Students see a question only after the whole batch commits",
    );
    expect(markup.toLowerCase()).not.toContain("readiness");
  });

  it("reports the exact outcome of every question after a batch that changed nothing", () => {
    const questions = [
      lifecycleFixture(1, "Basic probability", "basic-probability"),
      lifecycleFixture(2, "Conditional probability", "conditional-probability"),
    ];
    const outcomes = new Map<number, BatchQuestionOutcome>([
      [questions[0].workingVersion.versionId, { status: "cancelled" }],
      [
        questions[1].workingVersion.versionId,
        {
          failure: {
            actualState: "published",
            code: "stale_state",
            expectedState: "approved",
            message: "This version is already published.",
            questionId: questions[1].questionId,
            versionId: questions[1].workingVersion.versionId,
          },
          status: "blocked",
        },
      ],
    ]);
    const markup = renderToStaticMarkup(
      createElement(ProfessorBatchPublicationCheck, {
        disabled: false,
        isChecking: false,
        onRemoveQuestion: vi.fn(),
        outcomes,
        questions,
        topics: TOPICS,
      }),
    );

    expect(markup).toContain(
      "Nothing was published. 1 of 2 questions did not pass the publication check, so the other 1 were left unchanged.",
    );
    expect(markup).toContain("Not changed");
    expect(markup).toContain(
      "the batch was cancelled because another selected question was blocked. Nothing changed.",
    );
    expect(markup).toContain("This version is already published.");
    expect(markup).toContain(
      "Remove it from the selection; nothing more is needed for it.",
    );
  });

  it("shows checking state while the publication check runs", () => {
    const questions = [
      lifecycleFixture(1, "Basic probability", "basic-probability"),
      lifecycleFixture(2, "Basic probability", "basic-probability"),
    ];
    const markup = renderToStaticMarkup(
      createElement(ProfessorBatchPublicationCheck, {
        disabled: true,
        isChecking: true,
        onRemoveQuestion: vi.fn(),
        outcomes: new Map(
          questions.map((question) => [
            question.workingVersion.versionId,
            { status: "checking" as const },
          ]),
        ),
        questions,
        topics: TOPICS,
      }),
    );

    expect(markup).toContain(
      "Checking 2 questions against the publication requirements",
    );
    expect(markup.match(/Checking…/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("tells the professor that their own approval already counts as review in the question table", () => {
    const approvedByMe = lifecycleFixture(
      1,
      "Conditional probability",
      "conditional-probability",
      "user:professor-xj",
    );
    const approvedByOther = lifecycleFixture(
      2,
      "Conditional probability",
      "conditional-probability",
      "user:other-professor",
    );
    const render = (question: QuestionLifecycleDto) =>
      renderToStaticMarkup(
        createElement(ProfessorQuestionLifecyclePanel, {
          focusQuestionId: question.questionId,
          hideBulkControls: true,
          initialDashboard: {
            inspections: [],
            mode: "database",
            professorUserId: "user:professor-xj",
            questions: [question],
            readOnly: false,
            topics: TOPICS,
          },
        }),
      );

    const ownMarkup = render(approvedByMe);
    expect(ownMarkup).toContain("Approved by you");
    expect(ownMarkup).toContain(
      "You approved this exact version on 2026-09-18.",
    );
    expect(ownMarkup).toContain("counts as your review");
    expect(ownMarkup).not.toContain("Mark this version inspected");
    expect(ownMarkup).not.toContain("Not reviewed by you");

    const otherMarkup = render(approvedByOther);
    expect(otherMarkup).toContain("Not reviewed by you");
    expect(otherMarkup).toContain("Mark this version inspected");
    expect(otherMarkup).not.toContain("Approved by you");
  });
});

function lifecycleFixture(
  index: number,
  topicTitle: string,
  topicId: string,
  approvedByUserId?: string,
): QuestionLifecycleDto {
  const version = versionFixture(index, topicTitle, topicId);
  const events: QuestionLifecycleEventDto[] = approvedByUserId
    ? [
        {
          action: "approve",
          actor: {
            displayName: "Approving Professor",
            occurredAt: "2026-09-18T18:47:00.000Z",
            userId: approvedByUserId,
          },
          actorRole: "professor",
          fromState: "needs_review",
          id: index,
          toState: "approved",
          versionId: version.versionId,
        },
      ]
    : [];
  return {
    allowedActions: ["publish", "request_revision", "reject"],
    events,
    provenanceCorrectionAllowed: false,
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
