import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/professor/questions/[id]/similarity/route";
import { ProfessorQuestionSimilarityControls } from "@/components/professor/professor-question-similarity-controls";
import { ProfessorQuestionSimilarityCoverage } from "@/components/professor/professor-question-similarity-coverage";
import { createDatabaseQuestionSimilaritySelectionRepository } from "@/lib/data/question-similarity-repository";
import type {
  QuestionLifecycleDto,
  QuestionSimilarityLinkDto,
  QuestionVersionDto,
} from "@/lib/types";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_STUDENT,
} from "./auth-test-helpers";

afterEach(() => {
  resetAuthMocks();
  vi.unstubAllEnvs();
});

describe("professor question similarity workflow", () => {
  it("shows the Reserve origin and slot and exposes removal", () => {
    const html = renderToStaticMarkup(
      createElement(ProfessorQuestionSimilarityControls, {
        initialLinks: [link()],
        publishedOrigins: [
          { questionId: "origin", title: "Origin title", versionId: 11 },
        ],
        question: reserveQuestion(),
      }),
    );

    expect(html).toContain("Similar to: Origin title");
    expect(html).toContain("slot 2 of 3");
    expect(html).toContain("Revoke link");
  });

  it("shows published-origin coverage and only its dedicated siblings", () => {
    const html = renderToStaticMarkup(
      createElement(ProfessorQuestionSimilarityControls, {
        initialLinks: [link()],
        publishedOrigins: [],
        question: originQuestion(),
      }),
    );

    expect(html).toContain("1 of 3 eligible");
    expect(html).toContain("Slot 2 of 3 · Reserve title");
    expect(html).not.toContain("Assign origin");
  });

  it("renders the compact topic coverage view", () => {
    const html = renderToStaticMarkup(
      createElement(ProfessorQuestionSimilarityCoverage, {
        coverage: [
          {
            eligibleSiblingCount: 1,
            linkedSiblingCount: 2,
            originQuestionId: "origin",
            originTitle: "Origin title",
            originVersionId: 11,
            targetSiblingCount: 3,
            topicId: "topic",
          },
        ],
        topicTitle: "Probability",
      }),
    );

    expect(html).toContain("Dedicated sibling coverage");
    expect(html).toContain("Origin title");
    expect(html).toContain("1/3");
  });

  it("uses a truthful generic label for an ineligible current link", () => {
    const html = renderToStaticMarkup(
      createElement(ProfessorQuestionSimilarityControls, {
        initialLinks: [{ ...link(), eligible: false }],
        publishedOrigins: [],
        question: originQuestion(),
      }),
    );

    expect(html).toContain("Not currently eligible");
    expect(html).not.toContain("version changed");
  });

  it("lets an eligible unlinked Reserve question choose an origin and slot", () => {
    const html = renderToStaticMarkup(
      createElement(ProfessorQuestionSimilarityControls, {
        initialLinks: [],
        publishedOrigins: [
          { questionId: "origin", title: "Origin title", versionId: 11 },
        ],
        question: reserveQuestion(),
      }),
    );

    expect(html).toContain("Select an origin");
    expect(html).toContain("Origin title");
    expect(html).toContain("1 of 3");
    expect(html).toContain("2 of 3");
    expect(html).toContain("3 of 3");
    expect(html).toContain("Assign origin");
  });

  it("denies similarity assignment and revocation to a student before touching storage", async () => {
    mockPrincipal(TEST_STUDENT);
    vi.stubEnv("APP_DEMO_MODE", "true");
    vi.stubEnv("DATABASE_URL", "");

    for (const body of [
      {
        action: "assign",
        expectedSimilarVersionId: 22,
        originQuestionId: "origin",
        originVersionId: 11,
        slot: 1,
      },
      {
        action: "remove",
        expectedSimilarVersionId: 22,
        linkId: 41,
        originQuestionId: "origin",
        originVersionId: 11,
        slot: 1,
      },
    ]) {
      const response = await POST(
        new Request("http://test/api/professor/questions/reserve/similarity", {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
        { params: Promise.resolve({ id: "reserve" }) },
      );

      expect(response.status).toBe(403);
    }
  });

  it("uses one origin-scoped query instead of scanning the global Reserve pool", async () => {
    const calls: Array<{ params: unknown[]; sql: string }> = [];
    const repository = createDatabaseQuestionSimilaritySelectionRepository(
      async (sql, params = []) => {
        calls.push({ params, sql });
        return [];
      },
    );

    await expect(
      repository.listEligibleForOrigin("origin", 11),
    ).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual(["origin", 11]);
    expect(calls[0].sql).toMatch(
      /from question_similarity_links link[\s\S]+where link\.origin_question_id = \$1[\s\S]+link\.origin_version_id = \$2/,
    );
    expect(calls[0].sql).toMatch(/join app_reserve_practice_questions/);
  });
});

function link(): QuestionSimilarityLinkDto {
  return {
    createdAt: "2026-09-17T12:00:00.000Z",
    createdBy: {
      displayName: "Professor",
      occurredAt: "2026-09-17T12:00:00.000Z",
      userId: "user:professor",
    },
    eligible: true,
    id: 41,
    originQuestionId: "origin",
    originTitle: "Origin title",
    originVersionId: 11,
    relationshipType: "similar_practice",
    similarQuestionId: "reserve",
    similarTitle: "Reserve title",
    similarVersionId: 22,
    slot: 2,
  };
}

function originQuestion(): QuestionLifecycleDto {
  const version = questionVersion("origin", "Origin title", 11, "published");
  return {
    allowedActions: [],
    events: [],
    provenanceCorrectionAllowed: false,
    publishedVersion: version,
    questionId: "origin",
    recordState: "active",
    regenerationAllowed: false,
    versions: [version],
    workingVersion: version,
  };
}

function reserveQuestion(): QuestionLifecycleDto {
  const version = questionVersion("reserve", "Reserve title", 22, "approved");
  return {
    allowedActions: [],
    events: [],
    provenanceCorrectionAllowed: false,
    questionId: "reserve",
    recordState: "active",
    regenerationAllowed: false,
    reserve: {
      practiceAllowed: true,
      reasonCode: "extra_practice",
      reservedAt: "2026-09-17T12:00:00.000Z",
      reservedBy: {
        displayName: "Professor",
        occurredAt: "2026-09-17T12:00:00.000Z",
        userId: "user:professor",
      },
    },
    versions: [version],
    workingVersion: version,
  };
}

function questionVersion(
  id: string,
  title: string,
  versionId: number,
  state: "approved" | "published",
): QuestionVersionDto {
  return {
    allowedActions: [],
    answer: { acceptedAnswers: ["0.5"], explanation: "Divide." },
    contentHash: "a".repeat(64),
    createdAt: "2026-09-17T12:00:00.000Z",
    createdBy: {
      displayName: "Professor",
      occurredAt: "2026-09-17T12:00:00.000Z",
      userId: "user:professor",
    },
    creationMethod: "manual",
    difficulty: "foundational",
    generationMetadata: {},
    hints: ["Count."],
    id,
    misconceptions: [],
    prompt: "Prompt",
    schemaVersion: 2,
    solutionSteps: ["Compute."],
    source: {
      originalityNote: "Original.",
      sourceType: "professor_provided",
      trustLevel: "professor_approved",
      visibility: "public",
    },
    state,
    title,
    topicId: "topic",
    validationStatus: "valid",
    versionId,
    versionNumber: 1,
  };
}
