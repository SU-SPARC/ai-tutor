import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  canEditQuestionVersion,
  ProfessorQuestionRevisionEditor,
  revisionActionLabel,
} from "@/components/professor/professor-question-revision-editor";
import {
  ProfessorQuestionActionConfirmation,
  ProfessorQuestionLifecyclePanel,
  ProfessorQuestionVersionHistory,
} from "@/components/professor/professor-question-lifecycle-panel";
import {
  PROFESSOR_LIFECYCLE_REASONS,
  PROFESSOR_REVIEW_REASONS,
  professorReviewReasonLabel,
} from "@/lib/tutor/professor-review-reasons";
import { changedQuestionVersionFields } from "@/lib/tutor/question-version-diff";
import type { QuestionLifecycleDto, QuestionVersionDto } from "@/lib/types";

describe("professor question revision panel", () => {
  it("renders every editable public-safe field and explains immutable draft behavior", () => {
    const question = lifecycleFixture();
    const markup = renderToStaticMarkup(
      createElement(ProfessorQuestionRevisionEditor, {
        disabled: false,
        onCancel: vi.fn(),
        onSaved: vi.fn(),
        question,
        topics: [
          { id: "basic-probability", title: "Basic probability" },
          { id: "conditional-probability", title: "Conditional probability" },
        ],
      }),
    );

    for (const label of [
      "Question text",
      "Difficulty",
      "Correct answer",
      "Answer explanation",
      "Solution steps",
      "Hints",
      "Notes on common mistakes",
      "Topic",
      "Note about this change",
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("Edit “Generated probability draft”");
    expect(markup).toContain("Save changes");
    expect(markup).not.toContain("Save revision draft");
    expect(markup).toContain(
      "Students can&#x27;t see this question yet. Your earlier wording is kept in its history.",
    );
    // No second copy of the answer fields next to the answer-checking editor.
    expect(markup).not.toContain("Accepted final answers");
    expect(markup).not.toContain("private-pattern-secret");
  });

  it("offers immutable revision editing for every active public-safe working version", () => {
    const question = lifecycleFixture();
    expect(canEditQuestionVersion(question)).toBe(true);
    expect(
      canEditQuestionVersion({
        ...question,
        workingVersion: {
          ...question.workingVersion,
          state: "published",
          source: {
            ...question.workingVersion.source,
            sourceType: "professor_provided",
            trustLevel: "professor_approved",
          },
        },
      }),
    ).toBe(true);
    expect(
      revisionActionLabel({
        ...question,
        workingVersion: {
          ...question.workingVersion,
          state: "published",
        },
      }),
    ).toBe("Edit question");
    expect(revisionActionLabel(question)).toBe("Edit question");
    expect(
      canEditQuestionVersion({
        ...question,
        recordState: "archived",
      }),
    ).toBe(false);
    expect(
      canEditQuestionVersion({
        ...question,
        workingVersion: {
          ...question.workingVersion,
          source: {
            ...question.workingVersion.source,
            sourceType: "private_reference_pattern",
            trustLevel: "private_reference",
            visibility: "private",
          },
        },
      }),
    ).toBe(false);
  });

  it("builds a clear change summary and requires publication confirmation", () => {
    const base = versionFixture();
    expect(
      changedQuestionVersionFields(base, {
        ...base,
        difficulty: "intermediate",
        hints: ["Use the sample space."],
        prompt: "Two of four outcomes are favorable. Find the probability.",
      }),
    ).toEqual(["Wording", "Difficulty", "Hints"]);

    const lifecycleSource = readFileSync(
      path.join(
        process.cwd(),
        "src/components/professor/professor-question-lifecycle-panel.tsx",
      ),
      "utf8",
    );
    expect(lifecycleSource).toContain("Show to students");
    expect(lifecycleSource).toContain("Show this to students?");
    expect(lifecycleSource).toContain("What students see now");
    expect(lifecycleSource).toContain("What they will see");
    expect(lifecycleSource).toContain("Show my changes to students");
    expect(lifecycleSource).toContain(
      "Your changes are saved. Students still see the old wording.",
    );
    expect(lifecycleSource).toContain("changedQuestionVersionFields");
  });

  it("sends editable revision content without client-controlled provenance", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "src/components/professor/professor-question-revision-editor.tsx",
      ),
      "utf8",
    );
    const requestBody = source.slice(
      source.indexOf("body: JSON.stringify"),
      source.indexOf("}),", source.indexOf("body: JSON.stringify")) + 3,
    );

    expect(requestBody).toContain("comment");
    expect(requestBody).toContain("revision");
    expect(requestBody).not.toMatch(
      /sourceType|trustLevel|visibility|patternIds|originalityNote|private/i,
    );
  });

  it("offers a server-derived correction only for eligible unlinked pattern provenance", () => {
    const base = lifecycleFixture();
    const workingVersion: QuestionVersionDto = {
      ...base.workingVersion,
      source: {
        ...base.workingVersion.source,
        patternIds: undefined,
        sourceType: "pattern_derived_original",
      },
    };
    const question: QuestionLifecycleDto = {
      ...base,
      provenanceCorrectionAllowed: true,
      versions: [workingVersion],
      workingVersion,
    };
    const dashboard = {
      inspections: [],
      mode: "database" as const,
      questions: [question],
      readOnly: false,
      topics: [{ id: "basic-probability", title: "Basic probability" }],
    };
    const markup = renderToStaticMarkup(
      createElement(ProfessorQuestionLifecyclePanel, {
        hideBulkControls: true,
        initialDashboard: dashboard,
      }),
    );
    const bankMarkup = renderToStaticMarkup(
      createElement(ProfessorQuestionLifecyclePanel, {
        initialDashboard: dashboard,
      }),
    );
    const source = readFileSync(
      path.join(
        process.cwd(),
        "src/components/professor/professor-question-lifecycle-panel.tsx",
      ),
      "utf8",
    );
    const correctionBodyStart = source.indexOf(
      'correction: "unlinked_pattern_provenance"',
    );
    const correctionBody = source.slice(
      source.lastIndexOf("body: JSON.stringify", correctionBodyStart),
      source.indexOf("}),", correctionBodyStart) + 3,
    );

    expect(markup).toContain("Fix source record");
    expect(bankMarkup).toContain(
      "The source record needs fixing before students can see it.",
    );
    expect(correctionBody).toContain("baseVersionId");
    expect(correctionBody).toContain("expectedWorkingVersionId");
    expect(correctionBody).not.toMatch(
      /sourceType|trustLevel|visibility|patternIds|originalityNote/i,
    );
  });

  it("asks for the reason inside each action's dialog, never in a standing panel", () => {
    const bankMarkup = renderToStaticMarkup(
      createElement(ProfessorQuestionLifecyclePanel, {
        initialDashboard: {
          inspections: [],
          mode: "database",
          questions: [lifecycleFixture()],
          readOnly: false,
          topics: [{ id: "basic-probability", title: "Basic probability" }],
        },
      }),
    );
    expect(bankMarkup).not.toContain("Reason for your next decision");
    expect(bankMarkup).not.toContain("Why?");
    expect(bankMarkup).not.toContain("Revision method");

    const question = lifecycleFixture();
    const markup = renderToStaticMarkup(
      createElement(ProfessorQuestionActionConfirmation, {
        active: false,
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
        pending: {
          action: "reject",
          expectedState: question.workingVersion.state,
          kind: "transition",
          question,
          versionId: question.workingVersion.versionId,
        },
      }),
    );

    expect(markup).toContain("Reject this question?");
    expect(markup).toContain("Reject question");
    expect(markup).toContain("Why?");
    expect(markup).toContain("Note (optional)");
    expect(markup).toContain("Only instructors see this.");
    expect(markup).toMatch(/<option value="duplicate_repetition" selected="">/);
    expect(markup).not.toContain("Reason code for revision");
    for (const { code, label } of PROFESSOR_REVIEW_REASONS) {
      expect(markup).toContain(`value="${code}"`);
      expect(markup).toContain(label);
    }
    for (const { code, label } of PROFESSOR_LIFECYCLE_REASONS) {
      expect(markup).toContain(`value="${code}"`);
      expect(markup).toContain(label);
    }
  });

  it("shows professors immutable content, lineage, actors, timestamps, and lifecycle comments", () => {
    const original = {
      ...versionFixture(),
      state: "published" as const,
      versionId: 11,
      versionNumber: 1,
    };
    const revision = {
      ...versionFixture(),
      contentHash: "b".repeat(64),
      createdAt: "2026-08-09T14:30:00.000Z",
      createdBy: {
        displayName: "Lifecycle Professor",
        occurredAt: "2026-08-09T14:30:00.000Z",
        userId: "user:lifecycle-professor",
      },
      creationMethod: "manual" as const,
      parentVersionId: original.versionId,
      prompt: "Two of four outcomes are favorable. Find the probability.",
      state: "draft" as const,
      title: "Professor revision",
      versionId: 12,
      versionNumber: 2,
    };
    const question: QuestionLifecycleDto = {
      ...lifecycleFixture(),
      events: [
        {
          action: "approve",
          actor: revision.createdBy,
          actorRole: "professor",
          fromState: "needs_review",
          id: 5,
          metadata: {
            previousDifficulty: "foundational",
            reviewDifficultyBaseVersionId: original.versionId,
            selectedDifficulty: "intermediate",
          },
          toState: "approved",
          versionId: revision.versionId,
        },
        {
          action: "reject",
          actor: revision.createdBy,
          actorRole: "professor",
          fromState: "needs_review",
          id: 4,
          reasonCode: "professor_rejected",
          toState: "rejected",
          versionId: revision.versionId,
        },
        {
          action: "migrate",
          actor: original.createdBy,
          actorRole: "system",
          id: 3,
          reasonCode: "imported_review_state",
          toState: "published",
          versionId: original.versionId,
        },
        {
          action: "create_version",
          actor: revision.createdBy,
          actorRole: "professor",
          id: 2,
          note: "Clarify the ambiguous wording.",
          reasonCode: "working_version_superseded",
          toState: "draft",
          versionId: revision.versionId,
        },
        {
          action: "publish",
          actor: original.createdBy,
          actorRole: "system",
          id: 1,
          toState: "published",
          versionId: original.versionId,
        },
      ],
      publishedVersion: original,
      versions: [revision, original],
      workingVersion: revision,
    };
    const markup = renderToStaticMarkup(
      createElement(ProfessorQuestionVersionHistory, {
        dashboardReadOnly: false,
        onTransition: vi.fn(),
        question,
        topics: [{ id: "basic-probability", title: "Basic probability" }],
      }),
    );

    expect(markup).toContain("All changes");
    expect(markup).toContain("First version, written by AI");
    expect(markup).toContain("Edited from version 1");
    expect(markup).toContain("Latest version");
    expect(markup).toContain("Students see this version");
    expect(markup).toContain("See this version");
    expect(markup).toContain("Technical details");
    expect(markup).toContain("changed: title, wording");
    expect(markup).not.toContain("Inspect immutable content");
    expect(markup).not.toContain("(system)");
    expect(markup).toContain("Two of four outcomes are favorable");
    expect(markup).toContain("Lifecycle Professor");
    expect(markup).toContain("2026-08-09T14:30:00.000Z");
    expect(markup).toContain("Clarify the ambiguous wording.");
    expect(markup).toContain(
      professorReviewReasonLabel("working_version_superseded"),
    );
    expect(markup).toContain(professorReviewReasonLabel("professor_rejected"));
    expect(markup).toContain(
      professorReviewReasonLabel("imported_review_state"),
    );
    expect(markup).toContain("Difficulty: Foundational → Intermediate");
    expect(markup).not.toContain("professor_rejected");
    expect(markup).not.toContain("imported_review_state");
    expect(markup).not.toContain("private-pattern-secret");
  });
});

