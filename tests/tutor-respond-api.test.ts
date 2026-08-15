import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/tutor/respond/route";
import {
  createTutorSession,
  getTutorSession,
  resetTutorSessionsForTests,
} from "@/lib/data/tutor-session-repository";
import { resetTutorStateForTests } from "@/lib/tutor/tutor-state";
import {
  authorizationForStudentOwner,
  mockStudentOwner,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
} from "./auth-test-helpers";

const studentAuthorization = authorizationForStudentOwner(TEST_ANONYMOUS_OWNER);

describe("tutor response API", () => {
  beforeEach(() => {
    resetTutorSessionsForTests();
    resetTutorStateForTests();
    mockStudentOwner(TEST_ANONYMOUS_OWNER);
    vi.stubEnv("APP_DEMO_MODE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAuthMocks();
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
