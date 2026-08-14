import { describe, expect, it } from "vitest";

import {
  addStoredImportErrors,
  buildQuestionContentExport,
  validateContentTransferDocument,
} from "@/lib/content-transfer/schema";
import type { QuestionLifecycleDto, QuestionVersionDto } from "@/lib/types";
import { validDocument, validQuestion } from "./content-transfer-test-helpers";

describe("question content-transfer schema", () => {
  it("validates a safe question aggregate and enables apply after duplicate storage checks", () => {
    const validation = validateContentTransferDocument(validDocument());

    expect(validation.document).toBeDefined();
    expect(validation.preview).toMatchObject({
      canApply: false,
      rootErrors: [],
      storageChecked: false,
      summary: { duplicates: 0, invalid: 0, ready: 1, total: 1 },
    });

    addStoredImportErrors(validation, emptyStorageInspection());
    expect(validation.preview).toMatchObject({
      canApply: true,
      storageChecked: true,
    });
  });

  it("reports duplicate and malformed rows without producing an import document", () => {
    const first = validQuestion();
    const validation = validateContentTransferDocument(
      validDocument({
        questions: [
          first,
          { ...first },
          {
            ...first,
            answer: { acceptedAnswers: [], explanation: "" },
            stableId: "invalid-answer-row",
          },
        ],
      }),
    );

    expect(validation.document).toBeUndefined();
    expect(validation.preview.summary).toEqual({
      duplicates: 2,
      invalid: 1,
      ready: 0,
      total: 3,
    });
    expect(validation.preview.rows[0].errors).toContain(
      "stableId is duplicated in this file.",
    );
    expect(validation.preview.rows[2].errors.join(" ")).toMatch(
      /acceptedAnswers|explanation/,
    );
  });

  it("detects misconception IDs reused across otherwise distinct rows", () => {
    const validation = validateContentTransferDocument(
      validDocument({
        questions: [
          validQuestion(),
          validQuestion({
            prompt:
              "Two of four outcomes are favorable. What is the probability?",
            stableId: "transfer-question-two",
            title: "Two favorable outcomes",
          }),
        ],
      }),
    );

    expect(validation.document).toBeUndefined();
    expect(validation.preview.summary).toEqual({
      duplicates: 2,
      invalid: 0,
      ready: 0,
      total: 2,
    });
    expect(validation.preview.rows[1].errors).toContain(
      "Misconception ID reversed-ratio is duplicated in this file.",
    );
  });

  it("rejects private source fields, student data, and copied-textbook wording", () => {
    const privateField = validDocument() as unknown as Record<string, unknown>;
    privateField.studentData = [{ userId: "student-1" }];
    const privateFieldValidation =
      validateContentTransferDocument(privateField);
    const copiedTextValidation = validateContentTransferDocument(
      validDocument({
        questions: [
          validQuestion({
            prompt: "Copied from textbook page 42: compute this probability.",
          }),
        ],
      }),
    );

    expect(privateFieldValidation.document).toBeUndefined();
    expect(privateFieldValidation.preview.rootErrors.join(" ")).toMatch(
      /private or student-data field/i,
    );
    expect(copiedTextValidation.document).toBeUndefined();
    expect(copiedTextValidation.preview.rows[0].errors).toContain(
      "Question row contains private-source or copied-textbook wording.",
    );
  });

  it("rejects non-ISO timestamps and non-importable publication states", () => {
    const document = validDocument({ exportedAt: "tomorrow" });
    (document.questions[0] as unknown as Record<string, unknown>).reviewState =
      "published";

    const validation = validateContentTransferDocument(document);

    expect(validation.document).toBeUndefined();
    expect(validation.preview.rootErrors).toContain(
      "exportedAt must be an ISO date-time string when present.",
    );
    expect(validation.preview.rows[0].errors.join(" ")).toMatch(
      /reviewState must be one of.*approved.*rejected/i,
    );
  });

  it("marks stable IDs that already exist in storage as row-level duplicates", () => {
    const validation = validateContentTransferDocument(validDocument());

    addStoredImportErrors(validation, {
      ...emptyStorageInspection(),
      existingQuestionIds: ["transfer-question-one"],
    });

    expect(validation.preview).toMatchObject({
      canApply: false,
      storageChecked: true,
      summary: { duplicates: 1, invalid: 0, ready: 0, total: 1 },
    });
    expect(validation.preview.rows[0]).toMatchObject({
      status: "duplicate",
      errors: ["A question with this stable ID already exists."],
    });
  });

  it("reports stored misconception collisions and unavailable topics by row", () => {
    const validation = validateContentTransferDocument(validDocument());

    addStoredImportErrors(validation, {
      existingContentFingerprints: [],
      existingMisconceptionIds: ["reversed-ratio"],
      existingQuestionIds: [],
      unavailableTopicIds: [validQuestion().topicId],
    });

    expect(validation.preview).toMatchObject({
      canApply: false,
      storageChecked: true,
      summary: { duplicates: 1, invalid: 0, ready: 0, total: 1 },
    });
    expect(validation.preview.rows[0].errors.join(" ")).toMatch(
      /Misconception IDs already exist.*mapped topic is unavailable/i,
    );
  });

  it("reports question content that already exists under another stable ID", () => {
    const validation = validateContentTransferDocument(validDocument());

    addStoredImportErrors(validation, {
      ...emptyStorageInspection(),
      existingContentFingerprints: [validQuestion().prompt.toLowerCase()],
    });

    expect(validation.preview.rows[0]).toMatchObject({
      errors: ["Question content matches an existing question."],
      status: "duplicate",
    });
  });

  it("exports only eligible aggregate fields and normalizes publication to approved", () => {
    const publicVersion = versionFixture({
      generationMetadata: {
        privatePrompt: "hidden generator prompt",
        studentId: "student-1",
      },
      state: "published",
    });
    const privateVersion = versionFixture({
      id: "private-question",
      source: {
        sourceType: "private_reference_pattern",
        trustLevel: "private_reference",
        visibility: "private",
      },
      state: "draft",
      versionId: 2,
    });
    const output = buildQuestionContentExport({
      exportedAt: "2026-01-01T00:00:00.000Z",
      questions: [
        lifecycleFixture(publicVersion, {
          actorNote: "reviewer@example.invalid",
        }),
        lifecycleFixture(privateVersion),
      ],
      scope: "all",
    });
    const serialized = JSON.stringify(output);

    expect(output.questions).toEqual([
      expect.objectContaining({
        reviewState: "approved",
        stableId: "transfer-question-one",
      }),
    ]);
    expect(serialized).not.toMatch(
      /privatePrompt|studentId|reviewer@example|generationMetadata|createdBy|events|source/,
    );
  });
});

