import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTutorResponseFromState: vi.fn(),
  getApprovedQuestionById: vi.fn(),
  getTutorSession: vi.fn(),
  persistTutorSessionTransition: vi.fn(),
}));

vi.mock("@/lib/data/data-store", () => ({
  getApprovedQuestionById: mocks.getApprovedQuestionById,
}));

vi.mock("@/lib/data/tutor-session-repository", () => ({
  getTutorSession: mocks.getTutorSession,
  persistTutorSessionTransition: mocks.persistTutorSessionTransition,
}));

vi.mock("@/lib/tutor/tutor-engine", () => ({
  createTutorResponseFromState: mocks.createTutorResponseFromState,
}));

import { POST } from "@/app/api/tutor/respond/route";
import type { TutorQuestion, TutorResponse } from "@/lib/types";
import {
  mockStudentOwner,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
} from "./auth-test-helpers";

afterEach(() => {
  resetAuthMocks();
  vi.clearAllMocks();
});

describe("student tutor response boundary", () => {
  it("binds responses to the owned approved question and keeps retrieval chunks server-only", async () => {
    const question = approvedQuestion();
    mockStudentOwner(TEST_ANONYMOUS_OWNER);
    mocks.getTutorSession.mockResolvedValue({
      attempts: [],
      createdAt: "2026-08-05T00:00:00.000Z",
      id: "session:owned",
      lastSeenAt: "2026-08-05T00:00:00.000Z",
      questionId: question.id,
      revealedHints: 0,
      revealedSteps: 0,
      revision: 0,
      status: "active",
    });
    mocks.getApprovedQuestionById.mockResolvedValue(question);
    mocks.createTutorResponseFromState.mockResolvedValue({
      response: privateGroundedResponse(),
      state: engineState(),
    });
    mocks.persistTutorSessionTransition.mockResolvedValue({
      outcome: "applied",
      session: mocks.getTutorSession.mock.results[0]?.value,
    });

    const response = await POST(
      new Request("http://test/api/tutor/respond", {
        body: JSON.stringify({
          answer: "Please explain this.",
          eventId: "event:private-grounding",
          mode: "hint",
          sessionId: "session:owned",
          topicId: "client-controlled-private-topic",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const body = await response.text();
    const payload = JSON.parse(body) as TutorResponse;

    expect(response.status).toBe(200);
    expect(mocks.createTutorResponseFromState).toHaveBeenCalledWith(
      {
        allowLlmFallback: false,
        answer: "Please explain this.",
        mode: "hint",
        questionId: question.id,
        sessionId: "session:owned",
        topicId: question.topicId,
      },
      expect.objectContaining({
        questionKey: question.id,
        sessionId: "session:owned",
      }),
      question,
    );
    expect(mocks.persistTutorSessionTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: "event:private-grounding",
        submittedAnswer: "Please explain this.",
      }),
    );
    expect(payload.retrievedContext).toEqual([]);
    expect(payload.responseLabel).toBe(
      "private_reference_grounded_explanation",
    );
    expect(body).not.toMatch(
      /raw private source body|approved private summary|private:chunk-id|client-controlled-private-topic/i,
    );
  });
});

function approvedQuestion(): TutorQuestion {
  return {
    answer: { acceptedAnswers: ["1/2"], explanation: "Approved answer." },
    difficulty: "foundational",
    hints: ["Approved hint."],
    id: "approved-question",
    misconceptions: [],
    prompt: "An approved question?",
    review: { status: "approved" },
    solutionSteps: ["Approved step."],
    source: {
      sourceType: "professor_provided",
      trustLevel: "professor_approved",
      visibility: "public",
    },
    title: "Approved question",
    topicId: "approved-topic",
  };
}

function privateGroundedResponse(): TutorResponse {
  return {
    hints: ["Synthesized safe guidance."],
    message: "A server-grounded explanation is available.",
    misconceptions: [],
    responseLabel: "private_reference_grounded_explanation",
    retrievedContext: [
      {
        body: "Raw private source body.",
        chunkType: "pattern",
        conceptTags: [],
        formulaRefs: [],
        id: "private:chunk-id",
        keywords: [],
        llmSafeSummary: "Approved private summary.",
        priorityTier: "private_reference",
        review: { status: "approved" },
        source: {
          sourceType: "private_reference_pattern",
          trustLevel: "private_reference",
          visibility: "private",
        },
        title: "Private server chunk",
        topicId: "private-topic",
      },
    ],
    source: "retrieval",
    steps: [],
    usage: {
      contextUsed: true,
      estimatedTokens: 12,
      fallbackUsed: false,
    },
    verdict: "guidance",
  };
}

function engineState() {
  return {
    attemptCount: 1,
    hintsRevealed: 1,
    lastMisconceptionIds: [],
    llmUsed: false,
    questionKey: "approved-question",
    retrievalUsed: true,
    sessionId: "session:owned",
    solved: false,
    state: "retrieval_guidance" as const,
    stepsRevealed: 0,
    wrongAttemptCount: 0,
  };
}
