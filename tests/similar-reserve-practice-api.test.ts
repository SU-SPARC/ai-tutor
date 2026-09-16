import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/tutor/session/[sessionId]/similar/route";
import { setContentRepositoryForTests } from "@/lib/data/data-store";
import type { ContentRepository } from "@/lib/data/repository";
import {
  setReservePracticeRepositoryForTests,
  type ReservePracticeCandidate,
} from "@/lib/data/reserve-practice-repository";
import {
  resetTutorSessionsForTests,
  ReservePracticeEligibilityChangedError,
  setTutorSessionRepositoryForTests,
  type CreateTutorSessionInput,
  type TutorSessionRepository,
} from "@/lib/data/tutor-session-repository";
import type { StudentOwner } from "@/lib/auth/principal";
import type { TutorQuestion, TutorSessionRecord } from "@/lib/types";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_STUDENT,
} from "./auth-test-helpers";

describe("Reserve similar-practice API", () => {
  beforeEach(() => {
    vi.stubEnv("APP_DEMO_MODE", "true");
    vi.stubEnv("DATABASE_URL", "");
    mockPrincipal(TEST_STUDENT);
  });

  afterEach(() => {
    setContentRepositoryForTests(undefined);
    setReservePracticeRepositoryForTests(undefined);
    resetTutorSessionsForTests();
    resetAuthMocks();
    vi.unstubAllEnvs();
  });

  it("selects an eligible same-topic Reserve question and creates its protected session", async () => {
    const current = question("current", "public");
    const reserve = candidate("reserve");
    const sessions = [
      completedSession("session:current", current.id, TEST_STUDENT.userId),
    ];
    setContentRepositoryForTests(contentRepository([current]));
    setReservePracticeRepositoryForTests(reserveRepository([reserve]));
    setTutorSessionRepositoryForTests(tutorRepository(sessions));

    const response = await request("session:current");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(payload.practice).toMatchObject({
      question: {
        id: "reserve",
        prompt: "Prompt for reserve",
        title: "Question reserve",
        topicId: "topic:probability",
      },
      sessionId: expect.any(String),
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /acceptedAnswers|solutionSteps|misconceptions|patternIds|answerExplanation/i,
    );
    expect(sessions.at(-1)).toMatchObject({
      originSessionId: "session:current",
      practiceContext: "reserve_practice",
      questionId: "reserve",
      questionVersionId: reserve.versionId,
    });
  });

  it("returns the required graceful empty result without a published fallback", async () => {
    const current = question("current", "public");
    setContentRepositoryForTests(
      contentRepository([current, question("published-fallback", "public")]),
    );
    setReservePracticeRepositoryForTests(reserveRepository([]));
    setTutorSessionRepositoryForTests(
      tutorRepository([
        completedSession("session:current", current.id, TEST_STUDENT.userId),
      ]),
    );

    const response = await request("session:current");
    await expect(response.json()).resolves.toEqual({ practice: null });
    expect(response.status).toBe(200);
  });

  it("requires completion and conceals another student's session", async () => {
    const current = question("current", "public");
    setContentRepositoryForTests(contentRepository([current]));
    setReservePracticeRepositoryForTests(
      reserveRepository([candidate("reserve")]),
    );
    setTutorSessionRepositoryForTests(
      tutorRepository([
        activeSession("session:active", current.id, TEST_STUDENT.userId),
        completedSession("session:other", current.id, "user:other-student"),
      ]),
    );

    expect((await request("session:active")).status).toBe(409);
    const crossStudent = await request("session:other");
    expect(crossStudent.status).toBe(404);
  });

  it("E: opens the similar problem for an unsolved origin after three valid attempts and the worked solution", async () => {
    const current = question("current", "public");
    setContentRepositoryForTests(contentRepository([current]));
    setReservePracticeRepositoryForTests(
      reserveRepository([candidate("reserve")]),
    );
    const origin = {
      ...activeSession("session:partial", current.id, TEST_STUDENT.userId),
      attempts: [
        attempt("check", "incorrect"),
        attempt("check", "guidance"),
        attempt("check", "incorrect"),
        attempt("hint", "guidance"),
        attempt("check", "incorrect"),
        attempt("full_solution", "guidance"),
      ],
      revealedHints: 1,
      revealedSteps: current.solutionSteps.length,
    };
    setTutorSessionRepositoryForTests(tutorRepository([origin]));

    const response = await request("session:partial");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      practice: { question: { id: "reserve" } },
    });
  });

  it("D and F: blocks the similar problem without the worked solution, or with fewer than three valid attempts", async () => {
    const current = question("current", "public");
    setContentRepositoryForTests(contentRepository([current]));
    setReservePracticeRepositoryForTests(
      reserveRepository([candidate("reserve")]),
    );
    // Each case stands alone: valid attempts aggregate across a student's
    // sessions for the question, so the two blocked sessions must not share
    // a repository or their counts would add up to a qualifying five.
    setTutorSessionRepositoryForTests(
      tutorRepository([
        {
          ...activeSession("session:no-solution", current.id, TEST_STUDENT.userId),
          attempts: [
            attempt("check", "incorrect"),
            attempt("check", "incorrect"),
            attempt("check", "incorrect"),
          ],
        },
      ]),
    );
    expect((await request("session:no-solution")).status).toBe(409);

    setTutorSessionRepositoryForTests(
      tutorRepository([
        {
          ...activeSession("session:two-attempts", current.id, TEST_STUDENT.userId),
          attempts: [
            attempt("check", "incorrect"),
            attempt("check", "guidance"),
            attempt("check", "incorrect"),
            attempt("check", "guidance"),
          ],
          revealedSteps: current.solutionSteps.length,
        },
      ]),
    );
    expect((await request("session:two-attempts")).status).toBe(409);
  });

  it("returns no match when Reserve eligibility is withdrawn during session creation", async () => {
    const current = question("current", "public");
    const reserve = candidate("reserve");
    const sessions = [
      completedSession("session:current", current.id, TEST_STUDENT.userId),
    ];
    setContentRepositoryForTests(contentRepository([current]));
    setReservePracticeRepositoryForTests(reserveRepository([reserve]));
    const repository = tutorRepository(sessions);
    repository.createSession = async () => {
      throw new ReservePracticeEligibilityChangedError();
    };
    setTutorSessionRepositoryForTests(repository);

    const response = await request("session:current");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ practice: null });
  });
});

