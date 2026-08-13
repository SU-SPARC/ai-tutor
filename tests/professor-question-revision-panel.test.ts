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
import { ProfessorQuestionVersionHistory } from "@/components/professor/professor-question-lifecycle-panel";
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
      "Question wording",
      "Difficulty",
      "Accepted final answers",
      "Answer explanation",
      "Solution steps",
      "Hints",
      "Misconception notes",
      "Syllabus topic",
      "Version comment",
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("Save revision draft");
    expect(markup).toContain(
      "original version and any published version remain unchanged",
    );
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
    ).toBe("Edit published question");
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
    expect(lifecycleSource).toContain("Review & publish");
    expect(lifecycleSource).toContain("Review before publishing");
    expect(lifecycleSource).toContain("Confirm publication");
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

    expect(markup).toContain("Original generated draft");
    expect(markup).toContain("Professor edit from v1");
    expect(markup).toContain("Working version");
    expect(markup).toContain("Published version");
    expect(markup).toContain("Inspect immutable content");
    expect(markup).toContain("Two of four outcomes are favorable");
    expect(markup).toContain("Lifecycle Professor");
    expect(markup).toContain("2026-08-09T14:30:00.000Z");
    expect(markup).toContain("Clarify the ambiguous wording.");
    expect(markup).toContain("working version superseded");
    expect(markup).not.toContain("private-pattern-secret");
  });
});

function lifecycleFixture(): QuestionLifecycleDto {
  const version = versionFixture();
  return {
    allowedActions: ["approve", "request_revision", "reject"],
    events: [],
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
