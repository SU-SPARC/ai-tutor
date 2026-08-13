import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as createQuestionVersion } from "@/app/api/professor/questions/[id]/versions/route";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

const QUESTION_ID = "generated-revision-question";

describe("professor question revision API", () => {
  beforeEach(() => {
    vi.stubEnv("APP_DEMO_MODE", "true");
    vi.stubEnv("DATABASE_URL", "");
  });

  afterEach(() => {
    resetAuthMocks();
    vi.unstubAllEnvs();
  });

  it("requires an authenticated professor", async () => {
    mockPrincipal(undefined);
    const anonymous = await postRevision(validRevisionRequest());
    mockPrincipal(TEST_STUDENT);
    const student = await postRevision(validRevisionRequest());

    expect(anonymous.status).toBe(401);
    expect(student.status).toBe(403);
  });

  it("rejects invalid mathematical and content structure before storage", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const missingSteps = await postRevision(
      validRevisionRequest({ solutionSteps: [] }),
    );
    const negativeTolerance = await postRevision(
      validRevisionRequest({
        answer: {
          acceptedAnswers: ["0.25"],
          explanation: "Divide 1 by 4.",
          numericValue: 0.25,
          tolerance: -0.1,
        },
      }),
    );
    const inconsistentNumericAnswer = await postRevision(
      validRevisionRequest({
        answer: {
          acceptedAnswers: ["0.5"],
          explanation: "Divide 1 by 4.",
          numericValue: 0.25,
          tolerance: 0.001,
        },
      }),
    );

    expect(missingSteps.status).toBe(422);
    expect(negativeTolerance.status).toBe(422);
    expect(inconsistentNumericAnswer.status).toBe(422);
    await expect(inconsistentNumericAnswer.json()).resolves.toMatchObject({
      error: expect.stringMatching(/accepted answer.*numeric answer/i),
    });
  });

  it("rejects client-controlled provenance and private-source excerpts", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const clientSource = await postRevision(
      validRevisionRequest({
        source: {
          sourceType: "generated_original",
          trustLevel: "professor_approved",
        },
      }),
    );
    const copiedExcerpt = await postRevision(
      validRevisionRequest({
        prompt: "Use the worked example copied from the textbook page.",
      }),
    );

    expect(clientSource.status).toBe(422);
    expect(copiedExcerpt.status).toBe(422);
    await expect(copiedExcerpt.json()).resolves.toMatchObject({
      error: expect.stringMatching(/private-source wording/i),
    });
  });

  it("accepts a structurally valid revision before enforcing read-only demo storage", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const response = await postRevision({
      ...validRevisionRequest(),
      comment: "Clarify the wording while preserving the live version.",
    });

    expect(response.status).toBe(503);
  });
});

function postRevision(body: unknown) {
  return createQuestionVersion(
    new Request(`http://test/api/professor/questions/${QUESTION_ID}/versions`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
    { params: Promise.resolve({ id: QUESTION_ID }) },
  );
}

function validRevisionRequest(revisionPatch: Record<string, unknown> = {}) {
  return {
    baseVersionId: 12,
    expectedWorkingVersionId: 12,
    revision: {
      answer: {
        acceptedAnswers: ["0.25", "1/4"],
        explanation: "Divide one favorable outcome by four outcomes.",
        numericValue: 0.25,
        tolerance: 0.001,
      },
      difficulty: "foundational",
      hints: ["Identify the favorable and total outcomes."],
      misconceptions: [
        {
          feedback: "Use favorable outcomes divided by total outcomes.",
          id: "reversed-ratio",
          matchTerms: ["4"],
        },
      ],
      prompt:
        "One of four equally likely outcomes is favorable. What is the probability?",
      solutionSteps: ["Compute 1 / 4 = 0.25."],
      title: "Generated probability revision",
      topicId: "basic-probability",
      ...revisionPatch,
    },
  };
}
