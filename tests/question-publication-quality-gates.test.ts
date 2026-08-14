import { describe, expect, it } from "vitest";

import type {
  QuestionPublicationGateCode,
  QuestionVersionDto,
} from "@/lib/types";
import {
  evaluateQuestionPublicationQualityGates,
  QUESTION_PUBLICATION_GATE_CODES,
} from "@/lib/tutor/question-publication-quality-gates";

describe("question publication quality gates", () => {
  const blockingCases: Array<{
    code: QuestionPublicationGateCode;
    mutate: (input: GateInput) => void;
  }> = [
    {
      code: "invalid_syllabus_topic",
      mutate: (input) => {
        input.activeSyllabusTopic = false;
      },
    },
    {
      code: "missing_question_text",
      mutate: (input) => {
        input.version.prompt = "   ";
      },
    },
    {
      code: "missing_final_answer",
      mutate: (input) => {
        input.version.answer.acceptedAnswers = [];
      },
    },
    {
      code: "invalid_answer_schema",
      mutate: (input) => {
        input.version.answer = {
          acceptedAnswers: ["0.7"],
          explanation: "Divide favorable outcomes by total outcomes.",
          numericValue: 0.5,
          tolerance: 0.001,
        };
      },
    },
    {
      code: "missing_solution_steps",
      mutate: (input) => {
        input.version.solutionSteps = [];
      },
    },
    {
      code: "missing_required_hint",
      mutate: (input) => {
        input.version.hints = ["0.5"];
      },
    },
    {
      code: "forbidden_private_source_metadata",
      mutate: (input) => {
        input.rawMetadata = { sourcePage: 42 };
      },
    },
    {
      code: "invalid_source_classification",
      mutate: (input) => {
        input.version.source = {
          originalityNote: "Original public-safe question.",
          sourceType: "private_reference_pattern",
          trustLevel: "private_reference",
          visibility: "private",
        };
      },
    },
    {
      code: "duplicate_question_id",
      mutate: (input) => {
        input.duplicateQuestionId = true;
      },
    },
    {
      code: "invalid_review_state",
      mutate: (input) => {
        input.version.state = "needs_review";
      },
    },
    {
      code: "deterministic_validation_failed",
      mutate: (input) => {
        input.deterministicValidationPasses = false;
      },
    },
    {
      code: "professor_approval_missing",
      mutate: (input) => {
        input.professorApprovalExists = false;
      },
    },
  ];

  it("has a blocking test case for every configured publication gate", () => {
    expect(blockingCases.map(({ code }) => code)).toEqual(
      QUESTION_PUBLICATION_GATE_CODES,
    );
  });

  it.each(blockingCases)("blocks $code", ({ code, mutate }) => {
    const input = validGateInput();
    mutate(input);

    const blockers = evaluateQuestionPublicationQualityGates(input);

    expect(blockers).toContainEqual({ code, message: expect.any(String) });
    expect(
      blockers.find((blocker) => blocker.code === code)?.message.trim(),
    ).not.toBe("");
  });

  it("passes a fully approved, deterministic, public-safe version", () => {
    expect(evaluateQuestionPublicationQualityGates(validGateInput())).toEqual(
      [],
    );
  });

  it("does not require a hint when the publishing context explicitly exempts it", () => {
    const input = validGateInput();
    input.hintsRequired = false;
    input.version.hints = [];

    expect(evaluateQuestionPublicationQualityGates(input)).toEqual([]);
  });

  it("returns every applicable reason in stable gate order", () => {
    const input = validGateInput();
    input.activeSyllabusTopic = false;
    input.version.prompt = "";
    input.professorApprovalExists = false;

    expect(
      evaluateQuestionPublicationQualityGates(input).map(
        (blocker) => blocker.code,
      ),
    ).toEqual([
      "invalid_syllabus_topic",
      "missing_question_text",
      "deterministic_validation_failed",
      "professor_approval_missing",
    ]);
  });
});

type GateInput = Parameters<typeof evaluateQuestionPublicationQualityGates>[0];

function validGateInput(): GateInput {
  return {
    activeSyllabusTopic: true,
    deterministicValidationPasses: true,
    duplicateQuestionId: false,
    hintsRequired: true,
    professorApprovalExists: true,
    questionId: "quality-gate-question",
    rawMetadata: { generator: "deterministic-v1", seed: 42 },
    snapshotQuestionId: "quality-gate-question",
    version: validVersion(),
  };
}

function validVersion(): QuestionVersionDto {
  return {
    allowedActions: ["publish"],
    answer: {
      acceptedAnswers: ["0.5", "1/2"],
      explanation: "Divide one favorable outcome by two total outcomes.",
      numericValue: 0.5,
      tolerance: 0.001,
    },
    contentHash: "a".repeat(64),
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: {
      displayName: "Test Professor",
      occurredAt: "2026-01-01T00:00:00.000Z",
      userId: "user:test-professor",
    },
    creationMethod: "manual",
    difficulty: "foundational",
    generationMetadata: {},
    hints: ["First count the favorable outcomes."],
    id: "quality-gate-question",
    misconceptions: [
      {
        feedback: "Use favorable outcomes divided by total outcomes.",
        id: "reversed-ratio",
        matchTerms: ["2"],
      },
    ],
    prompt:
      "One of two equally likely outcomes is favorable. What is the probability?",
    schemaVersion: 2,
    solutionSteps: ["Compute 1 / 2 = 0.5."],
    source: {
      originalityNote: "Original public-safe question authored for the course.",
      sourceType: "professor_provided",
      trustLevel: "public_original",
      visibility: "public",
    },
    state: "approved",
    title: "One favorable outcome",
    topicId: "conditional-probability",
    validationStatus: "valid",
    versionId: 101,
    versionNumber: 1,
  };
}
