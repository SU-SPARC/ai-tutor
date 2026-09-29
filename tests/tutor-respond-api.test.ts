import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/tutor/respond/route";
import {
  createTutorSession,
  getTutorSession,
  resetTutorSessionsForTests,
} from "@/lib/data/tutor-session-repository";
import { setStudentToolUsageRepositoryForTests } from "@/lib/data/student-tool-usage-repository";
import { resetTutorStateForTests } from "@/lib/tutor/tutor-state";
import {
  authorizationForStudentOwner,
  mockPrincipal,
  mockStudentOwner,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
  TEST_STUDENT,
} from "./auth-test-helpers";

/**
 * A switch for the one place a tutor request can fail after the AI Help usage
 * event has been recorded. The real engine runs unless a test arms it.
 */
const tutorEngineFailure: { error?: Error } = {};

vi.mock("@/lib/tutor/tutor-engine", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/tutor/tutor-engine")>();
  return {
    ...actual,
    createTutorResponseFromState: async (
      ...args: Parameters<typeof actual.createTutorResponseFromState>
    ) => {
      if (tutorEngineFailure.error) {
        throw tutorEngineFailure.error;
      }
      return actual.createTutorResponseFromState(...args);
    },
  };
});

const studentAuthorization = authorizationForStudentOwner(TEST_ANONYMOUS_OWNER);
const signedInStudentAuthorization = authorizationForStudentOwner({
  kind: "user",
  userId: TEST_STUDENT.userId,
});

/**
 * Stands in for `student_usage_events` with the same uniqueness the table
 * enforces: one row per (student, event id), and `recordAiHelpRequest` reports
 * whether this call inserted it. Sketchpad heartbeats are not exercised here.
 */
function fakeUsageRepository() {
  const persisted = new Set<string>();
  return {
    persisted,
    recordAiHelpRequest: vi.fn(
      async (
        authorization: { owner: { kind: string; userId?: string } },
        context: { eventId: string },
      ) => {
        const key = `${authorization.owner.userId}:${context.eventId}`;
        if (persisted.has(key)) return "duplicate" as const;
        persisted.add(key);
        return "recorded" as const;
      },
    ),
    recordSketchpadHeartbeat: vi.fn(async () => "recorded" as const),
  };
}

function aiHelpRequest(sessionId: string, eventId: string) {
  return jsonRequest({
    aiHelp: true,
    allowLlmFallback: true,
    answer: "I think it is 2/5 but I am not sure why.",
    eventId,
    mode: "check",
    questionId: "dice-sum-eight",
    sessionId,
  });
}

