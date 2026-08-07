import { describe, expect, afterEach, beforeEach, it, vi } from "vitest";

import { POST as postAttempt } from "@/app/api/tutor/session/[sessionId]/attempt/route";
import { POST as postHint } from "@/app/api/tutor/session/[sessionId]/hint/route";
import { GET as getSession } from "@/app/api/tutor/session/[sessionId]/route";
import { POST as postStep } from "@/app/api/tutor/session/[sessionId]/step/route";
import { POST as postSession } from "@/app/api/tutor/session/route";
import { POST as postTutorResponse } from "@/app/api/tutor/respond/route";
import type { TutorSessionDto } from "@/lib/api/tutor-session-dto";
import { setContentRepositoryForTests } from "@/lib/data/data-store";
import type { ContentRepository } from "@/lib/data/repository";
import {
  createTutorSession,
  createDatabaseTutorSessionRepository,
  getTutorSession as getTutorSessionRecord,
  resetTutorSessionsForTests,
} from "@/lib/data/tutor-session-repository";
import type { TutorQuestion } from "@/lib/types";
import {
  authorizationForStudentOwner,
  mockPrincipal,
  mockStudentOwner,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
  TEST_STUDENT,
} from "./auth-test-helpers";

type SessionPayload = {
  code?: string;
  error?: string;
  session?: TutorSessionDto;
};

