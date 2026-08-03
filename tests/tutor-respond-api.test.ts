import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/tutor/respond/route";
import {
  createTutorSession,
  getTutorSession,
  resetTutorSessionsForTests,
} from "@/lib/data/tutor-session-repository";
import { resetTutorStateForTests } from "@/lib/tutor/tutor-state";
import {
  mockStudentOwner,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
} from "./auth-test-helpers";

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
    const session = await createTutorSession({
      owner: TEST_ANONYMOUS_OWNER,
      questionId: "dice-sum-eight",
    });
    const mismatch = await POST(
      jsonRequest({
        answer: "2/5",
        mode: "check",
        questionId: "five-question-quiz",
        sessionId: session.id,
      }),
    );
    const accepted = await POST(
      jsonRequest({
        answer: "2/5",
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
      getTutorSession(session.id, TEST_ANONYMOUS_OWNER),
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
    const session = await createTutorSession({
      owner: TEST_ANONYMOUS_OWNER,
      questionId: "dice-sum-eight",
    });
    const response = await POST(
      jsonRequest({
        answer: "x".repeat(801),
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
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/tutor/respond", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
