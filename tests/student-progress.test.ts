import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/student/progress/route";
import { requireStudent } from "@/lib/auth/authorization";
import { activeCanonicalSyllabusTopics } from "@/lib/data/canonical-syllabus-topics";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { getStudentProgress } from "@/lib/data/student-progress";
import {
  createDatabaseTutorSessionRepository,
  createTutorSession,
  recordTutorSessionAttempt,
  recordTutorSessionAttemptOutcome,
  resetTutorSessionsForTests,
  revealTutorSessionHint,
  revealTutorSessionStep,
} from "@/lib/data/tutor-session-repository";
import type { AuthenticatedPrincipal } from "@/lib/auth/principal";
import {
  authorizationForStudentOwner,
  mockPrincipal,
  mockStudentOwner,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
  TEST_STUDENT,
} from "./auth-test-helpers";

const studentOwner = {
  kind: "user" as const,
  userId: TEST_STUDENT.userId,
};
const otherStudent: AuthenticatedPrincipal = {
  displayName: "Another Student",
  email: "another-student@example.invalid",
  kind: "user",
  role: "student",
  roles: ["student"],
  userId: "user:another-student",
};
const otherOwner = {
  kind: "user" as const,
  userId: otherStudent.userId,
};
const studentSessionAuthorization = authorizationForStudentOwner(studentOwner);
const otherSessionAuthorization = authorizationForStudentOwner(otherOwner);

