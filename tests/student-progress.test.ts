import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/student/progress/route";
import { requireStudent } from "@/lib/auth/authorization";
import { activeCanonicalSyllabusTopics } from "@/lib/data/canonical-syllabus-topics";
import { setContentRepositoryForTests } from "@/lib/data/data-store";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { demoContentRepository } from "@/lib/data/demo-repository";
import { getStudentProgress } from "@/lib/data/student-progress";
import {
  createDatabaseTutorSessionRepository,
  createMemoryTutorSessionRepository,
  createReservePracticeTutorSession,
  createTutorSession,
  getTutorSession,
  persistTutorSessionTransition,
  recordTutorSessionAttempt,
  recordTutorSessionAttemptOutcome,
  resetTutorSessionsForTests,
  revealTutorSessionHint,
  revealTutorSessionStep,
  setTutorSessionRepositoryForTests,
} from "@/lib/data/tutor-session-repository";
import type { AuthenticatedPrincipal } from "@/lib/auth/principal";
import type { TutorSessionRecord } from "@/lib/types";
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
    setContentRepositoryForTests(undefined);
    mockPrincipal(TEST_STUDENT);
    vi.stubEnv("APP_DEMO_MODE", "true");
  });

  afterEach(() => {
    setContentRepositoryForTests(undefined);
    vi.unstubAllEnvs();
    resetAuthMocks();
  });

  it("keeps an opened session recoverable without progress, topics, or recent activity", async () => {
    const session = await createTutorSession(
      studentSessionAuthorization,
      "dice-sum-eight",
    );
    const progress = await getStudentProgress(await requireStudent());
    expect(progress.summary).toMatchObject({
      completedQuestions: 0,
      inProgressQuestions: 0,
      topicsStarted: 0,
      hintsUsed: 0,
      extraPracticeSessions: 0,
    });
    expect(progress.questions).toEqual([]);
    expect(progress.recentSessions).toEqual([]);
    expect(
      await getTutorSession(studentSessionAuthorization, session.id),
    ).toMatchObject({ id: session.id, attempts: [] });
  });

  it.each(["hint", "solution", "incorrect", "correct"] as const)(
    "starts progress only after %s activity and preserves answer counts",
    async (action) => {
      const session = await createTutorSession(
        studentSessionAuthorization,
        "dice-sum-eight",
      );
      if (action === "hint")
        await revealTutorSessionHint(studentSessionAuthorization, session.id);
      else if (action === "solution")
        await revealTutorSessionStep(studentSessionAuthorization, session.id);
      else
        await recordTutorSessionAttemptOutcome(studentSessionAuthorization, {
          sessionId: session.id,
          source: "rule",
          verdict: action,
          estimatedTokens: 0,
        });
      const progress = await getStudentProgress(await requireStudent());
      expect(progress.summary.topicsStarted).toBe(1);
      expect(progress.summary.inProgressQuestions).toBe(
        action === "correct" ? 0 : 1,
      );
      expect(progress.summary.completedQuestions).toBe(
        action === "correct" ? 1 : 0,
      );
      expect(progress.questions[0].attemptCount).toBe(
        action === "hint" || action === "solution" ? 0 : 1,
      );
      expect(progress.recentSessions).toHaveLength(1);
      expect(progress.recentSessions[0]).toMatchObject({
        hintsUsed: action === "hint" ? 1 : 0,
        stepsRevealed: action === "solution" ? 1 : 0,
      });
    },
  );

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

  it("counts only answer attempts while preserving revealed hint totals", async () => {
    const session = await createTutorSession(
      studentSessionAuthorization,
      "dice-sum-eight",
    );
    const initialState = session.engineState!;
    const response = {
      misconceptions: [],
      responseLabel: "approved_course_content" as const,
      source: "rule" as const,
      usage: {
        contextUsed: false,
        estimatedTokens: 0,
        fallbackUsed: false,
      },
      verdict: "guidance" as const,
    };

    const checked = await persistTutorSessionTransition(
      studentSessionAuthorization,
      {
        expectedRevision: 0,
        idempotencyKey: "event:progress-check",
        mode: "check",
        response: { ...response, verdict: "incorrect" },
        sessionId: session.id,
        state: {
          ...initialState,
          attemptCount: 1,
          state: "misconception_detected",
          wrongAttemptCount: 1,
        },
        submittedAnswer: "1/5",
      },
    );
    const hinted = await persistTutorSessionTransition(
      studentSessionAuthorization,
      {
        expectedRevision: 1,
        idempotencyKey: "event:progress-hint",
        mode: "hint",
        response,
        sessionId: session.id,
        state: {
          ...initialState,
          attemptCount: 1,
          hintsRevealed: 1,
          state: "hinting",
          wrongAttemptCount: 1,
        },
      },
    );
    const revealedSolution = await persistTutorSessionTransition(
      studentSessionAuthorization,
      {
        expectedRevision: 2,
        idempotencyKey: "event:progress-solution",
        mode: "solution",
        response,
        sessionId: session.id,
        state: {
          ...initialState,
          attemptCount: 1,
          hintsRevealed: 1,
          state: "step_reveal",
          stepsRevealed: 1,
          wrongAttemptCount: 1,
        },
      },
    );

    const progress = await getStudentProgress(await requireStudent());

    expect([checked.outcome, hinted.outcome, revealedSolution.outcome]).toEqual([
      "applied",
      "applied",
      "applied",
    ]);
    expect(progress.questions).toEqual([
      expect.objectContaining({
        attemptCount: 1,
        hintsUsed: 1,
        questionId: "dice-sum-eight",
      }),
    ]);
    expect(progress.recentSessions).toEqual([
      expect.objectContaining({
        attemptCount: 1,
        hintsUsed: 1,
        sessionId: session.id,
      }),
    ]);
  });

  it("preserves completed work after a question leaves the live catalog", async () => {
    const liveQuestions = await demoContentRepository.listQuestions();
    const liveTopics = await demoContentRepository.listTopics();
    const completedQuestion = liveQuestions.find(
      (question) => question.id === "dice-sum-eight",
    )!;
    const currentQuestion = liveQuestions.find(
      (question) => question.id === "five-question-quiz",
    )!;
    const completedAt = "2026-08-12T10:00:00.000Z";
    const sessions: TutorSessionRecord[] = [
      {
        attempts: [
          {
            createdAt: completedAt,
            id: "attempt:historical-correct",
            mode: "check",
            submittedAnswer: "PRIVATE-STUDENT-ANSWER",
            verdict: "correct",
          },
        ],
        completedAt,
        createdAt: "2026-08-12T09:00:00.000Z",
        id: "session:historical-completed",
        lastSeenAt: completedAt,
        practiceContext: "published",
        questionId: completedQuestion.id,
        questionTitle: completedQuestion.title,
        questionVersion: {
          ...completedQuestion,
          answer: {
            acceptedAnswers: ["PRIVATE-ACCEPTED-ANSWER"],
            explanation: "PRIVATE-SOLUTION-EXPLANATION",
          },
          hints: ["PRIVATE-HINT-BODY"],
          solutionSteps: ["PRIVATE-SOLUTION-STEP"],
          source: {
            ...completedQuestion.source,
            originalityNote: "PRIVATE-REFERENCE-NOTE",
          },
        },
        questionVersionId: 101,
        revealedHints: 1,
        revealedSteps: 1,
        solved: true,
        status: "completed",
        topicId: completedQuestion.topicId,
      },
      {
        attempts: [
          {
            createdAt: "2026-08-13T10:00:00.000Z",
            id: "attempt:current-incorrect",
            mode: "check",
            verdict: "incorrect",
          },
        ],
        createdAt: "2026-08-13T09:00:00.000Z",
        id: "session:current-question",
        lastSeenAt: "2026-08-13T10:00:00.000Z",
        practiceContext: "published",
        questionId: currentQuestion.id,
        questionTitle: currentQuestion.title,
        questionVersionId: 102,
        revealedHints: 0,
        revealedSteps: 0,
        solved: false,
        status: "active",
        topicId: currentQuestion.topicId,
      },
    ];
    const sessionRepository = createMemoryTutorSessionRepository();
    sessionRepository.listSessionsForStudent = async () => sessions;
    setTutorSessionRepositoryForTests(sessionRepository);

    const beforeRotation = await getStudentProgress(await requireStudent());

    expect(beforeRotation.questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          available: true,
          questionId: completedQuestion.id,
          status: "completed",
        }),
      ]),
    );
    expect(beforeRotation.summary).toMatchObject({
      availableCompletedQuestions: 1,
      completedQuestions: 1,
      previouslyCompletedQuestions: 0,
    });

    setContentRepositoryForTests({
      ...demoContentRepository,
      async listQuestions() {
        return liveQuestions.filter(
          (question) => question.id !== completedQuestion.id,
        );
      },
      async listTopics() {
        return liveTopics;
      },
    });

    const afterRotation = await getStudentProgress(await requireStudent());
    const historical = afterRotation.questions.find(
      (question) => question.questionId === completedQuestion.id,
    );
    const current = afterRotation.questions.find(
      (question) => question.questionId === currentQuestion.id,
    );
    const historicalSession = afterRotation.recentSessions.find(
      (session) => session.questionId === completedQuestion.id,
    );
    const serialized = JSON.stringify(afterRotation);

    expect(afterRotation.summary).toMatchObject({
      availableCompletedQuestions: 0,
      availableQuestions: liveQuestions.length - 1,
      completedQuestions: 1,
      previouslyCompletedQuestions: 1,
    });
    expect(historical).toMatchObject({
      available: false,
      questionId: completedQuestion.id,
      questionTitle: completedQuestion.title,
      resumeSessionId: undefined,
      status: "completed",
    });
    expect(current).toMatchObject({
      available: true,
      questionId: currentQuestion.id,
      status: "in_progress",
    });
    expect(historicalSession).toMatchObject({
      available: false,
      questionId: completedQuestion.id,
      questionTitle: completedQuestion.title,
      status: "unavailable",
    });
    expect(serialized).not.toMatch(
      /PRIVATE-STUDENT-ANSWER|PRIVATE-ACCEPTED-ANSWER|PRIVATE-SOLUTION|PRIVATE-HINT|PRIVATE-REFERENCE/,
    );

    setContentRepositoryForTests({
      ...demoContentRepository,
      async listQuestions() {
        return liveQuestions.filter(
          (question) => question.id !== completedQuestion.id,
        );
      },
      async listTopics() {
        return liveTopics.filter(
          (topic) => topic.id !== completedQuestion.topicId,
        );
      },
    });

    const afterTopicDeactivation = await getStudentProgress(
      await requireStudent(),
    );
    expect(
      afterTopicDeactivation.questions.find(
        (question) => question.questionId === completedQuestion.id,
      ),
    ).toMatchObject({
      available: false,
      questionTitle: completedQuestion.title,
      topicId: completedQuestion.topicId,
      topicTitle: "Earlier course content",
    });
    expect(afterTopicDeactivation.summary).toMatchObject({
      availableCompletedQuestions: 0,
      completedQuestions: 1,
      previouslyCompletedQuestions: 1,
    });
    expect(
      afterTopicDeactivation.topics.map((topic) => topic.id),
    ).not.toContain(completedQuestion.topicId);
  });

  it("requires an authenticated account even when a signed anonymous owner exists", async () => {
    mockPrincipal(undefined);
    mockStudentOwner(TEST_ANONYMOUS_OWNER);

    const response = await GET(
      new Request("http://localhost/api/student/progress"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Authentication is required.",
    });
  });

  it("keeps optional Reserve practice out of assigned completion totals", async () => {
    const origin = await createTutorSession(
      studentSessionAuthorization,
      "five-question-quiz",
    );
    const extra = await createReservePracticeTutorSession(
      studentSessionAuthorization,
      {
        idempotencyKey: "reserve-practice-test",
        originSessionId: origin.id,
        questionId: "dice-sum-eight",
        questionVersionId: 42,
      },
    );
    await recordTutorSessionAttemptOutcome(studentSessionAuthorization, {
      estimatedTokens: 0,
      sessionId: extra.id,
      source: "rule",
      verdict: "correct",
    });
    const liveQuestions = await demoContentRepository.listQuestions();
    setContentRepositoryForTests({
      ...demoContentRepository,
      async listQuestions() {
        return liveQuestions.filter(
          (question) => question.id !== "dice-sum-eight",
        );
      },
    });

    const progress = await getStudentProgress(await requireStudent());

    expect(progress.summary.completedQuestions).toBe(0);
    expect(progress.summary.previouslyCompletedQuestions).toBe(0);
    expect(progress.summary.extraPracticeSessions).toBe(1);
    expect(progress.questions).toEqual([]);
    expect(progress.summary.topicsStarted).toBe(0);
    expect(progress.summary.inProgressQuestions).toBe(0);
    expect(progress.questions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ questionId: "dice-sum-eight" }),
      ]),
    );
    expect(progress.recentSessions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: extra.id }),
      ]),
    );
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

    const response = await GET(
      new Request("http://localhost/api/student/progress"),
    );
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
    expect(calls[0].sql).toContain(
      "qv.snapshot_json as question_snapshot_json",
    );
    expect(calls[0].sql).toContain(
      "qv.snapshot_json ->> 'title' as question_title",
    );
    expect(calls[0].sql).toContain(
      "qv.snapshot_json ->> 'topicId' as topic_id",
    );
    expect(calls[1]).toMatchObject({
      params: [["session:owned-production"]],
    });
  });
});