describe("tutor response API", () => {
  beforeEach(() => {
    resetTutorSessionsForTests();
    resetTutorStateForTests();
    mockStudentOwner(TEST_ANONYMOUS_OWNER);
    vi.stubEnv("APP_DEMO_MODE", "true");
  });

  afterEach(() => {
    tutorEngineFailure.error = undefined;
    setStudentToolUsageRepositoryForTests(undefined);
    vi.unstubAllEnvs();
    resetAuthMocks();
  });

  it("persists one AI Help request when the same signed-in request is replayed", async () => {
    const usage = fakeUsageRepository();
    setStudentToolUsageRepositoryForTests(usage);
    mockPrincipal(TEST_STUDENT);
    const session = await createTutorSession(
      signedInStudentAuthorization,
      "dice-sum-eight",
    );

    const first = await POST(aiHelpRequest(session.id, "event:ai-help-replay"));
    const replay = await POST(aiHelpRequest(session.id, "event:ai-help-replay"));
    const saved = await getTutorSession(signedInStudentAuthorization, session.id);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    // Both requests reach the ledger with the server-resolved owner and the
    // same event id; the ledger's uniqueness keeps a single row.
    expect(usage.recordAiHelpRequest).toHaveBeenCalledTimes(2);
    for (const call of usage.recordAiHelpRequest.mock.calls) {
      expect(call[0]).toMatchObject({
        owner: { kind: "user", userId: TEST_STUDENT.userId },
        permission: "student",
      });
      expect(call[1]).toMatchObject({
        eventId: "event:ai-help-replay",
        questionId: "dice-sum-eight",
        sessionId: session.id,
        // Topic context comes from the approved question, never the client.
        topicId: "conditional-probability",
      });
    }
    expect(usage.persisted.size).toBe(1);
    // The replay is served from the saved attempt, never as a second one.
    expect(saved?.attempts).toHaveLength(1);
    expect(saved).toMatchObject({ solved: false, wrongAttemptCount: 0 });
  });

  it("keeps the recorded AI Help request and leaves academic state untouched when the tutor fails afterwards", async () => {
    const usage = fakeUsageRepository();
    setStudentToolUsageRepositoryForTests(usage);
    mockPrincipal(TEST_STUDENT);
    const session = await createTutorSession(
      signedInStudentAuthorization,
      "dice-sum-eight",
    );
    tutorEngineFailure.error = new Error("synthetic provider failure");

    const response = await POST(
      aiHelpRequest(session.id, "event:ai-help-downstream-failure"),
    );
    const saved = await getTutorSession(signedInStudentAuthorization, session.id);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.not.toHaveProperty("verdict");
    expect(usage.persisted).toEqual(
      new Set([`${TEST_STUDENT.userId}:event:ai-help-downstream-failure`]),
    );
    expect(saved).toMatchObject({
      attemptCount: 0,
      attempts: [],
      solved: false,
      wrongAttemptCount: 0,
    });
  });

  it("keeps AI Help academic state safe when usage telemetry fails", async () => {
    setStudentToolUsageRepositoryForTests({
      async recordAiHelpRequest() {
        throw new Error("synthetic telemetry failure");
      },
      async recordSketchpadHeartbeat() {
        return "recorded" as const;
      },
    });
    mockPrincipal(TEST_STUDENT);
    const session = await createTutorSession(
      signedInStudentAuthorization,
      "dice-sum-eight",
    );

    const response = await POST(
      aiHelpRequest(session.id, "event:ai-help-telemetry-failure"),
    );
    const saved = await getTutorSession(signedInStudentAuthorization, session.id);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      verdict: "guidance",
    });
    expect(saved).toMatchObject({ solved: false, wrongAttemptCount: 0 });
    expect(saved?.attempts[0]).toMatchObject({ verdict: "guidance" });
  });

  it("derives identity from the active session and rejects mismatched questions", async () => {
    const session = await createTutorSession(
      studentAuthorization,
      "dice-sum-eight",
    );
    const mismatch = await POST(
      jsonRequest({
        answer: "2/5",
        eventId: "event:mismatch",
        mode: "check",
        questionId: "five-question-quiz",
        sessionId: session.id,
      }),
    );
    const accepted = await POST(
      jsonRequest({
        answer: "2/5",
        eventId: "event:accepted",
        mode: "check",
        questionId: "dice-sum-eight",
        sessionId: session.id,
      }),
    );

    expect(mismatch.status).toBe(400);
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({
      source: "rule",
      verdict: "correct",
    });
    await expect(
      getTutorSession(studentAuthorization, session.id),
    ).resolves.toMatchObject({
      attempts: [
        expect.objectContaining({
          source: "rule",
          verdict: "correct",
        }),
      ],
    });
  });

  it("does not block non-LLM help when the answer exceeds the AI input cap", async () => {
    const session = await createTutorSession(
      studentAuthorization,
      "dice-sum-eight",
    );
    const response = await POST(
      jsonRequest({
        answer: "x".repeat(801),
        eventId: "event:long-hint",
        mode: "hint",
        questionId: "dice-sum-eight",
        sessionId: session.id,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      source: "rule",
      verdict: "guidance",
    });
  });

  it("recovers progress after process state loss and deduplicates a retried event", async () => {
    const session = await createTutorSession(
      studentAuthorization,
      "dice-sum-eight",
      "session:recovery-api",
    );
    const requestBody = {
      answer: "Contact me at student@example.edu before I answer 1/3",
      eventId: "event:recovery-api",
      mode: "check",
      questionId: "dice-sum-eight",
      sessionId: session.id,
    } as const;

    const first = await POST(jsonRequest(requestBody));
    resetTutorStateForTests();
    const duplicate = await POST(jsonRequest(requestBody));
    const afterDuplicate = await getTutorSession(
      studentAuthorization,
      session.id,
    );
    const resumedHint = await POST(
      jsonRequest({
        answer: "",
        eventId: "event:recovery-hint",
        mode: "hint",
        questionId: "dice-sum-eight",
        sessionId: session.id,
      }),
    );
    const recovered = await getTutorSession(studentAuthorization, session.id);

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(afterDuplicate).toMatchObject({
      attemptCount: 1,
      revision: 1,
    });
    expect(afterDuplicate?.attempts).toEqual([
      expect.objectContaining({
        idempotencyKey: "event:recovery-api",
        normalizedAnswer: "contactmeat[emailredacted]beforeianswer1/3",
        submittedAnswer: "Contact me at [email redacted] before I answer 1/3",
      }),
    ]);
    expect(JSON.stringify(afterDuplicate)).not.toContain("student@example.edu");
    expect(resumedHint.status).toBe(200);
    expect(recovered).toMatchObject({
      attemptCount: 2,
      revision: 2,
    });
  });
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/tutor/respond", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