function lifecycleFixture(): QuestionLifecycleDto {
  const version = versionFixture();
  return {
    allowedActions: ["approve", "request_revision", "reject"],
    events: [],
    provenanceCorrectionAllowed: false,
    questionId: version.id,
    recordState: "active",
    regenerationAllowed: true,
    versions: [version],
    workingVersion: version,
  };
}

function versionFixture(): QuestionVersionDto {
  return {
    allowedActions: ["approve", "request_revision", "reject"],
    answer: {
      acceptedAnswers: ["0.25", "1/4"],
      explanation: "Divide one favorable outcome by four outcomes.",
      numericValue: 0.25,
      tolerance: 0.001,
    },
    contentHash: "a".repeat(64),
    createdAt: "2026-08-08T12:00:00.000Z",
    createdBy: {
      displayName: "Question generation system",
      occurredAt: "2026-08-08T12:00:00.000Z",
      userId: "system:question-generator",
    },
    creationMethod: "generated",
    difficulty: "foundational",
    generationMetadata: { generatorId: "private-pattern-secret" },
    hints: ["Count favorable outcomes."],
    id: "generated-revision-question",
    misconceptions: [
      {
        feedback: "Use favorable outcomes over total outcomes.",
        id: "reversed-ratio",
        matchTerms: ["4"],
      },
    ],
    prompt: "One of four outcomes is favorable. Find the probability.",
    schemaVersion: 2,
    solutionSteps: ["Compute 1 / 4 = 0.25."],
    source: {
      originalityNote: "Original public-safe generated item.",
      patternIds: ["private-pattern-secret"],
      sourceType: "generated_original",
      trustLevel: "generated_unverified",
      visibility: "public",
    },
    state: "needs_review",
    title: "Generated probability draft",
    topicId: "basic-probability",
    validationStatus: "valid",
    versionId: 12,
    versionNumber: 2,
  };
}
