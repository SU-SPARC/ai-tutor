import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/student/progress/route";
import { getStudentProgress } from "@/lib/data/student-progress";
import {
  createTutorSession,
  recordTutorSessionAttempt,
  recordTutorSessionAttemptOutcome,
  resetTutorSessionsForTests,
  revealTutorSessionHint,
  revealTutorSessionStep,
} from "@/lib/data/tutor-session-repository";
import {
  mockStudentOwner,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
  TEST_STUDENT,
} from "./auth-test-helpers";

const studentOwner = TEST_ANONYMOUS_OWNER;
const otherOwner = {
  kind: "anonymous" as const,
  anonymousId: "anon:test-browser-b",
};

describe("student progress dashboard", () => {
  beforeEach(() => {
    resetTutorSessionsForTests();
    mockStudentOwner(studentOwner);
    vi.stubEnv("APP_DEMO_MODE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAuthMocks();
  });

  it("aggregates attempts, outcomes, help, topics, and recent sessions", async () => {
    const firstSession = await createTutorSession({
      owner: studentOwner,
      questionId: "dice-sum-eight",
    });
    await recordTutorSessionAttempt({
      answerPreview: "2/5 private working",
      owner: studentOwner,
      sessionId: firstSession.id,
    });
    await recordTutorSessionAttemptOutcome({
      answerPreview: "2/5 private working",
      estimatedTokens: 0,
      owner: studentOwner,
      sessionId: firstSession.id,
      source: "rule",
      verdict: "correct",
    });
    await revealTutorSessionHint(firstSession.id, studentOwner);

    const secondSession = await createTutorSession({
      owner: studentOwner,
      questionId: "five-question-quiz",
    });
    await recordTutorSessionAttempt({
      answerPreview: "0.2 private working",
      owner: studentOwner,
      sessionId: secondSession.id,
    });
    await recordTutorSessionAttemptOutcome({
      answerPreview: "0.2 private working",
      estimatedTokens: 0,
      owner: studentOwner,
      sessionId: secondSession.id,
      source: "rule",
      verdict: "incorrect",
    });
    await revealTutorSessionStep(secondSession.id, studentOwner);

    const otherStudentSession = await createTutorSession({
      owner: otherOwner,
      questionId: "exam-z-score",
    });
    await recordTutorSessionAttempt({
      owner: otherOwner,
      sessionId: otherStudentSession.id,
    });

    const progress = await getStudentProgress(studentOwner);

    expect(progress).toMatchObject({
      mode: "demo",
      summary: {
        attemptedQuestions: 2,
        correctAttempts: 1,
        hintsUsed: 1,
        stepsRevealed: 1,
        topicsPracticed: 2,
      },
    });
    expect(progress.topics.map((topic) => topic.id)).toEqual([
      "conditional-probability",
      "binomial-models",
    ]);
    expect(progress.recentSessions).toHaveLength(2);
    expect(progress.recentSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attemptCount: 1,
          correctAttempts: 1,
          questionId: "dice-sum-eight",
        }),
        expect.objectContaining({
          attemptCount: 1,
          correctAttempts: 0,
          questionId: "five-question-quiz",
        }),
      ]),
    );
  });

  it("requires an anonymous browser session and returns aggregate-only data", async () => {
    const session = await createTutorSession({
      owner: studentOwner,
      questionId: "dice-sum-eight",
    });
    await recordTutorSessionAttempt({
      answerPreview: "private student answer",
      owner: studentOwner,
      sessionId: session.id,
    });

    mockStudentOwner(undefined);
    const missingIdentity = await GET();
    mockStudentOwner(studentOwner);
    const response = await GET();
    const responseText = await response.text();

    expect(missingIdentity.status).toBe(401);
    expect(response.status).toBe(200);
    expect(responseText).not.toContain("private student answer");
    expect(responseText).not.toContain("anon:test-browser-a");
    expect(responseText).not.toContain(session.id);
    expect(JSON.parse(responseText)).toMatchObject({
      progress: {
        summary: {
          attemptedQuestions: 1,
        },
      },
    });
  });

  it("returns only the authenticated student's progress", async () => {
    const authenticatedOwner = {
      kind: "user" as const,
      userId: TEST_STUDENT.userId,
    };
    const otherAuthenticatedOwner = {
      kind: "user" as const,
      userId: "user:another-student",
    };
    const ownedSession = await createTutorSession({
      owner: authenticatedOwner,
      questionId: "dice-sum-eight",
    });
    await recordTutorSessionAttempt({
      owner: authenticatedOwner,
      sessionId: ownedSession.id,
    });
    const otherSession = await createTutorSession({
      owner: otherAuthenticatedOwner,
      questionId: "exam-z-score",
    });
    await recordTutorSessionAttempt({
      owner: otherAuthenticatedOwner,
      sessionId: otherSession.id,
    });

    mockStudentOwner(authenticatedOwner);
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.progress.summary.attemptedQuestions).toBe(1);
    expect(payload.progress.recentSessions).toEqual([
      expect.objectContaining({ questionId: "dice-sum-eight" }),
    ]);
    expect(JSON.stringify(payload)).not.toContain("exam-z-score");
    expect(JSON.stringify(payload)).not.toContain("user:another-student");
  });
});