describe("tutor session API", () => {
  beforeEach(() => {
    resetTutorSessionsForTests();
    mockStudentOwner(TEST_ANONYMOUS_OWNER);
  });

  afterEach(() => {
    setContentRepositoryForTests(undefined);
    vi.unstubAllEnvs();
    resetAuthMocks();
  });

  it("creates, reads, and updates an in-memory tutor session", async () => {
    const createdResponse = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {
        questionId: "dice-sum-eight",
      }),
    );
    const created = (await createdResponse.json()) as SessionPayload;
    const sessionId = created.session?.id ?? "";

    expect(createdResponse.status).toBe(201);
    expect(created.session).toMatchObject({
      questionId: "dice-sum-eight",
    });

    const hinted = await postHint(
      new Request(`http://localhost/api/tutor/session/${sessionId}/hint`, {
        method: "POST",
      }),
      sessionContext(sessionId),
    );
    const stepped = await postStep(
      new Request(`http://localhost/api/tutor/session/${sessionId}/step`, {
        method: "POST",
      }),
      sessionContext(sessionId),
    );
    const attempted = await postAttempt(
      jsonRequest(`http://localhost/api/tutor/session/${sessionId}/attempt`, {
        answer: "2/36 because I counted all dice outcomes",
      }),
      sessionContext(sessionId),
    );
    const fetched = await getSession(
      new Request(`http://localhost/api/tutor/session/${sessionId}`),
      sessionContext(sessionId),
    );

    const hintedPayload = (await hinted.json()) as SessionPayload;
    const steppedPayload = (await stepped.json()) as SessionPayload;
    const attemptedPayload = (await attempted.json()) as SessionPayload;
    const fetchedPayload = (await fetched.json()) as SessionPayload;

    expect(hintedPayload.session).toEqual(created.session);
    expect(steppedPayload.session).toEqual(created.session);
    expect(attemptedPayload.session).toEqual(created.session);
    expect(fetchedPayload.session).toMatchObject({
      id: sessionId,
      questionId: "dice-sum-eight",
    });
    expect(
      JSON.stringify({
        attemptedPayload,
        fetchedPayload,
        hintedPayload,
        steppedPayload,
      }),
    ).not.toMatch(/answerPreview|attempts|revealedHints|revealedSteps/);
  });

  it("validates required session route inputs", async () => {
    const createResponse = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {}),
    );
    const missingResponse = await getSession(
      new Request("http://localhost/api/tutor/session/missing-session"),
      sessionContext("missing-session"),
    );
    mockStudentOwner(undefined);
    const missingIdentityResponse = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {
        questionId: "dice-sum-eight",
      }),
    );
    mockStudentOwner(TEST_ANONYMOUS_OWNER);

    expect(createResponse.status).toBe(400);
    expect(((await createResponse.json()) as SessionPayload).error).toContain(
      "questionId",
    );
    expect(missingIdentityResponse.status).toBe(401);
    expect(
      ((await missingIdentityResponse.json()) as SessionPayload).error,
    ).toContain("Authentication");
    expect(missingResponse.status).toBe(404);
  });

  it("never creates, returns, or mutates a session bound to a generated draft", async () => {
    const draft = generatedDraftQuestion();
    setContentRepositoryForTests({
      getQuestionById: async () => draft,
    } as unknown as ContentRepository);

    const createResponse = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {
        questionId: draft.id,
      }),
    );
    expect(createResponse.status).toBe(404);
    expect(await createResponse.text()).not.toContain(draft.id);

    const authorization = authorizationForStudentOwner(TEST_ANONYMOUS_OWNER);
    const legacyDraftSession = await createTutorSession(
      authorization,
      draft.id,
    );
    const context = sessionContext(legacyDraftSession.id);
    const responses = await Promise.all([
      getSession(
        new Request(
          `http://localhost/api/tutor/session/${legacyDraftSession.id}`,
        ),
        context,
      ),
      postAttempt(
        jsonRequest(
          `http://localhost/api/tutor/session/${legacyDraftSession.id}/attempt`,
          { answer: "private answer" },
        ),
        context,
      ),
      postHint(
        new Request(
          `http://localhost/api/tutor/session/${legacyDraftSession.id}/hint`,
          { method: "POST" },
        ),
        context,
      ),
      postStep(
        new Request(
          `http://localhost/api/tutor/session/${legacyDraftSession.id}/step`,
          { method: "POST" },
        ),
        context,
      ),
      postTutorResponse(
        jsonRequest("http://localhost/api/tutor/respond", {
          answer: "private answer",
          mode: "check",
          sessionId: legacyDraftSession.id,
        }),
      ),
    ]);
    const responseBodies = await Promise.all(
      responses.map((response) => response.text()),
    );
    const unchanged = await getTutorSessionRecord(
      authorization,
      legacyDraftSession.id,
    );

    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 404, 404, 404,
    ]);
    expect(responseBodies.join("\n")).not.toContain(draft.id);
    expect(responseBodies.join("\n")).not.toContain(draft.prompt);
    expect(unchanged).toMatchObject({
      attempts: [],
      revealedHints: 0,
      revealedSteps: 0,
    });
  });

  it("conceals and preserves another authenticated student's session across every direct API", async () => {
    const victimOwner = {
      kind: "user" as const,
      userId: TEST_STUDENT.userId,
    };
    const victimAuthorization = authorizationForStudentOwner(victimOwner);
    const victimSession = await createTutorSession(
      victimAuthorization,
      "dice-sum-eight",
    );
    mockPrincipal({
      displayName: "Attacking Student",
      email: "attacker@example.invalid",
      kind: "user",
      role: "student",
      roles: ["student"],
      userId: "user:attacking-student",
    });

    const context = sessionContext(victimSession.id);
    const responses = await Promise.all([
      getSession(
        new Request(`http://localhost/api/tutor/session/${victimSession.id}`),
        context,
      ),
      postAttempt(
        jsonRequest(
          `http://localhost/api/tutor/session/${victimSession.id}/attempt`,
          { answer: "cross-student write" },
        ),
        context,
      ),
      postHint(
        new Request(
          `http://localhost/api/tutor/session/${victimSession.id}/hint`,
          { method: "POST" },
        ),
        context,
      ),
      postStep(
        new Request(
          `http://localhost/api/tutor/session/${victimSession.id}/step`,
          { method: "POST" },
        ),
        context,
      ),
      postTutorResponse(
        jsonRequest("http://localhost/api/tutor/respond", {
          answer: "cross-student tutor request",
          mode: "check",
          sessionId: victimSession.id,
        }),
      ),
    ]);
    const responseBodies = await Promise.all(
      responses.map((response) => response.text()),
    );
    const unchanged = await getTutorSessionRecord(
      victimAuthorization,
      victimSession.id,
    );

    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 404, 404, 404,
    ]);
    expect(responseBodies.join("\n")).not.toContain(victimSession.id);
    expect(unchanged).toMatchObject({
      attempts: [],
      revealedHints: 0,
      revealedSteps: 0,
    });
  });

  it("fails closed without leaking connection details when a database write cannot connect", async () => {
    vi.stubEnv("APP_DEMO_MODE", "false");
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@example.test/db");

    const response = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {
        questionId: "dice-sum-eight",
      }),
    );
    const payload = (await response.json()) as SessionPayload;

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      code: "DATA_SERVICE_UNAVAILABLE",
      error: "Tutor data is temporarily unavailable. Please try again shortly.",
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /user|pass|example\.test|insert into|DATABASE_URL/i,
    );
  });

  it("supports database-backed tutor session operations through the repository", async () => {
    const rows = createFakeTutorSessionRows();
    const repository = createDatabaseTutorSessionRepository(
      "postgres://user:pass@example.test/db",
      rows.query,
    );

    const created = await repository.createSession({
      owner: TEST_ANONYMOUS_OWNER,
      questionId: "dice-sum-eight",
    });
    const hinted = await repository.revealHint(
      created.id,
      TEST_ANONYMOUS_OWNER,
    );
    const stepped = await repository.revealStep(
      created.id,
      TEST_ANONYMOUS_OWNER,
    );
    const attempted = await repository.recordAttempt({
      answerPreview: "2/36",
      owner: TEST_ANONYMOUS_OWNER,
      sessionId: created.id,
    });
    const settled = await repository.recordAttemptOutcome({
      answerPreview: "2/36",
      estimatedTokens: 0,
      owner: TEST_ANONYMOUS_OWNER,
      sessionId: created.id,
      source: "rule",
      verdict: "correct",
    });
    const studentSessions =
      await repository.listSessionsForStudent(TEST_ANONYMOUS_OWNER);

    expect(created).toMatchObject({
      attempts: [],
      questionId: "dice-sum-eight",
      revealedHints: 0,
      revealedSteps: 0,
    });
    expect(hinted?.revealedHints).toBe(1);
    expect(stepped?.revealedSteps).toBe(1);
    expect(attempted?.attempts).toEqual([
      expect.objectContaining({
        answerPreview: "2/36",
      }),
    ]);
    expect(settled?.attempts).toEqual([
      expect.objectContaining({
        source: "rule",
        verdict: "correct",
      }),
    ]);
    expect(studentSessions).toHaveLength(1);
    expect(studentSessions[0].id).toBe(created.id);
  });
});

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