function versionFixture(
  overrides: Partial<QuestionVersionDto> = {},
): QuestionVersionDto {
  const question = validQuestion();
  return {
    allowedActions: [],
    ...question,
    contentHash: "a".repeat(64),
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: {
      displayName: "Professor Name",
      occurredAt: "2026-01-01T00:00:00.000Z",
      userId: "user:professor",
    },
    creationMethod: "imported",
    generationMetadata: {},
    id: question.stableId,
    schemaVersion: 2,
    source: {
      sourceType: "professor_provided",
      trustLevel: "public_original",
      visibility: "public",
    },
    state: "draft",
    validationStatus: "valid",
    versionId: 1,
    versionNumber: 1,
    ...overrides,
  };
}

function lifecycleFixture(
  version: QuestionVersionDto,
  privateEvidence: { actorNote?: string } = {},
): QuestionLifecycleDto {
  return {
    allowedActions: [],
    events: privateEvidence.actorNote
      ? [
          {
            action: "publish",
            actor: {
              displayName: privateEvidence.actorNote,
              occurredAt: "2026-01-01T00:00:00.000Z",
              userId: "user:professor",
            },
            actorRole: "professor",
            id: 1,
            toState: "published",
            versionId: version.versionId,
          },
        ]
      : [],
    publishedVersion: version.state === "published" ? version : undefined,
    questionId: version.id,
    recordState: "active",
    regenerationAllowed: false,
    versions: [version],
    workingVersion: version,
  };
}

function emptyStorageInspection() {
  return {
    existingContentFingerprints: [],
    existingMisconceptionIds: [],
    existingQuestionIds: [],
    unavailableTopicIds: [],
  };
}
