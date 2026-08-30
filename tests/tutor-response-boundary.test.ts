import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { DataServiceUnavailableError } from "@/lib/data/service-error";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import type { TutorQuestion, TutorResponse } from "@/lib/types";
import {
  mockStudentOwner,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
} from "./auth-test-helpers";

let originalRateLimitMaximum: string | undefined;

beforeEach(() => {
  originalRateLimitMaximum = process.env.RATE_LIMIT_MAX_REQUESTS;
  resetRateLimitsForTests();
});

afterEach(() => {
  resetAuthMocks();
  if (originalRateLimitMaximum === undefined) {
    delete process.env.RATE_LIMIT_MAX_REQUESTS;
  } else {
    process.env.RATE_LIMIT_MAX_REQUESTS = originalRateLimitMaximum;
  }
  resetRateLimitsForTests();
  vi.resetAllMocks();
});

describe("student tutor response boundary", () => {
  it("rejects an oversized streamed body without relying on Content-Length", async () => {
    const request = new Request("http://test/api/tutor/respond", {
      body: JSON.stringify({
        answer: "x".repeat(9_000),
        eventId: "event:oversized",
        mode: "check",
        sessionId: "session:owned",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(request.headers.get("content-length")).toBeNull();
    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(mocks.getTutorSession).not.toHaveBeenCalled();
  });

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
      undefined,
    );
    expect(mocks.persistTutorSessionTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: "event:private-grounding",
        submittedAnswer: "Please explain this.",
      }),
    );
    expect(payload.retrievedContext).toEqual([]);
    expect(body).not.toContain("estimatedTokens");
    expect(payload.responseLabel).toBe(
      "private_reference_grounded_explanation",
    );
    expect(body).not.toMatch(
      /raw private source body|approved private summary|private:chunk-id|client-controlled-private-topic/i,
    );
  });

  it("returns a safe retrieval outage without calling persistence", async () => {
    const question = approvedQuestion();
    mockStudentOwner(TEST_ANONYMOUS_OWNER);
    mocks.getTutorSession.mockResolvedValue(activeSession(question));
    mocks.getApprovedQuestionById.mockResolvedValue(question);
    mocks.createTutorResponseFromState.mockRejectedValue(
      new DataServiceUnavailableError("retrieval", {
        cause: new Error(
          "select secret from private_chunks at postgres://user:password@db.invalid",
        ),
      }),
    );

    const response = await POST(tutorRequest("event:retrieval-outage"));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("3");
    expect(JSON.parse(body)).toEqual({
      code: "RETRIEVAL_SERVICE_UNAVAILABLE",
      error:
        "Additional course guidance is temporarily unavailable. Your saved progress was not changed. Please try again shortly.",
    });
    expect(body).not.toMatch(/select|private_chunks|password|db\.invalid/i);
    expect(mocks.persistTutorSessionTransition).not.toHaveBeenCalled();
  });

  it("returns a recoverable conflict after repeated stale revisions", async () => {
    const question = approvedQuestion();
    const session = activeSession(question);
    mockStudentOwner(TEST_ANONYMOUS_OWNER);
    mocks.getTutorSession.mockResolvedValue(session);
    mocks.getApprovedQuestionById.mockResolvedValue(question);
    mocks.createTutorResponseFromState.mockResolvedValue({
      response: privateGroundedResponse(),
      state: engineState(),
    });
    mocks.persistTutorSessionTransition.mockResolvedValue({
      outcome: "conflict",
      session,
    });

    const response = await POST(tutorRequest("event:stale-session"));
    const payload = (await response.json()) as {
      code?: string;
      error?: string;
    };

    expect(response.status).toBe(409);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(payload.code).toBe("TUTOR_SESSION_STALE");
    expect(payload.error).toContain("another tab");
    expect(mocks.persistTutorSessionTransition).toHaveBeenCalledTimes(3);
  });

  it("conceals expired sessions and questions removed during a session", async () => {
    const question = approvedQuestion();
    mockStudentOwner(TEST_ANONYMOUS_OWNER);
    mocks.getTutorSession.mockResolvedValueOnce(undefined);

    const expired = await POST(tutorRequest("event:expired"));

    mocks.getTutorSession.mockResolvedValueOnce(activeSession(question));
    mocks.getApprovedQuestionById.mockResolvedValueOnce(undefined);
    const unpublished = await POST(tutorRequest("event:unpublished"));
    const payloads = await Promise.all([
      expired.json() as Promise<{ code?: string; error?: string }>,
      unpublished.json() as Promise<{ code?: string; error?: string }>,
    ]);

    expect([expired.status, unpublished.status]).toEqual([404, 404]);
    expect(payloads.map((payload) => payload.code)).toEqual([
      "TUTOR_SESSION_UNAVAILABLE",
      "TUTOR_SESSION_UNAVAILABLE",
    ]);
    expect(
      payloads.every((payload) => payload.error?.includes("expired")),
    ).toBe(true);
    expect(mocks.createTutorResponseFromState).not.toHaveBeenCalled();
    expect(mocks.persistTutorSessionTransition).not.toHaveBeenCalled();
  });

  it("handles an interrupted request stream without exposing an exception", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"mode":"check"'));
        controller.error(
          new Error("socket failed with secret authorization header"),
        );
      },
    });
    const request = new Request("http://test/api/tutor/respond", {
      body: stream,
      duplex: "half",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    } as RequestInit & { duplex: "half" });

    const response = await POST(request);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(body)).toMatchObject({
      code: "TUTOR_REQUEST_INTERRUPTED",
    });
    expect(body).not.toMatch(/socket|secret|authorization header/i);
    expect(mocks.getTutorSession).not.toHaveBeenCalled();
  });

  it("throttles a burst with a friendly bounded response and no student details in logs", async () => {
    process.env.RATE_LIMIT_MAX_REQUESTS = "1";
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = () =>
      new Request("http://test/api/tutor/respond", {
        body: "not-json",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "203.0.113.44",
        },
        method: "POST",
      });

    const malformed = await POST(request());
    const limited = await POST(request());
    const body = await limited.text();
    const logs = warning.mock.calls.flat().join(" ");

    expect(malformed.status).toBe(400);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(JSON.parse(body)).toEqual({
      code: "TUTOR_RATE_LIMITED",
      error: "Too many tutor requests. Please wait a moment and try again.",
    });
    expect(logs).toContain('"event":"rate_limit_reached"');
    expect(logs).not.toContain("203.0.113.44");
    expect(mocks.getTutorSession).not.toHaveBeenCalled();
  });
});

function activeSession(question: TutorQuestion) {
  return {
    attempts: [],
    createdAt: "2026-08-05T00:00:00.000Z",
    id: "session:owned",
    lastSeenAt: "2026-08-05T00:00:00.000Z",
    questionId: question.id,
    questionVersionId: 7,
    revealedHints: 0,
    revealedSteps: 0,
    revision: 0,
    status: "active" as const,
  };
}

function tutorRequest(eventId: string) {
  return new Request("http://test/api/tutor/respond", {
    body: JSON.stringify({
      answer: "Please explain this.",
      eventId,
      mode: "hint",
      sessionId: "session:owned",
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

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
