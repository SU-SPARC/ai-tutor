import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/tutor/session/[sessionId]/similar/route";
import { setContentRepositoryForTests } from "@/lib/data/data-store";
import type { ContentRepository } from "@/lib/data/repository";
import {
  resetTutorSessionsForTests,
  setTutorSessionRepositoryForTests,
  type TutorSessionRepository,
} from "@/lib/data/tutor-session-repository";
import type { StudentOwner } from "@/lib/auth/principal";
import {
  listPilotOperationalDiagnostics,
  resetPilotOperationalDiagnosticsForTests,
} from "@/lib/observability/pilot-operations";
import type { TutorQuestion, TutorSessionRecord } from "@/lib/types";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_STUDENT,
} from "./auth-test-helpers";

describe("similar published question API", () => {
  beforeEach(() => {
    vi.stubEnv("APP_DEMO_MODE", "true");
    vi.stubEnv("DATABASE_URL", "");
    mockPrincipal(TEST_STUDENT);
    resetPilotOperationalDiagnosticsForTests();
  });

  afterEach(() => {
    setContentRepositoryForTests(undefined);
    resetTutorSessionsForTests();
    resetAuthMocks();
    resetPilotOperationalDiagnosticsForTests();
    vi.unstubAllEnvs();
  });

  it("returns only a minimal ranked question summary", async () => {
    const current = question("current");
    const candidate = question("candidate");
    setContentRepositoryForTests(contentRepository([current, candidate]));
    setTutorSessionRepositoryForTests(
      tutorRepository([
        completedSession("session:current", current.id, TEST_STUDENT.userId),
      ]),
    );

    const response = await request("session:current");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(payload).toEqual({
      question: {
        difficulty: "intermediate",
        questionId: "candidate",
        title: "Question candidate",
        topicId: "topic:probability",
      },
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /acceptedAnswers|solutionSteps|misconceptions|patternIds|prompt|token/i,
    );
  });

  it("returns a graceful empty result without generating content", async () => {
    const current = question("current");
    setContentRepositoryForTests(contentRepository([current]));
    setTutorSessionRepositoryForTests(
      tutorRepository([
        completedSession("session:current", current.id, TEST_STUDENT.userId),
      ]),
    );

    const response = await request("session:current");
    await expect(response.json()).resolves.toEqual({ question: null });
    expect(response.status).toBe(200);
  });

  it("requires completion and conceals another student's session", async () => {
    const current = question("current");
    setContentRepositoryForTests(contentRepository([current]));
    setTutorSessionRepositoryForTests(
      tutorRepository([
        activeSession("session:active", current.id, TEST_STUDENT.userId),
        completedSession("session:other", current.id, "user:other-student"),
      ]),
    );

    const active = await request("session:active");
    expect(listPilotOperationalDiagnostics()).toEqual([]);
    const crossStudent = await request("session:other");

    expect(active.status).toBe(409);
    expect(crossStudent.status).toBe(404);
    await expect(crossStudent.json()).resolves.toEqual({
      code: "TUTOR_SESSION_UNAVAILABLE",
      error:
        "This tutor session is no longer available. It may have expired or its question may no longer be published.",
    });
  });
});

function request(sessionId: string) {
  return GET(
    new Request(`http://test/api/tutor/session/${sessionId}/similar`),
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

function tutorRepository(
  sessions: Array<TutorSessionRecord & { testOwnerUserId: string }>,
) {
  return {
    async getSession(sessionId: string, owner: StudentOwner) {
      return sessions.find(
        (session) =>
          session.id === sessionId &&
          owner.kind === "user" &&
          session.testOwnerUserId === owner.userId,
      );
    },
    async listSessionsForStudent(owner: StudentOwner) {
      return sessions.filter(
        (session) =>
          owner.kind === "user" && session.testOwnerUserId === owner.userId,
      );
    },
  } as unknown as TutorSessionRepository;
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
    questionId,
    revealedHints: 0,
    revealedSteps: 0,
    solved: false,
    status: "active" as const,
    testOwnerUserId,
  };
}

function question(id: string): TutorQuestion {
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
      originalityNote: "Original public-safe test question.",
      sourceType: "professor_provided",
      trustLevel: "professor_approved",
      visibility: "public",
    },
    title: `Question ${id}`,
    topicId: "topic:probability",
  };
}