function request(sessionId: string) {
  return POST(
    new Request(`http://test/api/tutor/session/${sessionId}/similar`, {
      method: "POST",
    }),
    { params: Promise.resolve({ sessionId }) },
  );
}

function contentRepository(questions: TutorQuestion[]) {
  return {
    async getApprovedQuestionById(questionId: string) {
      return questions.find((question) => question.id === questionId);
    },
    async getApprovedQuestions() {
      return questions;
    },
    async getQuestionById(questionId: string) {
      return questions.find((question) => question.id === questionId);
    },
    async listQuestions() {
      return questions;
    },
  } as ContentRepository;
}

function reserveRepository(candidates: ReservePracticeCandidate[]) {
  return {
    async getEligibleQuestion(questionId: string, versionId: number) {
      return candidates.find(
        (candidate) =>
          candidate.question.id === questionId &&
          candidate.versionId === versionId,
      );
    },
    async listEligibleQuestions() {
      return candidates;
    },
  };
}

function tutorRepository(
  sessions: Array<TutorSessionRecord & { testOwnerUserId: string }>,
) {
  return {
    async createSession(input: CreateTutorSessionInput) {
      const session = {
        ...activeSession(randomUUID(), input.questionId, ownerId(input.owner)),
        originSessionId: input.originSessionId,
        practiceContext: input.practiceContext,
        questionVersionId: input.questionVersionId,
      };
      sessions.push(session);
      return session;
    },
    async getSession(sessionId: string, owner: StudentOwner) {
      return sessions.find(
        (session) =>
          session.id === sessionId &&
          session.testOwnerUserId === ownerId(owner),
      );
    },
    async listSessionsForStudent(owner: StudentOwner) {
      return sessions.filter(
        (session) => session.testOwnerUserId === ownerId(owner),
      );
    },
  } as unknown as TutorSessionRepository;
}

function ownerId(owner: StudentOwner) {
  return owner.kind === "user" ? owner.userId : owner.anonymousId;
}

function candidate(id: string): ReservePracticeCandidate {
  return {
    question: question(id, "private"),
    reservedAt: "2026-09-01T00:00:00.000Z",
    versionId: 42,
  };
}

function completedSession(
  id: string,
  questionId: string,
  testOwnerUserId: string,
) {
  return {
    ...activeSession(id, questionId, testOwnerUserId),
    completedAt: "2026-09-06T12:01:00.000Z",
    solved: true,
    status: "completed" as const,
  };
}

function attempt(
  mode: "check" | "hint" | "full_solution",
  verdict: "correct" | "incorrect" | "guidance",
) {
  return {
    createdAt: "2026-09-06T12:00:30.000Z",
    id: randomUUID(),
    mode,
    verdict,
  };
}

function activeSession(
  id: string,
  questionId: string,
  testOwnerUserId: string,
) {
  return {
    attempts: [],
    createdAt: "2026-09-06T12:00:00.000Z",
    id,
    lastSeenAt: "2026-09-06T12:00:00.000Z",
    practiceContext: "published" as const,
    questionId,
    revealedHints: 0,
    revealedSteps: 0,
    solved: false,
    status: "active" as const,
    testOwnerUserId,
  };
}

function question(id: string, visibility: "public" | "private"): TutorQuestion {
  return {
    answer: { acceptedAnswers: ["0.5"], explanation: "Divide one by two." },
    difficulty: "intermediate",
    hints: ["Count outcomes."],
    id,
    misconceptions: [],
    prompt: `Prompt for ${id}`,
    review: { status: "approved" },
    solutionSteps: ["Compute the result."],
    source: {
      originalityNote: "Original professor-approved test question.",
      sourceType: "professor_provided",
      trustLevel: "professor_approved",
      visibility,
    },
    title: `Question ${id}`,
    topicId: "topic:probability",
  };
}