describe("student progress dashboard", () => {
  beforeEach(() => {
    resetTutorSessionsForTests();
    mockPrincipal(TEST_STUDENT);
    vi.stubEnv("APP_DEMO_MODE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAuthMocks();
  });

  it("builds canonical topic, question, retry, help, and recent-session progress", async () => {
    const firstSession = await createTutorSession(
      studentSessionAuthorization,
      "dice-sum-eight",
    );
    await recordTutorSessionAttempt(studentSessionAuthorization, {
      answerPreview: "2/5 private working",
      sessionId: firstSession.id,
    });
    await recordTutorSessionAttemptOutcome(studentSessionAuthorization, {
      answerPreview: "2/5 private working",
      estimatedTokens: 0,
      sessionId: firstSession.id,
      source: "rule",
      verdict: "correct",
    });
    await revealTutorSessionHint(studentSessionAuthorization, firstSession.id);

    const secondSession = await createTutorSession(
      studentSessionAuthorization,
      "five-question-quiz",
    );
    await recordTutorSessionAttempt(studentSessionAuthorization, {
      answerPreview: "0.2 private working",
      sessionId: secondSession.id,
    });
    await recordTutorSessionAttemptOutcome(studentSessionAuthorization, {
      answerPreview: "0.2 private working",
      estimatedTokens: 0,
      sessionId: secondSession.id,
      source: "rule",
      verdict: "incorrect",
    });
    await revealTutorSessionStep(studentSessionAuthorization, secondSession.id);

    const otherStudentSession = await createTutorSession(
      otherSessionAuthorization,
      "exam-z-score",
    );
    await recordTutorSessionAttempt(otherSessionAuthorization, {
      sessionId: otherStudentSession.id,
    });

    const progress = await getStudentProgress(await requireStudent());

    expect(progress).toMatchObject({
      mode: "demo",
      summary: {
        completedQuestions: 1,
        hintsUsed: 1,
        inProgressQuestions: 1,
        needsAnotherAttempt: 1,
        topicsStarted: 2,
      },
    });
    expect(progress.summary.availableQuestions).toBeGreaterThan(2);
    expect(progress.topics.map((topic) => topic.id)).toEqual(
      activeCanonicalSyllabusTopics.map((topic) => topic.id),
    );
    expect(progress.questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attemptCount: 1,
          hintsUsed: 1,
          needsAnotherAttempt: false,
          questionId: "dice-sum-eight",
          resumeSessionId: firstSession.id,
          status: "completed",
        }),
        expect.objectContaining({
          attemptCount: 1,
          needsAnotherAttempt: true,
          questionId: "five-question-quiz",
          resumeSessionId: secondSession.id,
          status: "in_progress",
        }),
      ]),
    );
    expect(progress.recentSessions).toHaveLength(2);
    expect(progress.recentSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          questionId: "dice-sum-eight",
          sessionId: firstSession.id,
          status: "completed",
        }),
        expect.objectContaining({
          needsAnotherAttempt: true,
          questionId: "five-question-quiz",
          sessionId: secondSession.id,
          status: "in_progress",
        }),
      ]),
    );
    expect(JSON.stringify(progress)).not.toContain("exam-z-score");
    expect(JSON.stringify(progress)).not.toContain(otherStudent.userId);
    expect(JSON.stringify(progress)).not.toContain("private working");
  });

  it("requires an authenticated account even when a signed anonymous owner exists", async () => {
    mockPrincipal(undefined);
    mockStudentOwner(TEST_ANONYMOUS_OWNER);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Authentication is required.",
    });
  });

  it("returns only the authenticated student's data without peer or ranking fields", async () => {
    const ownedSession = await createTutorSession(
      studentSessionAuthorization,
      "dice-sum-eight",
    );
    await recordTutorSessionAttempt(studentSessionAuthorization, {
      answerPreview: "private student answer",
      sessionId: ownedSession.id,
    });
    const otherSession = await createTutorSession(
      otherSessionAuthorization,
      "exam-z-score",
    );
    await recordTutorSessionAttempt(otherSessionAuthorization, {
      sessionId: otherSession.id,
    });

    const response = await GET();
    const responseText = await response.text();
    const payload = JSON.parse(responseText);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(payload.progress.questions).toEqual([
      expect.objectContaining({ questionId: "dice-sum-eight" }),
    ]);
    expect(payload.progress.recentSessions).toEqual([
      expect.objectContaining({
        questionId: "dice-sum-eight",
        sessionId: ownedSession.id,
      }),
    ]);
    expect(responseText).not.toContain("private student answer");
    expect(responseText).not.toContain("exam-z-score");
    expect(responseText).not.toContain(otherSession.id);
    expect(responseText).not.toContain(otherStudent.userId);
    expect(responseText).not.toMatch(
      /leaderboard|rank|percentile|classAverage/i,
    );
  });

  it("binds the production session query to the authenticated user id", async () => {
    const calls: Array<{ params: unknown[]; sql: string }> = [];
    const query: DatabaseQueryExecutor = async (sql, params = []) => {
      const normalizedSql = sql.replace(/\s+/g, " ").trim();
      calls.push({ params, sql: normalizedSql });

      if (normalizedSql.startsWith("select s.*,")) {
        return [
          {
            anonymous_user_id: null,
            created_at: "2026-08-14T09:00:00.000Z",
            id: "session:owned-production",
            last_seen_at: "2026-08-14T10:00:00.000Z",
            question_id: "dice-sum-eight",
            question_title: "Two fair dice",
            question_version_id: 1,
            revealed_hints: 1,
            revealed_steps: 0,
            status: "active",
            topic_id: "conditional-probability",
            user_id: TEST_STUDENT.userId,
          },
        ];
      }

      if (normalizedSql.startsWith("select session_id, id,")) {
        return [];
      }

      throw new Error(`Unexpected query: ${normalizedSql}`);
    };
    const repository = createDatabaseTutorSessionRepository(
      "postgres://unused.example/db",
      query,
    );

    const sessions = await repository.listSessionsForStudent(studentOwner);

    expect(sessions).toEqual([
      expect.objectContaining({ id: "session:owned-production" }),
    ]);
    expect(calls[0]).toMatchObject({
      params: ["user", TEST_STUDENT.userId],
    });
    expect(calls[0].sql).toContain(
      "$1 = 'user' and s.user_id = $2 and s.anonymous_user_id is null",
    );
    expect(calls[0].sql).toContain(
      "$1 = 'anonymous' and s.anonymous_user_id = $2 and s.user_id is null",
    );
    expect(calls[1]).toMatchObject({
      params: [["session:owned-production"]],
    });
  });
});