function sessionContext(sessionId: string) {
  return {
    params: Promise.resolve({ sessionId }),
  };
}

function createFakeTutorSessionRows() {
  let session:
    | {
        anonymous_user_id: string | null;
        created_at: string;
        expires_at: Date | null;
        id: string;
        last_seen_at: string;
        question_id: string;
        revealed_hints: number;
        revealed_steps: number;
        user_id: string | null;
      }
    | undefined;
  const attempts: Array<{
    answer_preview: string | null;
    created_at: string;
    id: number;
    source: "blocked" | "cache" | "llm" | "retrieval" | "rule";
    verdict: "blocked" | "correct" | "guidance" | "incorrect" | null;
  }> = [];

  return {
    async query(
      sql: string,
      params: Array<boolean | Date | null | number | string | string[]> = [],
    ) {
      const normalizedSql = sql.replace(/\s+/g, " ").trim();

      if (normalizedSql.startsWith("insert into tutor_sessions")) {
        session = {
          anonymous_user_id: String(params[1] ?? ""),
          created_at: "2026-07-06T00:00:00.000Z",
          expires_at: params[4] instanceof Date ? params[4] : null,
          id: String(params[0]),
          last_seen_at: "2026-07-06T00:00:00.000Z",
          question_id: String(params[3]),
          revealed_hints: 0,
          revealed_steps: 0,
          user_id: params[2] === null ? null : String(params[2]),
        };
        return [session];
      }

      if (normalizedSql.startsWith("select * from tutor_sessions")) {
        if (normalizedSql.includes("order by last_seen_at")) {
          return session && session.anonymous_user_id === params[1]
            ? [session]
            : [];
        }

        return session &&
          session.id === params[0] &&
          session.anonymous_user_id === params[2]
          ? [session]
          : [];
      }

      if (normalizedSql.startsWith("update tutor_sessions")) {
        if (
          !session ||
          session.id !== params[0] ||
          session.anonymous_user_id !== params[2]
        ) {
          return [];
        }

        if (normalizedSql.includes("revealed_hints")) {
          session.revealed_hints += 1;
        }

        if (normalizedSql.includes("revealed_steps")) {
          session.revealed_steps += 1;
        }

        session.last_seen_at = "2026-07-06T00:00:02.000Z";

        return [session];
      }

      if (normalizedSql.startsWith("update attempts")) {
        const pendingAttempt = [...attempts]
          .reverse()
          .find((attempt) => attempt.verdict === null);

        if (!pendingAttempt) {
          return [];
        }

        pendingAttempt.verdict = String(
          params[1],
        ) as typeof pendingAttempt.verdict;
        pendingAttempt.source = String(
          params[2],
        ) as typeof pendingAttempt.source;
        return [{ id: pendingAttempt.id }];
      }

      if (normalizedSql.startsWith("insert into attempts")) {
        const includesOutcome = normalizedSql.includes("verdict,");
        attempts.push({
          answer_preview: params[2] === null ? null : String(params[2]),
          created_at: "2026-07-06T00:00:01.000Z",
          id: attempts.length + 1,
          source: includesOutcome
            ? (String(params[3]) as (typeof attempts)[number]["source"])
            : "rule",
          verdict: includesOutcome
            ? (String(params[4]) as (typeof attempts)[number]["verdict"])
            : null,
        });
        return [];
      }

      if (
        normalizedSql.startsWith(
          "select id, answer_preview, source, verdict, created_at from attempts",
        )
      ) {
        return attempts;
      }

      if (
        normalizedSql.startsWith(
          "select session_id, id, answer_preview, source, verdict, created_at from attempts",
        )
      ) {
        return attempts.map((attempt) => ({
          ...attempt,
          session_id: session?.id,
        }));
      }

      throw new Error(`Unexpected SQL: ${normalizedSql}`);
    },
  };
}

function generatedDraftQuestion(): TutorQuestion {
  return {
    answer: {
      acceptedAnswers: ["private-draft-answer"],
      explanation: "Private draft explanation.",
    },
    difficulty: "intermediate",
    hints: ["Private draft hint."],
    id: "generated-draft-never-student-facing",
    misconceptions: [],
    prompt: "Private generated draft prompt.",
    review: { status: "needs_review" },
    solutionSteps: ["Private draft solution."],
    source: {
      sourceType: "generated_original",
      trustLevel: "generated_unverified",
      visibility: "public",
    },
    title: "Private generated draft",
    topicId: "binomial-models",
  };
}
